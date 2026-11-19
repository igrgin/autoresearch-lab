// Each operation owns a generation. Revalidation, policy changes and unmount
// invalidate older replies, including successful replies already in transit.
export class ConfigurationCache {
  private generation = 0;
  begin(): number { return ++this.generation; }
  current(generation: number): boolean { return generation === this.generation; }
  invalidate(): void { this.generation++; }
}

const listeners = new Set<() => void>();
export function onConfigurationCacheInvalidated(listener: () => void): () => void {
  listeners.add(listener); return () => { listeners.delete(listener); };
}
// A denied reuse also fences sibling views, even if a policy notification was
// missed. Defaults recovery may then republish only newly revalidated bodies.
export function invalidateConfigurationCaches(): void { for (const listener of listeners) listener(); }
