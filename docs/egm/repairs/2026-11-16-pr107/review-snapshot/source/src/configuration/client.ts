import { randomUUID } from 'node:crypto';
import type { ConfigurationReply, ConfigurationRequest, ConfigurationValue } from '../configuration';

type Reply = ConfigurationReply<ConfigurationValue>;
type Schedule = (callback: () => void, milliseconds: number) => () => void;
const schedule: Schedule = (callback, milliseconds) => { const timer = setTimeout(callback, milliseconds); return () => clearTimeout(timer); };
const failure = (request: ConfigurationRequest): Reply => ({ ok: false, error: { code: 'unavailable', origin: 'run_configuration', operationId: request.operationId,
  message: 'Configuration storage did not safely reply. Reload before retrying; retry the same save to reconcile its outcome.', effect: 'unknown', retry: 'same_key' } });
type Pending = { request: ConfigurationRequest; resolve: (reply: Reply) => void; release: () => void; cancel: () => void; expired: boolean };

// Main owns matching before dispatch, including both async admission round trips.
// Caller timeout is not writer quiescence: keep ownership until the terminal
// reply (sent after handleAdmitted returns/DB close), or confirmed process exit.
export class ConfigurationClient {
  private pending = new Map<string, Pending>();
  constructor(private readonly transport: { available(): boolean; post(message: { id: string; configuration: ConfigurationRequest }): void },
    private readonly own: (request: ConfigurationRequest) => () => void,
    private readonly assertSafe: (value: unknown) => void,
    private readonly timer: Schedule = schedule, private readonly timeoutMs = 90_000) {}
  request(request: ConfigurationRequest): Promise<Reply> {
    request = structuredClone(request);
    return new Promise(resolve => {
      if (!this.transport.available()) { resolve(failure(request)); return; }
      let release: () => void;
      try { release = this.own(request); } catch { resolve(failure(request)); return; }
      const id = randomUUID(); let cancel = () => {};
      this.pending.set(id, { request, resolve, release, cancel: () => cancel(), expired: false });
      cancel = this.timer(() => this.expire(id), this.timeoutMs);
      if (!this.pending.has(id)) return;
      try { this.transport.post({ id, configuration: request }); }
      catch { this.expire(id); } // A throwing transport may already have dispatched.
    });
  }
  admit(id: string, value: unknown): boolean {
    if (!this.pending.has(id)) return false; // No unowned or orphan approval.
    try { this.assertSafe(value); return true; } catch { return false; }
  }
  receive(id: string, reply: Reply): void {
    const entry = this.pending.get(id); if (!entry) return;
    try {
      if (!entry.expired) {
        try { this.assertSafe(reply); entry.resolve(reply); }
        catch { entry.resolve(failure(entry.request)); }
      }
    } finally { entry.cancel(); this.pending.delete(id); entry.release(); }
  }
  private expire(id: string): void {
    const entry = this.pending.get(id); if (!entry || entry.expired) return;
    entry.expired = true; entry.cancel(); entry.resolve(failure(entry.request));
  }
  // Only call after the utility process is confirmed gone, never on timeout.
  unavailable(): void {
    for (const [id, entry] of this.pending) {
      if (!entry.expired) entry.resolve(failure(entry.request));
      entry.cancel(); this.pending.delete(id); entry.release();
    }
  }
}
