import { CgroupScope, linuxBootClock } from './cgroup';
import { BoundPolicy, ExecutionBounds } from './bounds';
import { ExecutionGuardian } from './guardian';
import { serveGuardian } from './guardian-host';
import { ExecutionIdentity, guardianJournal } from './journal';

// Detached remote entrypoint. The trusted execution launcher prepares a closed,
// namespace-contained cgroup before starting this process, and opens no work gate
// until receiving 'armed'. No candidate command or provider credential is accepted.
const startup = setTimeout(() => process.exit(1), 15_000);
process.once('message', (raw: unknown) => {
  clearTimeout(startup);
  try {
    const input = raw as { identity: ExecutionIdentity; operationId: string; scopeId: string; delegatedRoot: string; journalDirectory: string;
      epoch: number; admittedAttempt: boolean; policy: BoundPolicy; parentDeadlineMs: number; trainingScopeId?: string };
    if (typeof input.admittedAttempt !== 'boolean') throw new Error();
    const now = linuxBootClock();
    const journal = guardianJournal(input.journalDirectory, input.operationId, input.scopeId, input.identity);
    journal.acquire();
    const restored = journal.read();
    if (!Number.isFinite(input.parentDeadlineMs)) throw new Error();
    const scope = new CgroupScope(input.delegatedRoot, input.scopeId, journal.seal,
      // Whole-subtree SIGKILL is the guaranteed fallback. Phase-specific graceful
      // cancellation is optional; no untrusted PID or shell command is accepted.
      () => undefined);
    const training = input.trainingScopeId ? new CgroupScope(`${input.delegatedRoot}/${input.scopeId}`, input.trainingScopeId, () => journal.seal(true), () => undefined) : undefined;
    const bounds = restored ? ExecutionBounds.restore(restored.bounds, now) : new ExecutionBounds(input.policy, now, input.parentDeadlineMs);
    const guardian = new ExecutionGuardian(bounds, scope, linuxBootClock, journal.save, scope.binding(), training, restored);
    serveGuardian(guardian, linuxBootClock, input.epoch, input.admittedAttempt);
  } catch {
    process.send?.({ kind: 'rejected', code: 'unsupported_capability', effect: 'unknown' });
    process.exitCode = 1; process.disconnect?.();
  }
});
