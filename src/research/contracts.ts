import { assertId, SecurityError } from '../security/common';
import type { SafeValue } from '../security/sanitizer';

export const RETENTION_V1 = Object.freeze({ version: 1, bodyBytes: 64 * 1024, bodyHeadBytes: 32 * 1024,
  bucketBytes: 16 * 1024 * 1024, bucketHeadBytes: 4 * 1024 * 1024,
  runBytes: 256 * 1024 * 1024, queueBytes: 4 * 1024 * 1024, previewBytes: 1024 });
export type Owner = 'configuration' | 'preparation' | 'coordinator' | 'execution' | 'evaluation' | 'stopping' | 'agent' | 'artifacts';
export interface RecordBase { id: string; revision: number; schemaVersion: 1 }
export type Fact = RecordBase & (
  | { kind: 'run'; snapshotId: string; settings: {
    objectiveRef: string; dataRef: string; splitsRef: string; evaluationContextRef: string; metricPolicyRef: string;
    initializationRef: string; environmentRef: string; agentRef: string; durationRef: string; stoppingRef: string;
    codeSourceCommit: string; resolved: SafeValue } }
  | { kind: 'run_state'; state: 'ready' | 'active' | 'pausing' | 'stopping' | 'finishing' | 'paused' | 'reconciling' | 'completed'; phase: string; reason: string; branch: string; workDirectoryRef: string }
  | { kind: 'inputs'; snapshotId: string; evaluationContextRef: string; initializationRef: string;
    dataRef: string; splitsRef: string; environmentRef: string; processingRef: string; digest: string; resolved: SafeValue }
  | { kind: 'candidate'; testedCommit: string; acceptedBaseCommit: string; comparatorResultId: string;
    hypothesis: string; description: string }
  | { kind: 'attempt'; role: 'baseline' | 'candidate'; candidateId: string | null; snapshotId: string; manifestId: string;
    testedCommit: string; treeDigest: string; reservationId: string; hardwareId: string; actionId: string; protocolRef: string }
  | { kind: 'outcome'; attemptId: string; status: 'completed' | 'failed' | 'interrupted'; evidenceId: string; explanation: string }
  | { kind: 'evaluation'; attemptId: string; testedCommit: string; checkpointId: string; evaluationContextRef: string;
    validity: 'valid' | 'invalid' | 'pending'; eligible: boolean | null; metrics: Metric[]; constraints: {constraintId:string;evidenceId:string;satisfied:boolean|null;reason:string|null}[]; explanation: string }
  | { kind: 'sample'; attemptId: string; metric: Metric; phase: 'training' | 'periodic_validation'; step: number; sourceTime: string | null }
  | { kind: 'assessment'; attemptId: string; evaluationId: string; checkpointId: string; metrics: Metric[]; explanation: string }
  | { kind: 'decision'; attemptId: string; resultId: string | null; comparatorResultId: string | null;
    comparatorCommit: string | null; policyRef: string; previousDecisionEventId: string | null;
    status: 'pending' | 'kept' | 'discarded' | 'not_applicable' | 'baseline_established'; explanation: string }
  | { kind: 'counters'; attemptCount: number; baselineCount: number; stagnationCount: number; policyRef: string }
  | { kind: 'hardware'; reservationId: string; provider: string; resourceId: string; gpuIds: string[]; environmentRef: string; details: SafeValue }
  | { kind: 'action'; phase: 'preparation' | 'proposal' | 'repair'; integration: string; model: string; status: string; details: SafeValue }
  | { kind: 'control'; command: 'pause' | 'finish' | 'stop' | 'resume'; disposition: 'requested' | 'superseded' | 'applied' | 'unknown' | 'already_terminal'; supersededBy: string | null; explanation: string }
  | { kind: 'artifact'; attemptId: string; checkpointId: string; availability: 'retained' | 'remote_only' | 'transfer_pending' | 'removed' | 'missing' | 'unrecoverable'; details: SafeValue }
  | { kind: 'activity'; attemptId: string | null; actionId: string; channel: 'research' | 'assessment'; source: string;
    type: string; status: string; sourceTime: string | null; detail: string | null }
  | { kind: 'unsupported'; originalKind: string; payload: SafeValue }
  | { kind: 'gap'; attemptId: string | null; actionId: string | null; streamId: string | null;
    cause: 'body_cap' | 'bucket_cap' | 'run_cap' | 'queue_overflow' | 'collector_error' | 'redaction_omission' | 'unavailable_source';
    sequenceFrom: number | null; sequenceTo: number | null; byteFrom: number | null; byteTo: number | null;
    droppedBytes: number | null; droppedEvents: number | null; lastSuccessfulAt: string | null;
    recovery: 'pending' | 'recovered' | 'permanently_unavailable' }
);
export interface Metric {
  metricId: string; definitionRef: string; split: 'training' | 'validation' | 'test'; unit: string;
  direction: 'maximize' | 'minimize'; value: number | null; validity: 'valid' | 'missing' | 'invalid'; reason: string | null;
}
export interface ResearchEvent {
  contractVersion: { major: number; minor: number }; eventId: string; producerId: string; streamId: string; sequence: number;
  projectId: string; runId: string; operationId: string; actionId: string;
  observedAt: string | null; causedBy: string[]; fact: Fact;
}
export const OWNERS: Record<Fact['kind'], Owner> = {
  run_state: 'coordinator', unsupported: 'execution', run: 'configuration', inputs: 'preparation', candidate: 'coordinator', attempt: 'execution', outcome: 'execution',
  evaluation: 'evaluation', sample: 'evaluation', assessment: 'evaluation', decision: 'coordinator', counters: 'stopping',
  hardware: 'execution', action: 'agent', control: 'coordinator', artifact: 'artifacts', activity: 'agent', gap: 'agent',
};
const commit = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const digest = /^sha256:[a-f0-9]{64}$/;
const integer = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
function invalid(): never { throw new SecurityError('invalid_input'); }
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) invalid();
  return v as Record<string, unknown>;
}
function time(v: unknown) { if (v !== null && (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(v) || !Number.isFinite(Date.parse(v)))) invalid(); }
function metrics(v: unknown) {
  if (!Array.isArray(v)) invalid();
  for (const m of v) {
    const value = object(m); exact(value, ['metricId','definitionRef','split','unit','direction','value','validity','reason']);
    assertId(value.metricId); assertId(value.definitionRef);
    if (!['training','validation','test'].includes(String(value.split)) || !['maximize','minimize'].includes(String(value.direction)) ||
      !['valid','missing','invalid'].includes(String(value.validity)) || typeof value.unit !== 'string' ||
      (value.reason !== null && typeof value.reason !== 'string') ||
      (value.validity === 'valid' ? typeof value.value !== 'number' || !Number.isFinite(value.value) : value.value !== null)) invalid();
  }
}
function exact(o: Record<string, unknown>, keys: string[]) {
  if (Object.keys(o).sort().join(',') !== keys.sort().join(',')) invalid();
}
const fields: Record<Fact['kind'], string[]> = {
  run_state: ['state','phase','reason','branch','workDirectoryRef'], unsupported: ['originalKind','payload'], run: ['snapshotId','settings'], inputs: ['snapshotId','evaluationContextRef','initializationRef','dataRef','splitsRef','environmentRef','processingRef','digest','resolved'],
  candidate: ['testedCommit','acceptedBaseCommit','comparatorResultId','hypothesis','description'],
  attempt: ['role','candidateId','snapshotId','manifestId','testedCommit','treeDigest','reservationId','hardwareId','actionId','protocolRef'],
  outcome: ['attemptId','status','evidenceId','explanation'], evaluation: ['attemptId','testedCommit','checkpointId','evaluationContextRef','validity','eligible','metrics','constraints','explanation'],
  sample: ['attemptId','metric','phase','step','sourceTime'], assessment: ['attemptId','evaluationId','checkpointId','metrics','explanation'],
  decision: ['attemptId','resultId','comparatorResultId','comparatorCommit','policyRef','previousDecisionEventId','status','explanation'],
  counters: ['attemptCount','baselineCount','stagnationCount','policyRef'], hardware: ['reservationId','provider','resourceId','gpuIds','environmentRef','details'],
  action: ['phase','integration','model','status','details'], control: ['command','disposition','supersededBy','explanation'],
  artifact: ['attemptId','checkpointId','availability','details'], activity: ['attemptId','actionId','channel','source','type','status','sourceTime','detail'],
  gap: ['attemptId','actionId','streamId','cause','sequenceFrom','sequenceTo','byteFrom','byteTo','droppedBytes','droppedEvents','lastSuccessfulAt','recovery'],
};
export function validateEvent(input: ResearchEvent, owner: Owner): void {
  if(!Object.values(OWNERS).includes(owner)) invalid();
  const e = object(input); exact(e, ['contractVersion','eventId','producerId','streamId','sequence','projectId','runId','operationId','actionId','observedAt','causedBy','fact']);
  for (const key of ['eventId','producerId','streamId','projectId','runId','operationId','actionId']) assertId(e[key]);
  const version = object(e.contractVersion); exact(version, ['major','minor']);
  if (!integer(version.major) || !integer(version.minor) || !integer(e.sequence)) invalid();
  time(e.observedAt);
  if (!Array.isArray(e.causedBy)) invalid(); e.causedBy.forEach(assertId);
  const f = object(e.fact); if (!Object.hasOwn(fields, String(f.kind))) invalid();
  const kind = f.kind as Fact['kind']; exact(f, ['kind','id','revision','schemaVersion',...fields[kind]]);
  assertId(f.id); if (f.schemaVersion!==1) invalid(); if (!integer(f.revision) || (f.revision as number) < 1 || (kind !== 'unsupported' && OWNERS[kind] !== owner)) invalid();
  for (const [key,value] of Object.entries(f)) {
    if ((key.endsWith('Id') && key !== 'resourceId') || key.endsWith('Ref') || key === 'supersededBy') {
      const nullable=(key==='candidateId' && kind==='attempt') || (['attemptId','actionId','streamId'].includes(key) && kind==='gap') || (key==='attemptId' && kind==='activity') || (['resultId','comparatorResultId','previousDecisionEventId'].includes(key) && kind==='decision') || (key==='supersededBy' && kind==='control');
      if(value!==null || !nullable) assertId(value);
    }
    if (key.endsWith('Commit') && !(key==='comparatorCommit' && kind==='decision' && value===null) && (typeof value !== 'string' || !commit.test(value))) invalid();
    if (['originalKind','hypothesis','description','explanation','provider','resourceId','integration','model','source','type'].includes(key) && typeof value !== 'string') invalid();
  }
  if (kind === 'run') {
    const settings = object(f.settings);
    exact(settings, ['objectiveRef','dataRef','splitsRef','evaluationContextRef','metricPolicyRef','initializationRef','environmentRef','agentRef','durationRef','stoppingRef','codeSourceCommit','resolved']);
    for (const [k,v] of Object.entries(settings)) if (k.endsWith('Ref')) assertId(v);
    if (typeof settings.codeSourceCommit !== 'string' || !commit.test(settings.codeSourceCommit)) invalid();
  }
  if ((kind === 'inputs' && !digest.test(String(f.digest))) || (kind === 'attempt' && !digest.test(String(f.treeDigest)))) invalid();
  const enums: Partial<Record<Fact['kind'], Record<string, string[]>>> = {
    run_state: {state:['ready','active','pausing','stopping','finishing','paused','reconciling','completed']}, attempt: { role: ['baseline','candidate'] }, outcome: { status: ['completed','failed','interrupted'] },
    evaluation: { validity: ['valid','invalid','pending'] }, sample: { phase: ['training','periodic_validation'] },
    decision: { status: ['pending','kept','discarded','not_applicable','baseline_established'] },
    action: { phase: ['preparation','proposal','repair'] }, control: { command: ['pause','finish','stop','resume'], disposition: ['requested','superseded','applied','unknown','already_terminal'] },
    artifact: { availability: ['retained','remote_only','transfer_pending','removed','missing','unrecoverable'] },
    activity: { channel: ['research','assessment'] }, gap: { cause: ['body_cap','bucket_cap','run_cap','queue_overflow','collector_error','redaction_omission','unavailable_source'], recovery: ['pending','recovered','permanently_unavailable'] },
  };
  for (const [key, values] of Object.entries(enums[kind] ?? {})) if (!values.includes(String(f[key]))) invalid();
  if (kind === 'attempt' && ((f.role === 'baseline') !== (f.candidateId === null))) invalid();
  if (kind === 'run_state' && ['phase','reason','branch'].some(k=>typeof f[k]!=='string')) invalid();
  // 1.1 adds an evidence-linked pending-to-final revision; 1.0 finals stay valid.
  if (kind === 'evaluation' && f.revision !== 1 && (version.major !== 1 || (version.minor as number) < 1)) invalid();
  if (kind === 'evaluation') {
    if(!Array.isArray(f.constraints)) invalid();
    for(const c of f.constraints) { const constraint=object(c); exact(constraint,['constraintId','evidenceId','satisfied','reason']); assertId(constraint.constraintId);assertId(constraint.evidenceId);if(constraint.satisfied!==null && typeof constraint.satisfied!=='boolean')invalid();if(constraint.reason!==null && typeof constraint.reason!=='string')invalid(); }
  }
  if (kind === 'evaluation' && f.eligible !== null && typeof f.eligible !== 'boolean') invalid();
  if (kind === 'evaluation' || kind === 'assessment') {
    metrics(f.metrics);
    if ((f.metrics as Metric[]).some(m => kind === 'assessment' ? m.split !== 'test' : m.split !== 'validation')) invalid();
  }
  if (kind === 'sample') { metrics([f.metric]); if ((f.metric as Metric).split === 'test' || !integer(f.step)) invalid(); time(f.sourceTime); }
  if (kind === 'counters') for (const k of ['attemptCount','baselineCount','stagnationCount']) if (!integer(f[k])) invalid();
  if (kind === 'hardware') { if (!Array.isArray(f.gpuIds) || !f.gpuIds.every(v => typeof v === 'string')) invalid(); }
  if (['activity','action'].includes(kind) && typeof f.status!=='string') invalid();
  if (kind === 'activity') { time(f.sourceTime); if (f.detail !== null && typeof f.detail !== 'string') invalid(); }
  if (kind === 'gap') {
    for (const k of ['sequenceFrom','sequenceTo','byteFrom','byteTo','droppedBytes','droppedEvents']) if (f[k] !== null && !integer(f[k])) invalid();
    if(f.sequenceFrom!==null && f.sequenceTo!==null && (f.sequenceFrom as number)>(f.sequenceTo as number)) invalid();
    if(f.byteFrom!==null && f.byteTo!==null && (f.byteFrom as number)>(f.byteTo as number)) invalid();
    time(f.lastSuccessfulAt);
  }
  if (['run','inputs','candidate','attempt','outcome','sample','assessment','hardware','action','activity'].includes(kind) && f.revision !== 1) invalid();
}
