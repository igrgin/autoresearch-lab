import { newId } from '../security/common';
import { ClaudeFailure, failureReply, type ClaudeReply } from './contracts';
import type { SelectionCommand, SelectionValue } from './store';

type Schedule = (callback: () => void, milliseconds: number) => () => void;
const schedule: Schedule = (callback, milliseconds) => { const timer = setTimeout(callback, milliseconds); return () => clearTimeout(timer); };
const mutation = (command: SelectionCommand) => command.kind === 'save' || command.kind === 'save_run';
const uncertain = (command: SelectionCommand) => mutation(command) || command.kind === 'saved_request';
type Pending = { command: SelectionCommand; resolve: (reply: ClaudeReply<SelectionValue>) => void;
  cancel: () => void; release: () => void; expired: boolean };

// Reply expiry does not cancel a dispatched write. Matching-policy ownership
// survives until a late reply, ordered synchronous-writer barrier or confirmed
// utility exit proves quiescence. Stable save identities still reconcile effects.
export class SelectionClient {
  private pending = new Map<string, Pending>();
  private barriers = new Map<string, string>();
  constructor(private readonly dispatch: (message: { id: string; selection: SelectionCommand }) => void,
    private readonly timer: Schedule = schedule, private readonly timeoutMs = 15_000,
    private readonly own: (command: SelectionCommand) => () => void = () => () => {}) {}
  async request(selection: SelectionCommand): Promise<SelectionValue> {
    selection = structuredClone(selection);
    const reply = await new Promise<ClaudeReply<SelectionValue>>((resolve, reject) => {
      let release: () => void;
      try { release = mutation(selection) ? this.own(selection) : () => {}; } catch (error) { reject(error); return; }
      const id = newId(); let cancel = () => {};
      this.pending.set(id, { command: selection, resolve, cancel: () => cancel(), release, expired: false });
      cancel = this.timer(() => this.fail(id), this.timeoutMs);
      if (!this.pending.has(id)) return;
      try { this.dispatch({ id, selection }); } catch { this.fail(id); }
    });
    if (!reply.ok) throw new ClaudeFailure(reply.error.reason, reply.error.effect);
    return reply.value;
  }
  receive(id: string, reply: ClaudeReply<SelectionValue>): void {
    const original = this.barriers.get(id);
    if (original) { this.barriers.delete(id); this.finish(original); return; }
    const pending = this.pending.get(id); if (!pending) return;
    this.finish(id);
    if (!pending.expired) pending.resolve(reply);
  }
  private finish(id: string): void {
    const pending = this.pending.get(id); if (!pending) return;
    pending.cancel(); pending.release(); this.pending.delete(id);
    for (const [barrier, original] of this.barriers) if (original === id) this.barriers.delete(barrier);
  }
  private fail(id: string): void {
    const pending = this.pending.get(id); if (!pending || pending.expired) return;
    pending.expired = true; pending.cancel();
    pending.resolve(failureReply('unavailable', id, uncertain(pending.command) ? 'unknown' : 'none'));
    if (!mutation(pending.command)) { this.finish(id); return; }
    const barrier = newId(); this.barriers.set(barrier, id);
    // Main's FIFO postMessage and the coordinator's synchronous selection branch
    // order this acknowledgement after the original mutation has stopped writing.
    try { this.dispatch({ id: barrier, selection: { kind: 'barrier' } }); } catch { /* Retain ownership until confirmed exit. */ }
  }
  // Only a confirmed utility exit, never caller timeout, authorizes this release.
  unavailable(): void {
    for (const [id, pending] of this.pending) {
      if (!pending.expired) pending.resolve(failureReply('unavailable', id, uncertain(pending.command) ? 'unknown' : 'none'));
      this.finish(id);
    }
  }
}
