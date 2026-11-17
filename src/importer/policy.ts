import { randomUUID } from 'node:crypto';
import { SecurityError } from '../security/common';
import type { Envelope, SafeRecord } from '../security/recording';

type Recording = { recheck: (record: SafeRecord) => Promise<SafeRecord>; metadataRevision: (meta: Envelope) => string | Promise<string> };
export type ImportPolicyRequest = { channel: 'import_matching'; id: string; kind: 'acquire'; meta: Envelope } | { channel: 'import_matching'; id: string; kind: 'release' }
  | { channel: 'import_matching'; id: string; kind: 'recheck'; leaseId: string; record: SafeRecord }
  | { channel: 'import_matching'; id: string; kind: 'revision'; leaseId: string; meta: Envelope };
export type ImportPolicyReply = { channel: 'import_matching'; id: string; ok: boolean; record?: SafeRecord; revision?: string };
type Schedule = (callback: () => void, milliseconds: number) => () => void;
const schedule: Schedule = (callback, milliseconds) => { const timer = setTimeout(callback, milliseconds); return () => clearTimeout(timer); };
type Lease = { leaseId: string; release: () => void };

// This port transports ownership of main's existing matcher, never a second
// lock or matching material. The utility releases only after its writer is done.
export class ImportPolicyClient {
  private pending = new Map<string, { resolve: (lease: Lease) => void; reject: () => void; cancel: () => void }>();
  private operations = new Map<string, { resolve: (reply: ImportPolicyReply) => void; reject: () => void; cancel: () => void }>();
  private active = new Set<string>();
  constructor(private readonly post: (message: ImportPolicyRequest) => void, private readonly timer: Schedule = schedule, private readonly timeoutMs = 15_000) {}
  own(meta: Envelope): Promise<() => void> { return this.acquire(meta).then(lease => lease.release); }
  async authority(meta: Envelope): Promise<{ release: () => void; recording: Recording }> {
    const lease = await this.acquire(meta);
    return { release: lease.release, recording: {
      recheck: async record => {
        const reply = await this.operation({ channel: 'import_matching', id: randomUUID(), kind: 'recheck', leaseId: lease.leaseId, record });
        if (!reply.record) throw new SecurityError('capture_failed'); return reply.record;
      },
      metadataRevision: async meta => {
        const reply = await this.operation({ channel: 'import_matching', id: randomUUID(), kind: 'revision', leaseId: lease.leaseId, meta });
        if (typeof reply.revision !== 'string' || !reply.revision || reply.revision.length > 200) throw new SecurityError('capture_failed'); return reply.revision;
      },
    } };
  }
  private acquire(meta: Envelope): Promise<Lease> {
    return new Promise((resolve, reject) => {
      const id = randomUUID(); let cancel = () => {};
      const entry = { resolve, reject: () => reject(new SecurityError('capture_failed')), cancel: () => cancel() };
      this.pending.set(id, entry);
      cancel = this.timer(() => {
        this.pending.delete(id); entry.reject(); this.release(id);
        // A late grant must still be retired. Expiry never authorizes a commit.
      }, this.timeoutMs);
      if (!this.pending.has(id)) return;
      try { this.post({ channel: 'import_matching', id, kind: 'acquire', meta: structuredClone(meta) }); }
      catch { this.pending.delete(id); entry.cancel(); entry.reject(); this.release(id); }
    });
  }
  private operation(message: Extract<ImportPolicyRequest, { leaseId: string }>): Promise<ImportPolicyReply> {
    return new Promise((resolve, reject) => {
      const fail = () => reject(new SecurityError('capture_failed'));
      if (!this.active.has(message.leaseId)) { fail(); return; }
      const cancel = this.timer(() => { this.operations.delete(message.id); fail(); }, this.timeoutMs);
      this.operations.set(message.id, { resolve, reject: fail, cancel });
      try { this.post(message); } catch { this.operations.delete(message.id); cancel(); fail(); }
    });
  }
  receive(message: ImportPolicyReply): void {
    const operation = this.operations.get(message.id);
    if (operation) { operation.cancel(); this.operations.delete(message.id); if (message.ok) operation.resolve(message); else operation.reject(); return; }
    // Late admission/revision replies are not lease grants.
    if (message.record || message.revision) return;
    const entry = this.pending.get(message.id);
    if (!entry) { if (message.ok && !this.active.has(message.id)) this.release(message.id); return; }
    entry.cancel(); this.pending.delete(message.id);
    if (!message.ok) { entry.reject(); return; }
    this.active.add(message.id);
    entry.resolve({ leaseId: message.id, release: () => { if (this.active.delete(message.id)) this.release(message.id); } });
  }
  private release(id: string): void {
    try { this.post({ channel: 'import_matching', id, kind: 'release' }); }
    catch { /* Unknown delivery retains main's hold until confirmed utility exit. */ }
  }
}

export class ImportPolicyHost {
  private leases = new Map<string, { cancelled: boolean; release?: () => void }>();
  private closed = false;
  constructor(private readonly own: (meta: Envelope) => Promise<() => void>, private readonly post: (message: ImportPolicyReply) => void, private readonly recording?: Recording) {}
  receive(message: ImportPolicyRequest): void {
    if (this.closed || typeof message.id !== 'string' || message.id.length > 100) return;
    if (message.kind === 'release') {
      const lease = this.leases.get(message.id); if (!lease) return;
      lease.cancelled = true;
      if (lease.release) { lease.release(); this.leases.delete(message.id); }
      return;
    }
    if (message.kind === 'recheck' || message.kind === 'revision') { void this.operation(message); return; }
    if (message.kind !== 'acquire' || this.leases.has(message.id)) return;
    const lease: { cancelled: boolean; release?: () => void } = { cancelled: false };
    this.leases.set(message.id, lease); // Before initialize/admission can await.
    void this.own(message.meta).then(release => {
      lease.release = release;
      if (lease.cancelled || this.closed) { release(); this.leases.delete(message.id); return; }
      // A dropped/throwing grant is uncertain. Keep ownership until an explicit
      // writer release or actual process exit, even after the caller's timeout.
      try { this.post({ channel: 'import_matching', id: message.id, ok: true }); } catch { /* Retain ownership. */ }
    }, () => {
      this.leases.delete(message.id);
      try { this.post({ channel: 'import_matching', id: message.id, ok: false }); } catch { /* No authority was granted. */ }
    });
  }
  private async operation(message: Extract<ImportPolicyRequest, { leaseId: string }>) {
    try {
      const lease = this.leases.get(message.leaseId);
      if (!lease?.release || lease.cancelled || !this.recording) throw new SecurityError('capture_failed');
      // Acquire initialized the policy before holding it. Reinitialization here
      // can deadlock on a credential reload waiting for this same writer.
      const value = message.kind === 'recheck' ? { record: await this.recording.recheck(message.record) }
        : { revision: await this.recording.metadataRevision(message.meta) };
      if (!this.closed) this.post({ channel: 'import_matching', id: message.id, ok: true, ...value });
    } catch { if (!this.closed) { try { this.post({ channel: 'import_matching', id: message.id, ok: false }); } catch { /* Writer/exit retains ownership. */ } } }
  }
  close(): void {
    this.closed = true;
    for (const lease of this.leases.values()) { lease.cancelled = true; lease.release?.(); }
    this.leases.clear();
  }
}
