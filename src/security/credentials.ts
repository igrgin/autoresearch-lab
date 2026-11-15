import { assertId, newId, sameScope, Scope, SecurityError, validateScope } from './common';
import { PrivateFiles } from './private-files';
import { Sanitizer } from './sanitizer';

export type Category = 'runpod' | 'vast' | 'openai' | 'anthropic' | 'ssh_passphrase' | 'model_download' | 'control' | 'vast_session';
export type Component = 'runpod_adapter' | 'vast_adapter' | 'codex_auth' | 'claude_worker' | 'ssh_transport' | 'model_fetcher' | 'control_transport';
export type Purpose = 'discover' | 'inspect' | 'observe' | 'inference' | 'list_models' | 'ssh_unlock' | 'model_fetch' | 'control';
const access: Record<Component, { category: Category; purposes: readonly Purpose[] }> = {
  runpod_adapter: { category: 'runpod', purposes: ['discover', 'inspect', 'observe'] },
  vast_adapter: { category: 'vast', purposes: ['discover', 'inspect', 'observe'] },
  codex_auth: { category: 'openai', purposes: ['inference', 'list_models'] },
  claude_worker: { category: 'anthropic', purposes: ['inference', 'list_models'] },
  ssh_transport: { category: 'ssh_passphrase', purposes: ['ssh_unlock'] },
  model_fetcher: { category: 'model_download', purposes: ['model_fetch'] },
  control_transport: { category: 'control', purposes: ['control'] },
};
export interface Encryption {
  available(): Promise<boolean>;
  encrypt(value: string): Promise<Buffer>;
  decrypt(value: Buffer): Promise<string>;
}
export interface CredentialMetadata { id: string; category: Category; accountId: string; label: string; status: 'active' | 'revoked' }
interface Entry extends CredentialMetadata { value: string }
interface Vault { version: 1; entries: Entry[] }
export interface AdapterBinding { component: Component; accountId: string; credentialId: string; purpose: Purpose; scope: Scope }

