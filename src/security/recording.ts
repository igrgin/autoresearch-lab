import { assertId, newId, POLICY_REVISION, Scope, SecurityError, validateScope } from './common';
import { contextBody } from './context';
import { PrivateFiles } from './private-files';
import { MAX_CAPTURE_BYTES, Omission, OmitBody, SafeValue, Sanitizer } from './sanitizer';

export const CAPTURE_PATHS = ['prompt', 'assistant', 'command', 'argv', 'cwd', 'stdout', 'stderr', 'tool_arguments', 'tool_result',
  'vendor_error', 'stack', 'file_name', 'file_content', 'diff', 'git_message', 'attachment', 'summary', 'metric', 'model_metadata', 'log', 'provider_projection'] as const;
export type CapturePath = typeof CAPTURE_PATHS[number] | 'auth' | 'headers' | 'credential_file' | 'environment' | 'raw_provider' | 'raw_sdk' | 'native_history';
const excluded: readonly CapturePath[] = ['auth', 'headers', 'credential_file', 'environment', 'raw_provider', 'raw_sdk', 'native_history'];
export type RecordKind = 'activity' | 'task' | 'code' | 'validation' | 'constraint' | 'acceptance' | 'test_assessment' | 'control' | 'execution_outcome';
export interface Envelope extends Scope {
  eventId: string; producerId: string; streamId: string; sequence: number;
  source: CapturePath; kind: RecordKind; status: 'pending' | 'completed' | 'failed' | 'interrupted';
}
export interface SafeRecord {
  contractVersion: { major: 1; minor: 0 }; envelope: Envelope; policyRevision: string;
  body: SafeValue; coverage: 'complete' | 'redacted' | 'omitted'; omission?: Omission | 'quarantined';
  supersedes?: string;
}
export type Destination = 'application' | 'model' | 'native_history' | 'remote' | 'export' | 'unknown';
export interface Incident extends Scope {
  incidentId: string; recordIds: string[]; sessionIds: string[]; credentialId?: string;
  reach: 'prevented' | 'exposed' | 'unknown'; destinations: Destination[]; detectedAt: string;
  policyRevision: string; state: 'contained' | 'recovered'; coverage: 'incomplete' | 'complete';
  reason: 'credential_exposure' | 'unsafe_capture';
}
interface State { version: 1; incidents: Incident[]; fencedRuns: string[]; withheld: string[]; retiredSessions: string[] }
function envelope(input: Envelope): Envelope {
  const scope = validateScope(input);
  for (const id of [input.eventId, input.producerId, input.streamId]) assertId(id);
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 0 ||
      ![...CAPTURE_PATHS, ...excluded].includes(input.source) ||
      !['activity', 'task', 'code', 'validation', 'constraint', 'acceptance', 'test_assessment', 'control', 'execution_outcome'].includes(input.kind) ||
      !['pending', 'completed', 'failed', 'interrupted'].includes(input.status)) throw new SecurityError('invalid_input');
  return { ...scope, eventId: input.eventId, producerId: input.producerId, streamId: input.streamId, sequence: input.sequence,
    source: input.source, kind: input.kind, status: input.status };
}

