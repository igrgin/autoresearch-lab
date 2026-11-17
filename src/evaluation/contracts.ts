import { binary64, compare, decimal, normalizeBits, rankingKey, requireValue } from './numeric';

export const METRICS = {
  accuracy: ['maximize', true], macro_f1: ['maximize', true], cross_entropy_nats: ['minimize', false],
  mae: ['minimize', false], mse: ['minimize', false], rmse: ['minimize', false],
  token_nll_nats: ['minimize', false], token_accuracy: ['maximize', true],
} as const;
export interface Metric {
  metricId: string; name: keyof typeof METRICS; direction: 'maximize' | 'minimize'; quantum: string;
}
export interface Constraint {
  constraintId: string; scope: 'checkpoint' | 'attempt';
  source: { kind: 'metric'; metricId: string } | { kind: 'count'; measurementId: string };
  operator: '<' | '<=' | '>' | '>='; threshold: string; definitionRef: string;
}
export interface SelectionInputs {
  schemaVersion: 1; projectId: string; runId: string; attemptId: string; role: 'baseline' | 'candidate';
  snapshotId: string; preparedManifestId: string; testedCommit: string; modelConfigRef: string;
  initializationRef: string; processingRef: string; softwareRef: string;
  evaluationContextRef: string; rankingPolicyRef: string; metricRegistryRef: string;
  metrics: Metric[]; rankingMetricIds: string[]; constraints: Constraint[];
}
export interface StateFile { name: string; size: number; sha256: string }
export interface Snapshot {
  artifactId: string; checkpointSequence: number; contentDigest: string; files: StateFile[];
  stateIncludes: 'weights_and_buffers';
}
export interface ValidationResult {
  schemaVersion: 1; recordKind: 'validation_result'; owner: 'protected_evaluation';
  evaluationId: string; resultId: string; projectId: string; runId: string; attemptId: string; role: 'baseline' | 'candidate';
  snapshotId: string; preparedManifestId: string; testedCommit: string; modelConfigRef: string; metricRegistryRef: string;
  artifactId: string; contentDigest: string; checkpointSequence: number;
  evaluationContextRef: string; rankingPolicyRef: string; phase: 'periodic_validation';
  environmentRef: string; coverage: { planned: string; observed: string; evidenceRef: string };
  validity: 'pending' | 'invalid' | 'valid';
  metrics: { metricId: string; bits: string }[];
  counts: { measurementId: string; value: string; evidenceRef: string }[];
}
export interface AttemptEvidence {
  evidenceId: string; attemptId: string; complete: boolean;
  counts: { measurementId: string; value: string; evidenceRef: string }[];
}
export interface CheckpointAssessment {
  status: 'pending' | 'invalid' | 'ineligible' | 'eligible';
  reason: 'awaiting_evaluation' | 'invalid_validation' | 'constraint_failed' | 'awaiting_attempt_evidence' | 'eligible';
  keys: string[]; constraints: { constraintId: string; evidenceRef: string; satisfied: boolean }[];
}
export function id(value: unknown): asserts value is string {
  requireValue(typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value));
}
export function exact(value: object, keys: string[]): void {
  requireValue(!!value && typeof value === 'object' && !Array.isArray(value));
  requireValue(Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)));
}
export function count(value: string): bigint {
  requireValue(typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value) && value.length <= 400);
  return BigInt(value);
}
export function digest(value: string): void { requireValue(typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)); }
function unique(values: string[]): void { requireValue(new Set(values).size === values.length); }
export function validateInputs(inputs: SelectionInputs): void {
  exact(inputs, ['schemaVersion', 'projectId', 'runId', 'attemptId', 'role', 'snapshotId', 'preparedManifestId',
    'testedCommit', 'modelConfigRef', 'initializationRef', 'processingRef', 'softwareRef', 'evaluationContextRef',
    'rankingPolicyRef', 'metricRegistryRef', 'metrics', 'rankingMetricIds', 'constraints']);
  requireValue(inputs.schemaVersion === 1 && ['baseline', 'candidate'].includes(inputs.role));
  for (const key of ['projectId', 'runId', 'attemptId', 'snapshotId', 'preparedManifestId', 'modelConfigRef',
    'initializationRef', 'processingRef', 'softwareRef', 'evaluationContextRef', 'rankingPolicyRef', 'metricRegistryRef'] as const) id(inputs[key]);
  requireValue(/^[0-9a-f]{40}$/.test(inputs.testedCommit));
  requireValue(Array.isArray(inputs.metrics) && inputs.metrics.length > 0 && inputs.metrics.length <= 8);
  for (const metric of inputs.metrics) {
    exact(metric, ['metricId', 'name', 'direction', 'quantum']); id(metric.metricId);
    requireValue(Object.hasOwn(METRICS, metric.name) && metric.direction === METRICS[metric.name][0]);
    rankingKey('0000000000000000', metric.quantum);
  }
  unique(inputs.metrics.map(metric => metric.metricId)); unique(inputs.metrics.map(metric => metric.name));
  requireValue(Array.isArray(inputs.rankingMetricIds) && inputs.rankingMetricIds.length > 0);
  unique(inputs.rankingMetricIds);
  for (const metricId of inputs.rankingMetricIds) requireValue(inputs.metrics.some(metric => metric.metricId === metricId));
  requireValue(Array.isArray(inputs.constraints) && inputs.constraints.length <= 100);
  for (const constraint of inputs.constraints) {
    exact(constraint, ['constraintId', 'scope', 'source', 'operator', 'threshold', 'definitionRef']);
    id(constraint.constraintId); id(constraint.definitionRef);
    requireValue(['checkpoint', 'attempt'].includes(constraint.scope) && ['<', '<=', '>', '>='].includes(constraint.operator));
    decimal(constraint.threshold);
    if (constraint.source.kind === 'metric') {
      exact(constraint.source, ['kind', 'metricId']); id(constraint.source.metricId);
      const metricId = constraint.source.metricId;
      requireValue(constraint.scope === 'checkpoint' && inputs.metrics.some(metric => metric.metricId === metricId));
    } else {
      exact(constraint.source, ['kind', 'measurementId']); requireValue(constraint.source.kind === 'count'); id(constraint.source.measurementId);
    }
  }
  unique(inputs.constraints.map(constraint => constraint.constraintId));
}
export function validateCounts(counts: ValidationResult['counts']): void {
  requireValue(Array.isArray(counts) && counts.length <= 100);
  for (const entry of counts) {
    exact(entry, ['measurementId', 'value', 'evidenceRef']); id(entry.measurementId); id(entry.evidenceRef); count(entry.value);
  }
  unique(counts.map(entry => entry.measurementId));
}
export function normalizeResult(result: ValidationResult): ValidationResult {
  exact(result, ['schemaVersion', 'recordKind', 'owner', 'evaluationId', 'resultId', 'projectId', 'runId', 'attemptId', 'role',
    'snapshotId', 'preparedManifestId', 'testedCommit', 'modelConfigRef', 'metricRegistryRef', 'artifactId', 'contentDigest', 'checkpointSequence',
    'evaluationContextRef', 'rankingPolicyRef', 'phase', 'environmentRef', 'coverage', 'validity', 'metrics', 'counts']);
  requireValue(result.schemaVersion === 1 && result.recordKind === 'validation_result' && result.owner === 'protected_evaluation' && result.phase === 'periodic_validation');
  requireValue(['baseline', 'candidate'].includes(result.role) && /^[0-9a-f]{40}$/.test(result.testedCommit));
  for (const key of ['evaluationId', 'resultId', 'projectId', 'runId', 'attemptId', 'snapshotId', 'preparedManifestId', 'modelConfigRef',
    'metricRegistryRef', 'artifactId', 'evaluationContextRef', 'rankingPolicyRef', 'environmentRef'] as const) id(result[key]);
  digest(result.contentDigest); requireValue(Number.isSafeInteger(result.checkpointSequence) && result.checkpointSequence > 0);
  exact(result.coverage, ['planned', 'observed', 'evidenceRef']); id(result.coverage.evidenceRef); count(result.coverage.planned); count(result.coverage.observed);
  requireValue(['valid', 'invalid', 'pending'].includes(result.validity));
  requireValue(Array.isArray(result.metrics) && result.metrics.length <= 8);
  for (const metric of result.metrics) {
    exact(metric, ['metricId', 'bits']); id(metric.metricId);
    // Preserve non-finite bits as invalid evidence; they can never enter ranking.
    requireValue(typeof metric.bits === 'string' && /^[0-9a-f]{16}$/.test(metric.bits));
    if (metric.bits === '8000000000000000') metric.bits = normalizeBits(metric.bits);
  }
  unique(result.metrics.map(metric => metric.metricId)); validateCounts(result.counts);
  return result;
}
export function assess(inputs: SelectionInputs, result?: ValidationResult, attempt?: AttemptEvidence): CheckpointAssessment {
  const answer: CheckpointAssessment = { status: 'pending', reason: 'awaiting_evaluation', keys: [], constraints: [] };
  if (!result || result.validity === 'pending') return answer;
  answer.status = 'invalid'; answer.reason = 'invalid_validation';
  if (result.validity !== 'valid' || count(result.coverage.planned) === 0n || result.coverage.planned !== result.coverage.observed) return answer;
  try {
    for (const supplied of result.metrics) requireValue(inputs.metrics.some(metric => metric.metricId === supplied.metricId));
    const required = new Set([...inputs.rankingMetricIds, ...inputs.constraints.flatMap(c => c.source.kind === 'metric' ? [c.source.metricId] : [])]);
    for (const metric of inputs.metrics.filter(metric => required.has(metric.metricId))) {
      const bits = result.metrics.find(entry => entry.metricId === metric.metricId)?.bits;
      requireValue(bits !== undefined);
      const value = binary64(bits);
      requireValue(compare(value, decimal('0')) >= 0 && (!METRICS[metric.name][1] || compare(value, decimal('1')) <= 0));
    }
    answer.keys = inputs.rankingMetricIds.map(metricId => rankingKey(result.metrics.find(entry => entry.metricId === metricId)!.bits,
      inputs.metrics.find(metric => metric.metricId === metricId)!.quantum));
    let pendingAttempt = false;
    for (const constraint of inputs.constraints) {
      if (constraint.scope === 'attempt' && (!attempt || !attempt.complete)) { pendingAttempt = true; continue; }
      let value, evidenceRef;
      const source = constraint.source;
      if (source.kind === 'metric') {
        const entry = result.metrics.find(entry => entry.metricId === source.metricId); requireValue(entry);
        value = binary64(entry.bits); evidenceRef = result.resultId;
      } else {
        const entry = (constraint.scope === 'attempt' ? attempt?.counts : result.counts)?.find(entry => entry.measurementId === source.measurementId);
        requireValue(entry); value = { numerator: count(entry.value), denominator: 1n }; evidenceRef = entry.evidenceRef;
      }
      const order = compare(value, decimal(constraint.threshold));
      const satisfied = constraint.operator === '<' ? order < 0 : constraint.operator === '<=' ? order <= 0 : constraint.operator === '>' ? order > 0 : order >= 0;
      answer.constraints.push({ constraintId: constraint.constraintId, evidenceRef, satisfied });
    }
    if (answer.constraints.some(entry => !entry.satisfied)) { answer.status = 'ineligible'; answer.reason = 'constraint_failed'; }
    else if (pendingAttempt) { answer.status = 'pending'; answer.reason = 'awaiting_attempt_evidence'; }
    else { answer.status = 'eligible'; answer.reason = 'eligible'; }
  } catch { answer.status = 'invalid'; answer.reason = 'invalid_validation'; answer.keys = []; }
  return answer;
}