// Constructed only by the trusted host. No service/adapter handle is exposed by preload.
export class CredentialService {
  #vault: Vault = { version: 1, entries: [] };
  #ready = false;
  #sessions = new Map<string, Entry & { scope: Scope }>();
  #tail: Promise<unknown> = Promise.resolve();
  #revoked = new Set<string>();
  #workers = new Map<string, Set<() => void>>();
  constructor(private readonly files: PrivateFiles, private readonly encryption: Encryption, private readonly matcher: Sanitizer) {}
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(operation); this.#tail = result.catch(() => undefined); return result;
  }
  async initialize(): Promise<void> {
    return this.serial(async () => {
      this.#ready = false;
      try {
        if (!await this.encryption.available()) throw new Error();
        await this.files.prepare();
        const ciphertext = await this.files.read('credentials.vault');
        const vault: Vault = ciphertext ? JSON.parse(await this.encryption.decrypt(ciphertext)) : { version: 1, entries: [] };
        if (vault.version !== 1 || !Array.isArray(vault.entries)) throw new Error();
        const ids = new Set<string>();
        for (const entry of vault.entries) {
          assertId(entry.id); assertId(entry.accountId);
          if (ids.has(entry.id) || !Object.values(access).some(a => a.category === entry.category) ||
              !['active', 'revoked'].includes(entry.status) || typeof entry.label !== 'string' || typeof entry.value !== 'string') throw new Error();
          ids.add(entry.id); this.matcher.register(entry.id, entry.value);
          if (entry.status === 'revoked') this.#revoked.add(entry.id);
        }
        this.#vault = vault; this.#ready = true;
      } catch { throw new SecurityError('authentication_required'); }
    });
  }
  private async save(vault: Vault): Promise<void> {
    try {
      if (!await this.encryption.available()) throw new Error();
      const ciphertext = await this.encryption.encrypt(JSON.stringify(vault));
      await this.files.write('credentials.vault', ciphertext);
      this.#vault = vault;
    } catch { this.#ready = false; throw new SecurityError('authentication_required'); }
  }
  private requireReady(): void { if (!this.#ready) throw new SecurityError('authentication_required'); }
  async register(category: Category, accountId: string, label: string, value: string): Promise<CredentialMetadata> {
    return this.serial(async () => {
      this.requireReady(); assertId(accountId);
      if (!Object.values(access).some(a => a.category === category) || typeof label !== 'string' || label.length > 120 || typeof value !== 'string') throw new SecurityError('invalid_input');
      const id = newId();
      try {
        this.matcher.register(id, value); // generated/entered values are registered before any use
        if (this.matcher.text(label).changed) throw new Error();
      } catch { throw new SecurityError('invalid_input'); }
      const entry: Entry = { id, category, accountId, label, status: 'active', value };
      await this.save({ version: 1, entries: [...this.#vault.entries, entry] });
      return this.metadata(entry);
    });
  }
  // Provider-issued expiring session only: passwords/OTP/recovery inputs have no storage API.
  registerVastSession(accountId: string, scope: Scope, value: string): CredentialMetadata {
    this.requireReady(); assertId(accountId);
    const entry = { id: newId(), category: 'vast_session' as const, accountId, label: 'Vast session',
      status: 'active' as const, value, scope: validateScope(scope) };
    try { this.matcher.register(entry.id, value); } catch { throw new SecurityError('invalid_input'); }
    this.#sessions.set(entry.id, entry); return this.metadata(entry);
  }
  async replace(id: string, value: string): Promise<CredentialMetadata> {
    assertId(id);
    // Retire the old authentication authority before awaiting persistence.
    this.#revoked.add(id);
    for (const terminate of this.#workers.get(id) ?? []) { try { terminate(); } catch { /* safe error only */ } }
    return this.serial(async () => {
      this.requireReady();
      const previous = this.#vault.entries.find(entry => entry.id === id);
      if (!previous) throw new SecurityError('permission_denied');
      const replacement: Entry = { ...previous, id: newId(), value, status: 'active' };
      try { this.matcher.register(replacement.id, value); } catch { throw new SecurityError('invalid_input'); }
      await this.save({ version: 1, entries: [...this.#vault.entries.map(entry => entry.id === id ? { ...entry, status: 'revoked' as const } : entry), replacement] });
      return this.metadata(replacement);
    });
  }
  private metadata(entry: Entry): CredentialMetadata {
    return { id: entry.id, category: entry.category, accountId: entry.accountId,
      label: this.matcher.text(entry.label).value, status: this.#revoked.has(entry.id) ? 'revoked' : entry.status };
  }
  list(): CredentialMetadata[] { this.requireReady(); return this.#vault.entries.map(entry => this.metadata(entry)); }
  async revoke(id: string): Promise<void> {
    assertId(id);
    this.#revoked.add(id); // deny in-flight/new access even if durable write fails
    for (const terminate of this.#workers.get(id) ?? []) { try { terminate(); } catch { /* no worker diagnostics */ } }
    return this.serial(async () => {
      this.requireReady();
      if (this.#sessions.has(id)) { this.#sessions.get(id)!.status = 'revoked'; return; }
      if (!this.#vault.entries.some(e => e.id === id)) throw new SecurityError('permission_denied');
      await this.save({ version: 1, entries: this.#vault.entries.map(e => e.id === id ? { ...e, status: 'revoked' } : e) });
    });
  }
  // After externally verified rotation and completed rescan, discard protected retired matching material.
  async finishRemediation(id: string): Promise<void> {
    return this.serial(async () => {
      this.requireReady(); assertId(id);
      if (!this.#revoked.has(id)) throw new SecurityError('permission_denied');
      if (this.#sessions.has(id)) this.#sessions.delete(id);
      else await this.save({ version: 1, entries: this.#vault.entries.filter(e => e.id !== id) });
      this.matcher.forget(id);
    });
  }
  bindAdapter<T>(binding: AdapterBinding, handler: (value: string, signal: AbortSignal) => Promise<T>): { execute(scope: Scope): Promise<T> } {
    const rule = Object.hasOwn(access, binding.component) ? access[binding.component] : undefined;
    const bound = { ...binding, scope: validateScope(binding.scope) };
    assertId(bound.accountId); assertId(bound.credentialId);
    if (!rule || !rule.purposes.includes(bound.purpose)) throw new SecurityError('permission_denied');
    return Object.freeze({ execute: async (scope: Scope) => {
      this.requireReady();
      if (!sameScope(bound.scope, validateScope(scope))) throw new SecurityError('permission_denied');
      const session = this.#sessions.get(bound.credentialId);
      const entry = session ?? this.#vault.entries.find(e => e.id === bound.credentialId);
      if (session && !sameScope(session.scope, bound.scope)) throw new SecurityError('permission_denied');
      if (!entry || (entry.category !== rule.category && !(bound.component === 'vast_adapter' && entry.category === 'vast_session')) || entry.accountId !== bound.accountId) throw new SecurityError('permission_denied');
      if (entry.status !== 'active' || this.#revoked.has(entry.id)) throw new SecurityError('authentication_required');
      const controller = new AbortController();
      const terminate = () => controller.abort();
      const workers = this.#workers.get(entry.id) ?? new Set(); workers.add(terminate); this.#workers.set(entry.id, workers);
      try {
        const result = await handler(entry.value, controller.signal);
        if (controller.signal.aborted || this.#revoked.has(entry.id)) throw new SecurityError('authentication_required');
        return result;
      } catch { throw new SecurityError('authentication_required', 'unknown'); }
      finally { workers.delete(terminate); }
    } });
  }
}
