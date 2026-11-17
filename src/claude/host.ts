import { CredentialService } from '../security/credentials';
import { SafeRecording } from '../security/recording';
import { assertId, newId, Scope, SecurityError } from '../security/common';
import { CATALOG_MAX_AGE_MS, ClaudeCatalog, ClaudeChoice, ClaudeFailure, ClaudeReason, ClaudeRecovery, ClaudeReply, ClaudeSelection, ClaudeSettings, failureReply, RunAgentSnapshot, validModelId } from './contracts';
import type { SelectionCommand, SelectionValue } from './store';
import { validateChoice } from './validation';
import { recheckStoredMetadata } from '../security/stored-metadata';
import { createHash } from 'node:crypto';

export type WorkerResult = { catalog?: ClaudeCatalog; qualified?: boolean; reason?: ClaudeReason };
export type ClaudeWorker = (input: { kind: 'discover' | 'qualify'; key: string; credentialId: string; modelId?: string }, signal: AbortSignal) => Promise<WorkerResult>;

export function projectMetadata(input: unknown, restore = false): unknown {
  if (Array.isArray(input)) return input.map(item => projectMetadata(item, restore));
  if (!input || typeof input !== 'object') return input;
  return Object.fromEntries(Object.entries(input).map(([key, value]) => {
    if (!restore && key === 'credentialId') assertId(value);
    const name = restore ? ({ accessRef: 'credentialId', accessOptions: 'credentials' } as Record<string, string>)[key] :
      ({ credentialId: 'accessRef', credentials: 'accessOptions' } as Record<string, string>)[key];
    return [name ?? key, projectMetadata(value, restore)];
  }));
}
const settingsScope = '00000000-0000-4000-8000-000000000050'; // Host-only metadata scope, never a research project.
function defaultIdentity(revision: number): string {
  if (!Number.isSafeInteger(revision) || revision < 1) throw new ClaudeFailure('capture_failed');
  const bytes = createHash('sha256').update(`claude-default/1:${revision}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class ClaudeHost {
  private catalogs = new Map<string, ClaudeCatalog>();
  private refreshGeneration = new Map<string, number>();
  private producerId = newId();
  private sequence = 0;
  constructor(private readonly credentials: CredentialService, private readonly recording: SafeRecording,
    private readonly initialize: () => Promise<void>, private readonly worker: ClaudeWorker,
    private readonly store: (command: SelectionCommand) => Promise<SelectionValue>,
    private readonly projectExists: (id: string) => Promise<boolean>, private readonly now = Date.now) {}

  async reply<T>(work: () => Promise<T>): Promise<ClaudeReply<T>> {
    const operationId = newId();
    try { await this.initialize(); return { ok: true, value: await work() }; }
    catch (error) { return failureReply(error instanceof ClaudeFailure ? error.reason : error instanceof SecurityError && error.code === 'capture_failed' ? 'capture_failed' : error instanceof SecurityError && error.code === 'authentication_required' ? 'authentication_required' : 'unavailable', operationId,
      error instanceof ClaudeFailure ? error.effect : 'none'); }
  }
  private async admit<T>(body: T, scope?: Scope): Promise<T> {
    const s = scope ?? { projectId: newId(), runId: newId(), actionId: newId(), operationId: newId() };
    this.recording.assertCanAct(s);
    // Credential *values* are excluded by the shared policy. Project validated
    // opaque references under a non-secret metadata field before admission.
    const record = await this.recording.capture({ ...s, eventId: newId(), producerId: this.producerId, streamId: this.producerId,
      sequence: this.sequence++, source: 'model_metadata', kind: 'activity', status: 'completed' }, projectMetadata(body));
    // Semantic identities must never be silently changed by redaction.
    if (record.coverage !== 'complete') throw new ClaudeFailure('capture_failed');
    return projectMetadata(record.body, true) as T;
  }
  private async recheckDefault(selection: ClaudeSelection): Promise<void> {
    await recheckStoredMetadata(this.recording, { recordId: defaultIdentity(selection.revision), projectId: settingsScope }, projectMetadata(selection), 'model_metadata');
  }
  async settings(): Promise<ClaudeSettings> {
    const selection = await this.store({ kind: 'get' }) as ClaudeSelection | null;
    if (selection) validateChoice({ integration: selection.integration, credentialId: selection.credentialId, modelId: selection.modelId });
    if (selection) await this.recheckDefault(selection);
    return this.admit({ selection, credentials: this.credentials.list().filter(e => e.category === 'anthropic' && !e.supersededById)
      .map(e => ({ id: e.id, label: e.label, status: e.status })) });
  }
  async recovery(): Promise<ClaudeRecovery> {
    const selection = await this.store({ kind: 'get' }) as ClaudeSelection | null;
    const revision = selection?.revision ?? 0;
    if (!Number.isSafeInteger(revision) || revision < 0 || (selection && revision < 1)) throw new ClaudeFailure('capture_failed');
    // Independently admit only what a replacement needs. Never disclose or
    // clear quarantine of the old model, timestamps or saved choice.
    return projectMetadata(this.recording.admitProviderProjection(projectMetadata({ revision,
      credentials: this.credentials.list().filter(e => e.category === 'anthropic' && !e.supersededById)
        .map(e => ({ id: e.id, label: e.label, status: e.status })) })), true) as ClaudeRecovery;
  }
  private async call(kind: 'discover' | 'qualify', credentialId: string, modelId?: string): Promise<WorkerResult> {
    const entry = this.credentials.list().find(e => e.id === credentialId && e.category === 'anthropic' && e.status === 'active');
    if (!entry) throw new ClaudeFailure('authentication_required');
    const scope = { projectId: newId(), runId: newId(), actionId: newId(), operationId: newId() };
    this.recording.assertCanAct(scope);
    // There is no await between current-policy admission and worker invocation.
    // A cached catalog's old admission cannot authorize a newly recognized value.
    if (kind === 'qualify') this.recording.admitProviderProjection(projectMetadata({ credentialId, modelId }));
    const result = await this.credentials.bindAdapter({ component: 'claude_worker', accountId: entry.accountId,
      credentialId, purpose: kind === 'discover' ? 'list_models' : 'inference', scope },
    (key, signal) => this.worker({ kind, key, credentialId, modelId }, signal)).execute(scope);
    if (result.reason) {
      await this.admit({ operation: kind, status: 'failed', reason: result.reason }, scope);
      throw new ClaudeFailure(result.reason);
    }
    return result;
  }
  async discover(credentialId: string): Promise<ClaudeCatalog> {
    // Failed refresh invalidates old access evidence, preserving the saved choice.
    this.catalogs.delete(credentialId);
    const generation = (this.refreshGeneration.get(credentialId) ?? 0) + 1;
    this.refreshGeneration.set(credentialId, generation);
    const result = await this.call('discover', credentialId);
    const raw = result.catalog;
    if (!raw || raw.credentialId !== credentialId || raw.complete !== true || raw.sdkVersion !== '0.3.323' ||
        raw.source !== 'anthropic_models+sdk_supportedModels' || !Number.isFinite(Date.parse(raw.observedAt)) ||
        !Array.isArray(raw.models) || raw.models.length > 2000 || raw.models.some(m => !m || !validModelId(m.id) || !['active', 'deprecated'].includes(m.lifecycle))) throw new ClaudeFailure('unavailable');
    const catalog = await this.admit<ClaudeCatalog>({ credentialId, observedAt: raw.observedAt, complete: true,
      source: 'anthropic_models+sdk_supportedModels', sdkVersion: '0.3.323', models: raw.models.map(m => ({ id: m.id, lifecycle: m.lifecycle })) });
    if (this.refreshGeneration.get(credentialId) !== generation) throw new ClaudeFailure('stale_catalog');
    this.catalogs.set(credentialId, catalog);
    return catalog;
  }
  private current(choice: ClaudeChoice): ClaudeCatalog {
    validateChoice(choice);
    if (!this.credentials.list().some(e => e.id === choice.credentialId && e.category === 'anthropic' && e.status === 'active')) throw new ClaudeFailure('authentication_required');
    const catalog = this.catalogs.get(choice.credentialId);
    const age = catalog ? this.now() - Date.parse(catalog.observedAt) : Infinity;
    if (!catalog || !Number.isFinite(age) || age < 0 || age > CATALOG_MAX_AGE_MS) throw new ClaudeFailure('stale_catalog');
    if (!catalog.models.some(m => m.id === choice.modelId)) throw new ClaudeFailure('unavailable_model');
    return catalog;
  }
  async save(choice: ClaudeChoice, expectedRevision: number, requestId = newId()): Promise<ClaudeSelection> {
    const previous = await this.store({ kind: 'saved_request', requestId, choice, expectedRevision }) as ClaudeSelection | null;
    if (previous) { await this.recheckDefault(previous); return this.admit(previous); } // Reconcile without new catalog or dispatch.
    const catalog = this.current(choice);
    await this.admit({ ...choice, recordKind: 'agent_selection', schemaVersion: 1, owner: 'run_configuration',
      revision: expectedRevision + 1, observedAt: catalog.observedAt });
    this.current(choice); // revoke/rotation may have happened while awaiting admission
    const saved = await this.store({ kind: 'save', requestId, choice, expectedRevision, observedAt: catalog.observedAt }) as ClaudeSelection;
    try { await this.recheckDefault(saved); return await this.admit(saved); }
    catch { throw new ClaudeFailure('capture_failed', 'unknown'); }
  }
  async qualify(choice: ClaudeChoice): Promise<{ status: 'qualified'; modelId: string; checkedAt: string }> {
    this.current(choice);
    const result = await this.call('qualify', choice.credentialId, choice.modelId);
    if (result.qualified !== true) throw new ClaudeFailure('qualification_failed');
    this.current(choice);
    return this.admit({ status: 'qualified' as const, modelId: choice.modelId, checkedAt: new Date(this.now()).toISOString() });
  }
  async runs(projectId: string): Promise<RunAgentSnapshot[]> {
    if (!await this.projectExists(projectId)) throw new ClaudeFailure('invalid_input');
    const snapshots = await this.store({ kind: 'runs', projectId }) as RunAgentSnapshot[];
    let unsafe = false;
    for (const snapshot of snapshots) {
      try { await recheckStoredMetadata(this.recording, { recordId: snapshot.snapshotId, projectId }, projectMetadata(snapshot), 'model_metadata'); }
      catch { unsafe = true; }
    }
    if (unsafe) throw new ClaudeFailure('capture_failed');
    return this.admit(snapshots);
  }
  async saveRun(input: { projectId: string; runId: string; snapshotId: string; choice: ClaudeChoice }): Promise<RunAgentSnapshot> {
    const catalog = this.current(input.choice);
    if (!await this.projectExists(input.projectId)) throw new ClaudeFailure('invalid_input');
    const snapshot: RunAgentSnapshot = { ...validateChoice(input.choice), recordKind: 'run_agent_configuration', schemaVersion: 1, owner: 'run_configuration',
      snapshotId: input.snapshotId, projectId: input.projectId, runId: input.runId, createdAt: new Date(this.now()).toISOString(), catalogObservedAt: catalog.observedAt };
    await this.admit(snapshot);
    this.current(input.choice);
    const saved = await this.store({ kind: 'save_run', snapshot }) as RunAgentSnapshot;
    try {
      // A duplicate command returns the original persisted timestamps/metadata,
      // not the newly admitted proposal. Recheck that exact stable identity.
      await recheckStoredMetadata(this.recording, { recordId: saved.snapshotId, projectId: input.projectId }, projectMetadata(saved), 'model_metadata');
      return await this.admit(saved);
    } catch { throw new ClaudeFailure('capture_failed', 'unknown'); }
  }
}
