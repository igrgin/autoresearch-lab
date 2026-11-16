import { constants, closeSync, fsyncSync, fstatSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { GuardianRecord } from './guardian';
import { BoundError } from './bounds';

export interface ExecutionIdentity { projectId: string; runId: string; supervisorIncarnationId: string; attemptId?: string; actionId?: string; reservationId?: string }

// Guardian-private minimal evidence, separate from verbose logs and from local
// registry/project DBs. Only typed IDs, times, policy and dispositions enter it;
// never raw platform exceptions, argv, environment, or candidate-controlled text.
export function guardianJournal(directory: string, operationId: string, scopeId: string, identity: ExecutionIdentity) {
  for (const id of [operationId, scopeId]) if (!/^[0-9a-f-]{36}$/.test(id)) throw new BoundError('invalid_input');
  if (!identity || !identity.projectId || !identity.runId || !identity.supervisorIncarnationId || (!identity.attemptId && !identity.actionId) ||
      Object.keys(identity).some(key => !['projectId','runId','supervisorIncarnationId','attemptId','actionId','reservationId'].includes(key))) throw new BoundError('invalid_input');
  for (const id of Object.values(identity)) if (!/^[0-9a-f-]{36}$/.test(id)) throw new BoundError('invalid_input');
  const binding = structuredClone(identity);
  const fd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const info = fstatSync(fd);
    if (info.uid !== process.getuid?.() || (info.mode & 0o077)) throw new BoundError('unsupported_capability');
  } finally { closeSync(fd); }
  const write = (name: string, value: unknown) => {
    const bytes = JSON.stringify(value);
    // Preserve the last readable evidence if per-call identity retention exhausts
    // the journal's existing read limit. Guardian persistence failure fences work.
    if (Buffer.byteLength(bytes) > 65536) throw new BoundError('conflict');
    const temporary = path.join(directory, `${randomUUID()}.tmp`);
    const file = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { writeFileSync(file, bytes); fsyncSync(file); } finally { closeSync(file); }
    renameSync(temporary, path.join(directory, name));
    const parent = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { fsyncSync(parent); } finally { closeSync(parent); }
  };
  return {
    acquire: () => {
      // Never infer a stale guardian from a PID file. Existing lock requires the
      // execution owner to reconcile that scope; duplicate bootstrap fails closed.
      mkdirSync(path.join(directory, `${operationId}.guardian-lock`), { mode: 0o700 });
      const parent = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try { fsyncSync(parent); } finally { closeSync(parent); }
    },
    read: (): GuardianRecord | undefined => {
      let file: number;
      try { file = openSync(path.join(directory, `${operationId}.json`), constants.O_RDONLY | constants.O_NOFOLLOW); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw new BoundError('conflict'); }
      try {
        const info = fstatSync(file);
        if (!info.isFile() || info.size > 65536 || info.uid !== process.getuid?.() || (info.mode & 0o077)) throw new Error();
        const record = JSON.parse(readFileSync(file, 'utf8'));
        if (record.operationId !== operationId || record.scopeId !== scopeId || record.owner !== 'execution_guardian' || record.schemaVersion !== 1 || !isDeepStrictEqual(record.identity, binding)) throw new Error();
        delete record.owner; delete record.schemaVersion; delete record.identity;
        delete record.operationId; delete record.scopeId; return record as GuardianRecord;
      } catch { throw new BoundError('conflict'); } finally { closeSync(file); }
    },
    save: (record: GuardianRecord) => write(`${operationId}.json`, { owner: 'execution_guardian', schemaVersion: 1, operationId, scopeId, identity: binding, ...record }),
    // Trusted launchers use this irreversible fence for this operation/scope.
    // New execution requires a different identity plus reconciled old effects.
    seal: (training = false) => { write(`${operationId}${training ? ".training" : ""}.fenced`, { operationId, scopeId, identity: binding, fenced: true }); return true; },
  };
}
