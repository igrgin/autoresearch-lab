import { newId } from '../security/common';
import type { CodexReply, CodexStoreCommand, CodexStoreValue } from './contract';
import { CodexFailure } from './errors';
type Schedule = (callback: () => void, milliseconds: number) => () => void;
const schedule: Schedule = (callback, milliseconds) => { const timer = setTimeout(callback, milliseconds); return () => clearTimeout(timer); };
const mutation = (command: CodexStoreCommand) => ['default', 'run_save', 'authenticate'].includes(command.kind);
type Pending = { command: CodexStoreCommand; resolve: (value: CodexStoreValue) => void; reject: (error: CodexFailure) => void;
  cancel: () => void; release: () => void; expired: boolean };
// The same client is used by main and controlled transport tests. A timeout
// expires the caller, not the write. An ordered barrier/exit proves quiescence
// before releasing matching-policy ownership to credential registration.
export class CodexStoreClient {
  private pending = new Map<string, Pending>();
  private barriers = new Map<string, string>();
  constructor(private readonly transport: { available(): boolean; post(message: { id: string; codex: CodexStoreCommand }): void },
    private readonly own: (command: CodexStoreCommand) => () => void = () => () => {},
    private readonly timer: Schedule = schedule, private readonly timeoutMs = 10_000) {}
  request(command: CodexStoreCommand): Promise<CodexStoreValue> {
    command = structuredClone(command);
    return new Promise((resolve, reject) => {
      if (!this.transport.available()) { reject(new CodexFailure('unavailable')); return; }
      let release: () => void;
      try { release = mutation(command) ? this.own(command) : () => {}; } catch (error) { reject(error); return; }
      const id = newId(); let cancel = () => {};
      const entry: Pending = { command, resolve, reject, cancel: () => cancel(), release, expired: false };
      this.pending.set(id, entry);
      cancel = this.timer(() => this.expire(id), this.timeoutMs);
      if (!this.pending.has(id)) return;
      try { this.transport.post({ id, codex: command }); } catch { this.expire(id); }
    });
  }
  receive(id: string, reply: CodexReply<CodexStoreValue>): void {
    const original = this.barriers.get(id);
    if (original) { this.barriers.delete(id); this.finish(original); return; }
    const entry = this.pending.get(id); if (!entry) return;
    this.finish(id);
    if (entry.expired) return;
    if (reply.ok) entry.resolve(reply.value);
    else entry.reject(new CodexFailure(reply.error.code, reply.error.operationId, reply.error.effect));
  }
  private finish(id: string): void {
    const entry = this.pending.get(id); if (!entry) return;
    entry.cancel(); entry.release(); this.pending.delete(id);
    for (const [barrier, original] of this.barriers) if (original === id) this.barriers.delete(barrier);
  }
  private expire(id: string): void {
    const entry = this.pending.get(id); if (!entry || entry.expired) return;
    entry.expired = true; entry.cancel();
    entry.reject(new CodexFailure('unavailable', 'requestId' in entry.command ? entry.command.requestId : undefined, mutation(entry.command) ? 'unknown' : 'none'));
    if (!mutation(entry.command)) { this.finish(id); return; }
    const barrier = newId(); this.barriers.set(barrier, id);
    // Main's postMessage FIFO and the coordinator's synchronous Codex handler
    // make this a completion fence, even if the original reply was dropped.
    try { this.transport.post({ id: barrier, codex: { kind: 'barrier' } }); } catch { /* Hold ownership until confirmed disconnect. */ }
  }
  unavailable(): void {
    for (const [id, entry] of this.pending) {
      if (!entry.expired) entry.reject(new CodexFailure('unavailable', 'requestId' in entry.command ? entry.command.requestId : undefined, mutation(entry.command) ? 'unknown' : 'none'));
      this.finish(id);
    }
  }
}
