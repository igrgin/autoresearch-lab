import { assertId, newId, SecurityError } from '../security/common';
import type { CredentialService } from '../security/credentials';
import type { Sanitizer } from '../security/sanitizer';
import type { SafeRecording } from '../security/recording';
import { recheckStoredMetadata } from '../security/stored-metadata';
import { createHash } from 'node:crypto';
import { authenticateAndList, validateChoice, type AuthRpc } from './catalog';
import { type CodexReconciliation, type CodexMutation, type CodexRecovery, type CodexDiagnostic, type AgentChoice, type AgentSnapshot, type ChooseAgent, type CodexReply, type CodexSettings, type CodexStoreCommand, type CodexStoreValue, type CodexView, type ModelCatalog } from './contract';
import { admitCodexValue } from './admission';
import { codexFailure, CodexFailure } from './errors';

export class CodexHost {
  private committed = new WeakSet<object>();
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly security: { initialize(): Promise<void>; credentials: CredentialService; matcher: Sanitizer; recording: Pick<SafeRecording, 'recheck' | 'admitProviderProjection'> },
    private readonly store: (command: CodexStoreCommand) => Promise<CodexStoreValue>,
    private readonly start: (signal: AbortSignal) => Promise<AuthRpc>) {}
  // Serialize authentication/settings mutations so auth changes cannot race a saved selection.
  execute<T>(work: () => Promise<T>): Promise<CodexReply<T>> {
    const result = this.tail.then(async (): Promise<CodexReply<T>> => {
      try {
        await this.security.initialize(); const value = await work();
        const release = this.security.matcher.holdMatchingPolicy();
        try {
          const admitted = admitCodexValue(this.security.matcher, value);
          // Keep policy ownership through the resolved IPC promise's microtask
          // handoff. Credential changes may resume on the next event-loop turn.
          setImmediate(release);
          return { ok: true, value: admitted };
        }
        catch {
          release();
          // A registration in the final promise handoff still cannot publish a
          // stale reply. Contain any exact durable receipt before withholding it.
          if (value && typeof value === 'object' && 'settings' in value) {
            const agent = (value as unknown as CodexView).settings.defaultAgent;
            if (agent) { try { await this.recheck(agent, { recordId: this.defaultIdentity(agent), projectId: agent.credentialRef }); } catch { /* withheld */ } }
          }
          if (value && typeof value === 'object' && 'snapshotId' in value) {
            try { await this.recheckSnapshot(value as unknown as AgentSnapshot); } catch { /* withheld */ }
          }
          if (value && typeof value === 'object' && 'result' in value) {
            try { await this.checkReceipt((value as { result: AgentChoice | AgentSnapshot }).result); } catch { /* withheld */ }
          }
          if (value && typeof value === 'object' && this.committed.has(value)) {
            try { await this.checkReceipt(value as AgentChoice | AgentSnapshot); } catch { /* containment owns safe diagnostics */ }
            throw new CodexFailure('capture_failed', undefined, 'unknown');
          }
          throw new CodexFailure('capture_failed');
        }
      }
      catch (error) {
        return codexFailure(error instanceof SecurityError ? new CodexFailure(error.code === 'capture_failed' ? 'capture_failed' : error.code === 'permission_denied' ? 'permission_denied' : 'authentication_required') : error);
      }
    });
    this.tail = result.catch(() => undefined); return result;
  }
  async settings(): Promise<CodexView> {
    const settings = await this.store({ kind: 'settings' }) as CodexSettings;
    const diagnostics = await this.store({ kind: 'diagnostics' }) as CodexDiagnostic[];
    if (settings.defaultAgent) await this.recheck(settings.defaultAgent, { recordId: this.defaultIdentity(settings.defaultAgent), projectId: settings.defaultAgent.credentialRef });
    return admitCodexValue(this.security.matcher, { settings, diagnostics, credentials: this.security.credentials.list().filter(entry => entry.category === 'openai')
      .map(({ id, label, status }) => ({ id, label, status })) });
  }
  async recovery(projectId?: string): Promise<CodexRecovery> {
    const settings = await this.store({ kind: 'settings' }) as CodexSettings;
    if (settings.credentialRef !== null) assertId(settings.credentialRef);
    let selection: CodexRecovery['selection'] = null;
    if (projectId !== undefined) {
      assertId(projectId);
      const saved = await this.store({ kind: 'run_get', projectId }) as AgentSnapshot | null;
      if (saved) {
        assertId(saved.snapshotId); assertId(saved.projectId);
        if (saved.projectId !== projectId || !Number.isSafeInteger(saved.revision) || saved.revision < 1) throw new CodexFailure('capture_failed');
        selection = { snapshotId: saved.snapshotId, projectId, revision: saved.revision };
      }
    }
    // Fresh policy admission of the minimal projection is independent of the
    // withheld body's scope. It cannot clear that record's durable quarantine.
    const projection = this.security.recording.admitProviderProjection({ accessRef: settings.credentialRef, selection,
      accessOptions: this.security.credentials.list().filter(entry => entry.category === 'openai').map(({ id, label, status }) => ({ id, label, status })) });
    return { credentialRef: projection.accessRef, credentials: projection.accessOptions, selection: projection.selection };
  }
  async catalog(credentialRef?: string): Promise<ModelCatalog> {
    const operationId = newId(); let diagnosticWritten = false;
    try {
      const catalog = await this.loadCatalog(credentialRef);
      await this.store({ kind: 'diagnostic', diagnostic: { operationId, observedAt: new Date().toISOString(), code: 'authenticated', detail: 'auth_bodies_and_native_diagnostics_excluded' } });
      diagnosticWritten = true;
      return admitCodexValue(this.security.matcher, catalog);
    } catch (error) {
      const reply = codexFailure(error instanceof SecurityError ? new CodexFailure('authentication_required') : error, operationId);
      if (!reply.ok && !diagnosticWritten) {
        try { await this.store({ kind: 'diagnostic', diagnostic: { operationId, observedAt: new Date().toISOString(), code: reply.error.code, detail: 'auth_bodies_and_native_diagnostics_excluded' } }); }
        catch { /* A diagnostic failure cannot overwrite the original safe failure/effect. */ }
      }
      throw new CodexFailure(!reply.ok ? reply.error.code : 'unavailable', operationId, !reply.ok ? reply.error.effect : 'none');
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
    admitCodexValue(this.security.matcher, reply.value);
    if (credentialRef) await this.store({ kind: 'authenticate', credentialRef });
    return admitCodexValue(this.security.matcher, reply.value);
  }
  async choose(choice: ChooseAgent): Promise<AgentChoice> {
    // Fresh authentication and a complete catalog, even for a previously saved identifier.
    const catalog = await this.catalog();
    const model = validateChoice(choice, catalog);
    const settings = await this.store({ kind: 'settings' }) as CodexSettings;
    if (!settings.credentialRef) throw new CodexFailure('authentication_required');
    admitCodexValue(this.security.matcher, catalog);
    return admitCodexValue(this.security.matcher, { integration: 'codex', provider: 'openai', authMode: 'apiKey', credentialRef: settings.credentialRef,
      model: model.model, effort: choice.effort, inputModalities: model.inputModalities, catalogObservedAt: catalog.observedAt,
      runtimeVersion: catalog.runtimeVersion, protocolVersion: catalog.protocolVersion, entitlement: 'unverified' });
  }
  async saveDefault(choice: ChooseAgent, requestId = newId()): Promise<AgentChoice> {
    return await this.save({ kind: 'default', choice }, requestId) as AgentChoice;
  }
  async reconcileSave(requestId: string): Promise<CodexReconciliation> {
    assertId(requestId);
    const result = await this.store({ kind: 'mutation_receipt', requestId }) as AgentChoice | AgentSnapshot | null;
    if (!result) return { requestId, state: 'absent' };
    try { await this.checkReceipt(result); return { requestId, state: 'committed', result }; }
    catch {
      // Only independently admitted identities can acknowledge containment. This
      // does not permit reading/replaying the withheld body or clear quarantine.
      return admitCodexValue(this.security.matcher, { requestId, state: 'withheld', selection: 'snapshotId' in result ?
        { snapshotId: result.snapshotId, projectId: result.projectId, revision: result.revision } : null });
    }
  }
  private async checkReceipt(value: AgentChoice | AgentSnapshot): Promise<void> {
    if ('snapshotId' in value) await this.recheckSnapshot(value);
    else await this.recheck(value, { recordId: this.defaultIdentity(value), projectId: value.credentialRef });
    admitCodexValue(this.security.matcher, value);
  }
  private async save(input: CodexMutation, requestId: string): Promise<AgentChoice | AgentSnapshot> {
    assertId(requestId);
    // Lookup uses the caller's stable semantic intent, not fresh catalog times.
    // Identical retries need no auth/catalog dispatch and return that exact receipt.
    const saved = await this.store({ kind: 'mutation_get', requestId, input }) as AgentChoice | AgentSnapshot | null;
    let receipt = saved;
    if (!receipt) {
      const agent = await this.choose(input.choice);
      admitCodexValue(this.security.matcher, { input, agent });
      try { receipt = await this.store({ ...input, requestId, agent }) as AgentChoice | AgentSnapshot; }
      catch (error) {
        if (error instanceof CodexFailure) throw error;
        throw new CodexFailure('unavailable', requestId, 'unknown');
      }
    }
    this.committed.add(receipt);
    try { await this.checkReceipt(receipt); return receipt; }
    catch { throw new CodexFailure('capture_failed', requestId, 'unknown'); }
  }
  private defaultIdentity(agent: AgentChoice): string {
    // A default has no run snapshot ID. Its complete semantic version supplies
    // a stable opaque identity across restart and key reordering. A clean newly
    // saved choice is a new version; it never clears the old quarantine.
    const fields = Object.entries(agent).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    const bytes = createHash('sha256').update(`codex-default/1:${JSON.stringify(fields)}`).digest().subarray(0, 16);
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  private async recheck(agent: AgentChoice, identity: { recordId: string; projectId: string }): Promise<void> {
    const { credentialRef, ...metadata } = agent;
    // Project opaque references under a non-secret metadata key, while still
    // checking every value. The shared recheck owns incidents and revocation.
    // A retained recheck can itself await incident storage/revocation. Restart
    // it under any new matching generation, then finish with synchronous admission.
    for (;;) {
      const generation = this.security.matcher.matchingGeneration;
      await recheckStoredMetadata(this.security.recording, identity, { ...metadata, accessRef: credentialRef }, 'model_metadata');
      if (generation === this.security.matcher.matchingGeneration) {
        admitCodexValue(this.security.matcher, agent); return;
      }
    }
  }
  private async recheckSnapshot(snapshot: AgentSnapshot): Promise<void> {
    const { credentialRef, ...metadata } = snapshot.agent;
    for (;;) {
      const generation = this.security.matcher.matchingGeneration;
      await recheckStoredMetadata(this.security.recording, { recordId: snapshot.snapshotId, projectId: snapshot.projectId },
        { ...snapshot, agent: { ...metadata, accessRef: credentialRef } }, 'model_metadata');
      if (generation === this.security.matcher.matchingGeneration) { admitCodexValue(this.security.matcher, snapshot); return; }
    }
  }
  async runSelection(projectId: string): Promise<AgentSnapshot | null> {
    const snapshot = await this.store({ kind: 'run_get', projectId }) as AgentSnapshot | null;
    if (snapshot) await this.recheckSnapshot(snapshot);
    return snapshot;
  }
  async saveRunSelection(projectId: string, expectedRevision: number, choice: ChooseAgent, requestId = newId()): Promise<AgentSnapshot> {
    return await this.save({ kind: 'run_save', projectId, expectedRevision, choice }, requestId) as AgentSnapshot;
  }
}
