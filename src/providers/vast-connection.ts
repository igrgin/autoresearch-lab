import { newId, Scope } from '../security/common';
import { CredentialService } from '../security/credentials';
import { SafeRecording } from '../security/recording';
import { VastAdapter, vastFailure } from './vast';
import type { VastCredentialChoice, VastDiscovery, VastReply } from './vast-contract';

// Host-only account connection owner. No credential, scope, URL or adapter handle crosses preload.
export class VastConnection {
  private readonly sessions = new Map<string, { credentialId: string; scope: Scope }>();
  private readonly busy = new Set<string>();
  constructor(private readonly credentials: CredentialService, private readonly recording: SafeRecording,
    private readonly adapter = new VastAdapter()) {}
  choices(): VastCredentialChoice[] {
    return this.recording.admitProviderProjection(this.credentials.list()
      .filter(entry => entry.category === 'vast' && entry.status === 'active')
      .map(entry => ({ id: entry.id, label: entry.label })));
  }
  private active(id: string) { return this.credentials.list().find(entry => entry.id === id && entry.category === 'vast' && entry.status === 'active'); }
  async clearSession(id: string): Promise<void> {
    const previous = this.sessions.get(id); this.sessions.delete(id);
    if (previous) await this.credentials.revoke(previous.credentialId);
  }
  async setSession(id: string, value: string): Promise<void> {
    const entry = this.active(id);
    if (!entry || !value || value.length > 65536) throw new Error('Session entry rejected.');
    await this.clearSession(id);
    // Memory only. The session's scope belongs to this host-created connection,
    // never to renderer/model-supplied research identities. Each scan has a fresh operation ID.
    const scope = { projectId: newId(), runId: newId(), actionId: newId(), operationId: newId() };
    const session = this.credentials.registerVastSession(entry.accountId, scope, value, entry.id);
    this.sessions.set(id, { credentialId: session.id, scope });
  }
  async discover(id: string): Promise<VastReply<VastDiscovery>> {
    const operationId = newId();
    const entry = this.active(id);
    if (!entry) return vastFailure('authentication_required', operationId);
    // Bound renderer-triggered concurrency and keep refresh ordering unambiguous.
    if (this.busy.has(id)) return vastFailure('unavailable', operationId);
    this.busy.add(id);
    try {
      const session = this.sessions.get(id);
      const scope = session?.scope ?? { projectId: newId(), runId: newId(), actionId: newId(), operationId };
      const reply = await this.credentials.bindAdapter({ component: 'vast_adapter', purpose: 'discover', accountId: entry.accountId,
        credentialId: session?.credentialId ?? id, scope }, (value, signal) => this.adapter.discover(value, entry.accountId, operationId, signal, !!session)).execute(scope);
      if (!this.active(id)) return vastFailure('authentication_required', operationId);
      if (!reply.ok && reply.error.reason === 'session_expired') await this.clearSession(id);
      try { return this.recording.admitProviderProjection(reply); }
      catch { return vastFailure('unsafe_response', operationId); }
    } catch { return vastFailure('authentication_required', operationId); }
    finally { this.busy.delete(id); }
  }
}
