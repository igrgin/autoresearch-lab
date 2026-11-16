// Main and preload share this fixed-field publication protocol. It carries no
// matching material and grants no credential or domain mutation authority.
export function metadataReply(value: unknown, generation: number): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid metadata projection.');
  return { ...value, metadataGeneration: generation };
}

const changed = () => new Error('Credential protection changed. Reload metadata before retrying; a save may already have completed.');

export class MetadataPolicy {
  private generation = 0;
  private epoch = 0;
  private listeners = new Set<() => void>();
  current = (): number => this.epoch;
  revision = (): number => this.generation;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  };
  observe(generation: number): void {
    if (!Number.isSafeInteger(generation) || generation < 0) throw changed();
    if (generation <= this.generation) return;
    this.generation = generation; this.invalidate();
  }
  private invalidate(): void {
    this.epoch++;
    for (const listener of this.listeners) { try { listener(); } catch { /* One view cannot prevent invalidation of the others. */ } }
  }
  private async barrier(revision: () => Promise<number>): Promise<number> {
    try {
      const value = await revision();
      if (!Number.isSafeInteger(value) || value < this.generation) throw changed();
      this.observe(value); return value;
    } catch { this.invalidate(); throw changed(); }
  }
  async refresh(revision: () => Promise<number>): Promise<void> { await this.barrier(revision); }
  async receive<T>(invoke: () => Promise<unknown>, revision: () => Promise<number>): Promise<T> {
    const started = this.epoch;
    const before = await this.barrier(revision);
    if (started !== this.epoch || before !== this.generation) throw changed(); // Do not dispatch a stale intent.
    let reply: unknown, failure: unknown, rejected = false;
    try { reply = await invoke(); } catch (error) { failure = error; rejected = true; }
    // Settle the publication barrier for BOTH reply outcomes. In particular, a
    // native rejection after a matching change must invalidate surviving caches
    // even if its notification was lost. Never dispatch the operation again.
    let after: number;
    try { after = await this.barrier(revision); }
    catch (error) { throw rejected ? failure : error; }
    if (rejected) throw failure; // Preserve the original operation/effect diagnostic.
    if (started !== this.epoch || before !== after || after !== this.generation) throw changed();
    if (reply === null || reply === undefined) return reply as T;
    if (typeof reply !== 'object' || Array.isArray(reply) || !('metadataGeneration' in reply) || reply.metadataGeneration !== after) {
      this.invalidate(); throw changed();
    }
    const body = { ...reply } as Record<string, unknown>; delete body.metadataGeneration;
    return body as T;
  }
}
