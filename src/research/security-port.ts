import { randomUUID } from 'node:crypto';
import { assertId, SecurityError } from '../security/common';
import type { Envelope, MemoryAdmission, SafeRecord, SafeRecording } from '../security/recording';
import type { Sanitizer } from '../security/sanitizer';
import type { Owner, ResearchEvent } from './contracts';

type Request = { channel: 'research_security'; id: string; kind: 'hold' | 'release' | 'admit' | 'receipt' | 'recheck';
  leaseId?: string; value?: { meta: Envelope; raw: unknown } | { owner: Owner; event: ResearchEvent } | SafeRecord };
type Reply = { channel: 'research_security'; id: string; ok: boolean; record?: SafeRecord };

// Private main/utility transport only. A lease belongs to the writer operation,
// not to a caller waiting for its reply. Only writer quiescence or exit releases it.
export class ResearchSecurityClient {
  private pending = new Map<string, { resolve: (reply: Reply) => void; reject: () => void; timer: ReturnType<typeof setTimeout> }>();
  constructor(private readonly post: (request: Request) => void, private readonly timeoutMs = 15_000) {}
  private request(kind: Request['kind'], value?: Request['value'], leaseId?: string, id = randomUUID()): Promise<Reply> {
    return new Promise((resolve,reject) => {
      const fail = () => reject(new SecurityError('capture_failed'));
      const timer = setTimeout(() => { this.pending.delete(id); fail(); },this.timeoutMs);
      this.pending.set(id,{resolve,reject:fail,timer});
      try { this.post({channel:'research_security',id,kind,value,leaseId}); }
      catch { clearTimeout(timer); this.pending.delete(id); fail(); }
    });
  }
  receive(reply: Reply): void {
    const waiting = this.pending.get(reply.id); if (!waiting) return;
    clearTimeout(waiting.timer); this.pending.delete(reply.id);
    if (reply.ok) waiting.resolve(reply); else waiting.reject();
  }
  private async record(kind: 'admit' | 'receipt' | 'recheck', value: Request['value'], leaseId?: string): Promise<SafeRecord> {
    const reply = await this.request(kind,value,leaseId);
    if (!reply.record) throw new SecurityError('capture_failed');
    return reply.record;
  }
  admit = (meta: Envelope, raw: unknown) => this.record('admit',{meta,raw});
  admitReceipt = (owner: Owner, event: ResearchEvent) => this.record('receipt',{owner,event});
  recheck = (record: SafeRecord) => this.record('recheck',record);
  async withMatchingPolicy<T>(work: (port: MemoryAdmission) => Promise<T>): Promise<T> {
    const leaseId = randomUUID();
    try {
      await this.request('hold',undefined,undefined,leaseId);
      return await work({
        admit:(meta,raw)=>this.record('admit',{meta,raw},leaseId),
        admitReceipt:(owner,event)=>this.record('receipt',{owner,event},leaseId),
        recheck:record=>this.record('recheck',record,leaseId),
      });
    } finally {
      // FIFO on the native port also cancels a timed-out acquisition. Late
      // admission replies cannot revive a settled writer or cause another write.
      try { this.post({channel:'research_security',id:leaseId,kind:'release'}); }
      catch { /* Main retains authority until the utility's confirmed exit. */ }
    }
  }
}

export class ResearchSecurityHost {
  private leases = new Map<string, (() => void) | undefined>();
  private closed = false;
  constructor(private readonly initialize: () => Promise<void>, private readonly matcher: Sanitizer,
    private readonly recording: MemoryAdmission, private readonly post: (reply: Reply) => void) {}
  async receive(message: Request): Promise<void> {
    if (this.closed || message.channel !== 'research_security') return;
    try {
      assertId(message.id);
      if (message.kind === 'release') { this.leases.get(message.id)?.(); this.leases.delete(message.id); return; }
      if (message.kind === 'hold') {
        if (this.leases.has(message.id)) throw new SecurityError('conflict');
        this.leases.set(message.id,undefined);
        await this.initialize();
        if (this.closed || !this.leases.has(message.id)) return;
        this.leases.set(message.id,this.matcher.holdMatchingPolicy());
        this.post({channel:'research_security',id:message.id,ok:true}); return;
      }
      if (message.leaseId) {
        assertId(message.leaseId);
        if (!this.leases.get(message.leaseId)) throw new SecurityError('capture_failed');
        // The lease was acquired after initialization. Reinitializing here could
        // queue behind a credential mutation waiting for this very writer.
      } else await this.initialize();
      const value = message.value;
      const record = message.kind === 'admit' && value && 'meta' in value ? await this.recording.admit(value.meta,value.raw)
        : message.kind === 'receipt' && value && 'owner' in value ? await this.recording.admitReceipt(value.owner,value.event)
        : message.kind === 'recheck' && value && 'envelope' in value ? await this.recording.recheck(value) : undefined;
      if (!this.closed) this.post({channel:'research_security',id:message.id,ok:!!record,record});
    } catch {
      // A rejected/lost reply cannot release a lease: the writer's finally or
      // actual utility exit owns that transition, including after caller timeout.
      if (!this.closed) { try { this.post({channel:'research_security',id:message.id,ok:false}); } catch { /* Await utility exit. */ } }
    }
  }
  unavailable(): void {
    this.closed = true;
    for (const release of this.leases.values()) release?.();
    this.leases.clear();
  }
}
export type ResearchAdmission = Pick<SafeRecording,'admit'|'admitReceipt'|'recheck'|'withMatchingPolicy'>;
