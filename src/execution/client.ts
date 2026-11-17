import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { BoundPolicy, Phase } from './bounds';
import type { ExecutionIdentity } from './journal';
import type { GuardianRecord } from './guardian';

export interface GuardianLaunch {
  identity: ExecutionIdentity; operationId: string; scopeId: string; delegatedRoot: string; journalDirectory: string;
  epoch: number; admittedAttempt: boolean; policy: BoundPolicy; parentDeadlineMs: number; trainingScopeId?: string;
}
// Bootstrap-owned port. Script/executable paths are trusted installation paths,
// not agent/tool parameters. Remote deployment uses the standalone Node bundle.
// Parent death disconnects IPC; the independent child remains to fence/terminate.
export function launchGuardian(executable: string, script: string, launch: GuardianLaunch,
  observe: (record: GuardianRecord) => void, challenge?: (value: { sequence: number; expires: number }) => void) {
  const child = fork(script, [], { execPath: executable, execArgv: [], detached: true,
    env: { PATH: '/usr/bin:/bin', LANG: 'C' }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  let settled = false;
  const pending = new Map<string, { resolve: (record: GuardianRecord) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const rejectPending = () => {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('Guardian effect is unknown; reconcile the original scope.')); }
    pending.clear();
  };
  child.on('disconnect', rejectPending);
  const ready = new Promise<GuardianRecord>((resolve, reject) => {
    const timeout = setTimeout(() => { settled = true; reject(new Error('Guardian readiness is unknown; reconcile the original scope.')); }, 15_000);
    child.on('message', (raw: unknown) => {
      const message = raw as { kind: string; requestId?: string; record?: GuardianRecord; supervisorChallenge?: string; contactChallenge?: { sequence: number; expires: number } };
      if (message.kind === 'challenge') {
        child.send({ kind: 'supervisor_alive', challenge: message.supervisorChallenge }, () => undefined);
        if (message.contactChallenge) challenge?.(message.contactChallenge);
      }
      if (message.record) observe(message.record);
      if (message.requestId && pending.has(message.requestId)) {
        const entry = pending.get(message.requestId)!; clearTimeout(entry.timer); pending.delete(message.requestId);
        if (message.kind === 'receipt' && message.record) entry.resolve(message.record);
        else entry.reject(new Error('Execution authority rejected the request.'));
      }
      if (message.kind === 'armed' && !settled) {
        settled = true; clearTimeout(timeout);
        if (message.record?.state === 'armed' && message.record.bounds.version === 2) resolve(message.record); else reject(new Error('Execution authority is fenced or incompatible; reconcile the original scope.'));
      }
      if (message.kind === 'rejected' && !settled) { settled = true; clearTimeout(timeout); reject(new Error('Execution safeguard is unavailable.')); }
    });
    child.on('error', () => { rejectPending(); clearTimeout(timeout); reject(new Error('Guardian readiness is unknown; reconcile the original scope.')); });
    child.on('exit', () => { rejectPending(); clearTimeout(timeout); if (!settled) reject(new Error('Guardian readiness is unknown; reconcile the original scope.')); });
  });
  child.send(launch, () => undefined);
  const send = async (value: { kind: string; phase?: Phase; validationCallId?: string; intent?: 'pause' | 'finish'; epoch?: number; sequence?: number }): Promise<GuardianRecord> => {
    await ready;
    if (!child.connected || pending.size >= 64) throw new Error('Execution safeguard is unavailable.');
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('Guardian effect is unknown; reconcile the original scope.')); }, 15_000);
      pending.set(requestId, { resolve, reject, timer });
      child.send({ ...value, requestId }, error => {
        if (error) { clearTimeout(timer); pending.delete(requestId); reject(new Error('Guardian effect is unknown; reconcile the original scope.')); }
      });
    });
  };
  return Object.freeze({ ready, phase: (phase: Phase, validationCallId?: string) => send({ kind: 'phase', phase, ...(validationCallId !== undefined ? { validationCallId } : {}) }), cancel: () => send({ kind: 'cancel' }),
    drain: (intent: 'pause' | 'finish') => send({ kind: 'drain', intent }),
    complete: () => send({ kind: 'complete' }), inspect: () => send({ kind: 'inspect' }),
    // Call only following authenticated controller renewal; heartbeats/progress
    // and reconnects must never call this on behalf of a disappeared controller.
    renewContact: (sequence: number) => send({ kind: 'renew_contact', epoch: launch.epoch, sequence }),
    disconnect: () => child.disconnect() });
}
