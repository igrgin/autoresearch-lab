import { newId, SecurityError } from '../security/common';
import type { CredentialService } from '../security/credentials';
import type { Sanitizer } from '../security/sanitizer';
import { authenticateAndList, safeMetadata, validateChoice, type AuthRpc } from './catalog';
import { type CodexDiagnostic, type AgentChoice, type AgentSnapshot, type ChooseAgent, type CodexReply, type CodexSettings, type CodexStoreCommand, type CodexStoreValue, type CodexView, type ModelCatalog } from './contract';
import { codexFailure, CodexFailure } from './errors';

export class CodexHost {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly security: { initialize(): Promise<void>; credentials: CredentialService; matcher: Sanitizer },
    private readonly store: (command: CodexStoreCommand) => Promise<CodexStoreValue>,
    private readonly start: (signal: AbortSignal) => Promise<AuthRpc>) {}
  // Serialize authentication/settings mutations so auth changes cannot race a saved selection.
  execute<T>(work: () => Promise<T>): Promise<CodexReply<T>> {
    const result = this.tail.then(async (): Promise<CodexReply<T>> => {
      try { await this.security.initialize(); return { ok: true, value: await work() }; }
      catch (error) {
        return codexFailure(error instanceof SecurityError ? new CodexFailure(error.code === 'permission_denied' ? 'permission_denied' : 'authentication_required') : error);
      }
    });
    this.tail = result.catch(() => undefined); return result;
  }
  async settings(): Promise<CodexView> {
    const settings = await this.store({ kind: 'settings' }) as CodexSettings;
    if (settings.defaultAgent) this.recheck(settings.defaultAgent);
    return { settings, diagnostics: await this.store({ kind: 'diagnostics' }) as CodexDiagnostic[], credentials: this.security.credentials.list().filter(entry => entry.category === 'openai')
      .map(({ id, label, status }) => ({ id, label, status })) };
  }
  async catalog(credentialRef?: string): Promise<ModelCatalog> {
    const operationId = newId();
    try {
      const catalog = await this.loadCatalog(credentialRef);
      await this.store({ kind: 'diagnostic', diagnostic: { operationId, observedAt: new Date().toISOString(), code: 'authenticated', detail: 'auth_bodies_and_native_diagnostics_excluded' } });
      return catalog;
    } catch (error) {
      const reply = codexFailure(error instanceof SecurityError ? new CodexFailure('authentication_required') : error, operationId);
      if (!reply.ok) await this.store({ kind: 'diagnostic', diagnostic: { operationId, observedAt: new Date().toISOString(), code: reply.error.code, detail: 'auth_bodies_and_native_diagnostics_excluded' } });
      throw new CodexFailure(!reply.ok ? reply.error.code : 'unavailable', operationId);
    }
  }
  private async loadCatalog(credentialRef?: string): Promise<ModelCatalog> {
    const settings = await this.store({ kind: 'settings' }) as CodexSettings;
    const reference = credentialRef ?? settings.credentialRef;
    const entry = this.security.credentials.list().find(entry => entry.id === reference && entry.category === 'openai');
    if (!entry || entry.status !== 'active') throw new CodexFailure('authentication_required');
    const scope = { projectId: newId(), runId: newId(), actionId: newId(), operationId: newId() };
    const port = this.security.credentials.bindAdapter({ component: 'codex_auth', accountId: entry.accountId,
      credentialId: entry.id, purpose: 'list_models', scope }, async (key, signal) => {
      let rpc: AuthRpc | undefined;
      try {
        rpc = await this.start(signal);
        return { ok: true as const, value: await authenticateAndList(rpc, key, this.security.matcher) };
      } catch (error) { return codexFailure<ModelCatalog>(error); }
      finally { await rpc?.close(); }
    });
    const reply = await port.execute(scope);
    if (!reply.ok) throw new CodexFailure(reply.error.code);
    if (credentialRef) await this.store({ kind: 'authenticate', credentialRef });
    return reply.value;
  }
  async choose(choice: ChooseAgent): Promise<AgentChoice> {
    // Fresh authentication and a complete catalog, even for a previously saved identifier.
    const catalog = await this.catalog();
    const model = validateChoice(choice, catalog);
    const settings = await this.store({ kind: 'settings' }) as CodexSettings;
    if (!settings.credentialRef) throw new CodexFailure('authentication_required');
    return { integration: 'codex', provider: 'openai', authMode: 'apiKey', credentialRef: settings.credentialRef,
      model: model.model, effort: choice.effort, inputModalities: model.inputModalities, catalogObservedAt: catalog.observedAt,
      runtimeVersion: catalog.runtimeVersion, protocolVersion: catalog.protocolVersion, entitlement: 'unverified' };
  }
  async saveDefault(choice: ChooseAgent): Promise<AgentChoice> {
    return await this.store({ kind: 'default', agent: await this.choose(choice) }) as AgentChoice;
  }
  private recheck(agent: AgentChoice): void {
    for (const field of [agent.model, agent.effort, ...agent.inputModalities]) safeMetadata(field, this.security.matcher);
  }
  async runSelection(projectId: string): Promise<AgentSnapshot | null> {
    const snapshot = await this.store({ kind: 'run_get', projectId }) as AgentSnapshot | null;
    if (snapshot) this.recheck(snapshot.agent);
    return snapshot;
  }
  async saveRunSelection(projectId: string, expectedRevision: number, choice: ChooseAgent): Promise<AgentSnapshot> {
    return await this.store({ kind: 'run_save', projectId, expectedRevision, agent: await this.choose(choice) }) as AgentSnapshot;
  }
}