// This is an admission/file port, not a history database or lifecycle authority.
// All read destinations recheck current policy and quarantine, including after restart.
export class SafeRecording {
  #state: State = { version: 1, incidents: [], fencedRuns: [], withheld: [], retiredSessions: [] };
  #ready = false;
  #tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly files: PrivateFiles, private readonly sanitizer: Sanitizer,
    private readonly revoke: (id: string) => Promise<void>) {}
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(work); this.#tail = result.catch(() => undefined); return result;
  }
  async initialize(): Promise<void> {
    this.#ready = false;
    try {
      await this.files.prepare();
      const raw = await this.files.read('security-state.json');
      if (raw) {
        const state = JSON.parse(raw.toString('utf8')) as State;
        if (Object.keys(state).sort().join(',') !== 'fencedRuns,incidents,retiredSessions,version,withheld' || state.version !== 1 || !Array.isArray(state.incidents)) throw new Error();
        for (const id of [...state.fencedRuns, ...state.withheld, ...state.retiredSessions]) assertId(id);
        // State contains no free-form diagnostic content. Recheck even trusted disk metadata.
        for (const incident of state.incidents) {
          const keys = ['projectId', 'runId', 'actionId', 'operationId', 'incidentId', 'recordIds', 'sessionIds', 'reach', 'destinations',
            'detectedAt', 'policyRevision', 'state', 'coverage', 'reason', ...(incident.credentialId ? ['credentialId'] : [])];
          if (Object.keys(incident).sort().join(',') !== keys.sort().join(',')) throw new Error();
          validateScope(incident); assertId(incident.incidentId);
          for (const id of [...incident.recordIds, ...incident.sessionIds]) assertId(id);
          if (incident.credentialId) assertId(incident.credentialId);
          if (!['prevented', 'exposed', 'unknown'].includes(incident.reach) ||
              !['contained', 'recovered'].includes(incident.state) ||
              !['complete', 'incomplete'].includes(incident.coverage) ||
              !['credential_exposure', 'unsafe_capture'].includes(incident.reason) ||
              !/^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/.test(incident.detectedAt) ||
              !incident.destinations.every(d => ['application', 'model', 'native_history', 'remote', 'export', 'unknown'].includes(d))) throw new Error();
        }
        this.#state = state;
      }
      this.#ready = true;
    } catch { throw new SecurityError('capture_failed'); }
  }
  assertCanAct(scope: Scope, sessionId?: string): void {
    validateScope(scope);
    if (!this.#ready || this.#state.fencedRuns.includes(scope.runId) || (sessionId && this.#state.retiredSessions.includes(sessionId))) {
      throw new SecurityError('capture_failed');
    }
  }
  private async saveState(): Promise<void> { await this.files.write('security-state.json', JSON.stringify(this.#state)); }
  private async fence(scope: Scope): Promise<void> {
    if (!this.#state.fencedRuns.includes(scope.runId)) this.#state.fencedRuns.push(scope.runId);
    try { await this.saveState(); } catch { this.#ready = false; }
  }
  private filtered(meta: Envelope, raw: unknown, reason?: Omission): SafeRecord {
    if (excluded.includes(meta.source)) reason = 'excluded_source';
    if (meta.source === 'attachment' && typeof raw !== 'string') reason = 'opaque_attachment';
    let body: SafeValue = null; let redacted = false;
    if (!reason) {
      try {
        ({ body, redacted } = this.sanitizer.filter(raw));
        if (['task', 'code', 'validation', 'constraint', 'acceptance'].includes(meta.kind)) contextBody(meta.kind, body);
      }
      catch (error) { reason = error instanceof OmitBody ? error.reason : error instanceof SecurityError ? 'invalid_schema' : 'filter_unavailable'; }
    }
    return { contractVersion: { major: 1, minor: 0 }, envelope: meta, policyRevision: POLICY_REVISION,
      body: reason ? null : body, coverage: reason ? 'omitted' : redacted ? 'redacted' : 'complete', ...(reason ? { omission: reason } : {}) };
  }
  async capture(meta: Envelope, raw: unknown, reason?: Omission): Promise<SafeRecord> {
    return this.serial(async () => {
      const checked = envelope(meta); this.assertCanAct(checked);
      const record = this.filtered(checked, raw, reason);
      if (record.omission === 'filter_unavailable') await this.fence(checked);
      try {
        const existing = await this.files.read(`${checked.eventId}.json`);
        if (existing) {
          if (existing.toString('utf8') !== JSON.stringify(record)) throw new SecurityError('conflict');
          return structuredClone(record);
        }
        await this.files.write(`${checked.eventId}.json`, JSON.stringify(record));
      } catch (error) {
        if (error instanceof SecurityError && error.code === 'conflict') throw error;
        await this.fence(checked); throw new SecurityError('capture_failed');
      }
      return structuredClone(record);
    });
  }
  // Only a fixed structured control receipt may bypass a capture fence. No free text/raw fallback.
  async control(meta: Envelope, receipt: { controlId: string; state: 'requested' | 'confirmed_stopped' | 'unknown' }): Promise<SafeRecord> {
    return this.serial(() => this.controlReceipt(meta, receipt));
  }
  private async controlReceipt(meta: Envelope, receipt: { controlId: string; state: 'requested' | 'confirmed_stopped' | 'unknown' }): Promise<SafeRecord> {
    assertId(receipt.controlId);
    if (!['requested', 'confirmed_stopped', 'unknown'].includes(receipt.state)) throw new SecurityError('invalid_input');
    const checked = envelope({ ...meta, source: 'log', kind: 'control' });
    const record: SafeRecord = { contractVersion: { major: 1, minor: 0 }, envelope: checked, policyRevision: POLICY_REVISION,
      body: { controlId: receipt.controlId, state: receipt.state }, coverage: 'complete' };
    try {
      if (await this.files.read(`${checked.eventId}.json`)) throw new SecurityError('conflict');
      await this.files.write(`${checked.eventId}.json`, JSON.stringify(record));
    } catch { await this.fence(checked); throw new SecurityError('capture_failed'); }
    return record;
  }
  // Execution owner supplies independently verified facts, never inferred from capture health.
  async outcome(meta: Envelope, receipt: { attemptId: string; executionOutcomeId: string; evidenceId: string;
    state: 'completed' | 'failed' | 'interrupted' }): Promise<SafeRecord> {
    for (const id of [receipt.attemptId, receipt.executionOutcomeId, receipt.evidenceId]) assertId(id);
    if (!['completed', 'failed', 'interrupted'].includes(receipt.state)) throw new SecurityError('invalid_input');
    return this.serial(async () => {
      const checked = envelope({ ...meta, source: 'log', kind: 'execution_outcome', status: receipt.state });
      const record: SafeRecord = { contractVersion: { major: 1, minor: 0 }, envelope: checked, policyRevision: POLICY_REVISION,
        body: { attemptId: receipt.attemptId, executionOutcomeId: receipt.executionOutcomeId, evidenceId: receipt.evidenceId, state: receipt.state }, coverage: 'complete' };
      try {
        if (await this.files.read(`${checked.eventId}.json`)) throw new SecurityError('conflict');
        await this.files.write(`${checked.eventId}.json`, JSON.stringify(record));
      } catch { await this.fence(checked); throw new SecurityError('capture_failed'); }
      return record;
    });
  }
  stream(meta: Envelope, format: 'text' | 'json' = 'text'): CaptureStream { return new CaptureStream(this, envelope(meta), format); }
  async read(id: string): Promise<SafeRecord | undefined> {
    assertId(id);
    if (!this.#ready) throw new SecurityError('capture_failed');
    let checkedEnvelope: Envelope | undefined;
    try {
      const bytes = await this.files.read(`${id}.json`); if (!bytes) return undefined;
      const stored = JSON.parse(bytes.toString('utf8')) as SafeRecord;
      const checked = envelope(stored.envelope); checkedEnvelope = checked;
      if (checked.eventId !== id || stored.contractVersion?.major !== 1 || stored.contractVersion?.minor !== 0 ||
          !['complete', 'redacted', 'omitted'].includes(stored.coverage)) throw new Error();
      if (this.#state.withheld.includes(id) || this.#state.incidents.some(i => i.runId === checked.runId && i.state === 'contained')) return { contractVersion: { major: 1, minor: 0 }, envelope: checked,
        policyRevision: POLICY_REVISION, body: null, coverage: 'omitted', omission: 'quarantined' };
      // Never send an older payload directly to UI/export/replay/model after trust changes.
      if (stored.coverage === 'omitted') {
        if (!['excluded_source', 'unsupported_encoding', 'incomplete_record', 'size_limit', 'invalid_schema', 'filter_unavailable', 'opaque_attachment', 'quarantined'].includes(stored.omission ?? '')) throw new Error();
        return { ...this.filtered(checked, null, 'excluded_source'), omission: stored.omission };
      }
      const record = this.filtered(checked, stored.body);
      if (JSON.stringify(record.body) !== JSON.stringify(stored.body)) {
        const matched = this.sanitizer.filter(stored.body).credentialIds;
        await this.incident(checked, { recordIds: [id], sessionIds: [], reach: 'exposed', destinations: ['application'],
          reason: record.coverage === 'omitted' ? 'unsafe_capture' : 'credential_exposure', ...(matched[0] ? { credentialId: matched[0] } : {}) });
        for (const credentialId of matched.slice(1)) await this.revoke(credentialId);
        return { ...record, body: null, coverage: 'omitted', omission: 'quarantined' };
      }
      if (stored.supersedes) { assertId(stored.supersedes); record.supersedes = stored.supersedes; }
      return record;
    } catch {
      if (checkedEnvelope) await this.fence(checkedEnvelope); else this.#ready = false;
      throw new SecurityError('capture_failed');
    }
  }
  async project(ids: string[], destination: 'ui' | 'export' | 'search' | 'replay' | 'agent', authorizedScope?: Scope): Promise<SafeRecord[]> {
    if (destination === 'agent' && !authorizedScope) throw new SecurityError('permission_denied');
    if (authorizedScope) validateScope(authorizedScope);
    const records: SafeRecord[] = [];
    for (const id of ids) {
      const record = await this.read(id); if (!record) continue;
      if (destination === 'agent' && (!['task', 'code', 'validation', 'constraint', 'acceptance'].includes(record.envelope.kind) ||
          !['file_content', 'metric', 'tool_result'].includes(record.envelope.source) || record.coverage === 'omitted')) continue;
      if (destination === 'agent' && this.#state.fencedRuns.includes(record.envelope.runId)) continue;
      if (destination === 'agent') {
        if (record.envelope.projectId !== authorizedScope!.projectId || record.envelope.runId !== authorizedScope!.runId) continue;
        try { contextBody(record.envelope.kind, record.body); } catch { continue; }
      }
      records.push(record);
    }
    return records.filter(record => destination !== 'agent' || !this.#state.fencedRuns.includes(record.envelope.runId)).map(record =>
      this.#state.incidents.some(i => i.runId === record.envelope.runId && i.state === 'contained') ?
        { ...record, body: null, coverage: 'omitted' as const, omission: 'quarantined' as const } : record);
  }
  async incident(scope: Scope, input: { recordIds: string[]; sessionIds: string[]; credentialId?: string;
    reach: Incident['reach']; destinations: Destination[]; reason: Incident['reason'] }): Promise<Incident> {
      const safeScope = validateScope(scope);
      for (const id of [...input.recordIds, ...input.sessionIds, ...(input.credentialId ? [input.credentialId] : [])]) assertId(id);
      if (!['prevented', 'exposed', 'unknown'].includes(input.reach) || !['credential_exposure', 'unsafe_capture'].includes(input.reason) ||
          !input.destinations.every(d => ['application', 'model', 'native_history', 'remote', 'export', 'unknown'].includes(d))) throw new SecurityError('invalid_input');
      const incident: Incident = { ...safeScope, incidentId: newId(), recordIds: [...input.recordIds], sessionIds: [...input.sessionIds],
        ...(input.credentialId ? { credentialId: input.credentialId } : {}), reach: input.reach, destinations: [...input.destinations],
        reason: input.reason, detectedAt: new Date().toISOString(), policyRevision: POLICY_REVISION, state: 'contained', coverage: 'incomplete' };
      // Fence in memory first, before asynchronous IO or notifying other processes.
      this.#state.withheld = [...new Set([...this.#state.withheld, ...input.recordIds])];
      this.#state.retiredSessions = [...new Set([...this.#state.retiredSessions, ...input.sessionIds])];
      this.#state.fencedRuns = [...new Set([...this.#state.fencedRuns, scope.runId])];
      this.#state.incidents.push(incident);
      // Call revoke before the first await, so matching authentication authority is fenced too.
      const revocation = input.credentialId ? this.revoke(input.credentialId) : Promise.resolve();
      const revokeResult = revocation.catch(() => { throw new SecurityError('capture_failed'); });
      void revokeResult.catch(() => undefined);
      return this.serial(async () => {
      try {
        await this.saveState();
        await revokeResult;
      } catch { this.#ready = false; throw new SecurityError('capture_failed'); }
      return structuredClone(incident);
    });
  }
  async correct(originalId: string, meta: Envelope, independentlyAdmittedBody: unknown): Promise<SafeRecord> {
    return this.serial(() => this.correction(originalId, meta, independentlyAdmittedBody));
  }
  private async correction(originalId: string, meta: Envelope, independentlyAdmittedBody: unknown): Promise<SafeRecord> {
    assertId(originalId);
    if (!this.#state.withheld.includes(originalId) || meta.eventId === originalId) throw new SecurityError('permission_denied');
    const original = await this.read(originalId);
    if (!original || original.envelope.runId !== meta.runId) throw new SecurityError('permission_denied');
    const corrected = this.filtered(envelope(meta), independentlyAdmittedBody);
    if (corrected.coverage === 'omitted') throw new SecurityError('capture_failed');
    corrected.supersedes = originalId;
    if (await this.files.read(`${meta.eventId}.json`)) throw new SecurityError('conflict');
    await this.files.write(`${meta.eventId}.json`, JSON.stringify(corrected));
    // In-place tombstone; no second raw evidence archive. Filesystem snapshots/backups remain unresolved.
    await this.files.write(`${originalId}.json`, JSON.stringify(original));
    return corrected;
  }
  async recover(incidentId: string, proof: { replacementVerified: boolean; boundaryVerified: boolean; effectsReconciled: boolean;
    containmentComplete: boolean; explicitResume: boolean; freshSessionId: string }): Promise<void> {
    return this.serial(async () => {
      assertId(incidentId); assertId(proof.freshSessionId);
      const incident = this.#state.incidents.find(i => i.incidentId === incidentId);
      if (!incident || !proof.replacementVerified || !proof.boundaryVerified || !proof.effectsReconciled || !proof.containmentComplete ||
          !proof.explicitResume || this.#state.retiredSessions.includes(proof.freshSessionId)) throw new SecurityError('permission_denied');
      incident.state = 'recovered'; incident.coverage = 'complete';
      if (!this.#state.incidents.some(i => i.runId === incident.runId && i.state !== 'recovered')) {
        this.#state.fencedRuns = this.#state.fencedRuns.filter(id => id !== incident.runId);
      }
      try { await this.saveState(); } catch { await this.fence(incident); throw new SecurityError('capture_failed'); }
    });
  }
}

export class CaptureStream {
  #buffer?: Buffer; #bytes = 0; #omission?: Omission; #finished = false;
  constructor(private readonly owner: SafeRecording, private readonly meta: Envelope, private readonly format: 'text' | 'json') {
    if (excluded.includes(meta.source)) this.#omission = 'excluded_source';
  }
  push(chunk: Uint8Array): void {
    if (this.#finished) throw new SecurityError('invalid_input');
    if (this.#omission) return; // continue draining; never retain an unsafe prefix
    if (!(chunk instanceof Uint8Array)) { this.#buffer = undefined; this.#omission = 'unsupported_encoding'; return; }
    if (this.#bytes + chunk.byteLength > MAX_CAPTURE_BYTES) { this.#buffer = undefined; this.#omission = 'size_limit'; return; }
    this.#buffer ??= Buffer.alloc(MAX_CAPTURE_BYTES);
    this.#buffer.set(chunk, this.#bytes); this.#bytes += chunk.byteLength;
  }
  async finish(complete = true): Promise<SafeRecord> {
    if (this.#finished) throw new SecurityError('invalid_input'); this.#finished = true;
    let raw: unknown = null;
    if (!complete) this.#omission = 'incomplete_record';
    if (!this.#omission) {
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(this.#buffer?.subarray(0, this.#bytes) ?? new Uint8Array());
        raw = this.format === 'json' ? JSON.parse(text) : text;
      } catch { this.#omission = 'unsupported_encoding'; }
    }
    this.#buffer = undefined;
    return this.owner.capture(this.meta, raw, this.#omission);
  }
}
