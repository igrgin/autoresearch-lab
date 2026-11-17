import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import fsRuntime from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, mock, test } from 'node:test';
import { CheckpointSelection } from '../src/evaluation/checkpoints';
import type { CheckpointHost } from '../src/evaluation/checkpoints';
import type { Constraint, SelectionInputs, Snapshot, ValidationResult } from '../src/evaluation/contracts';
import { binary64, compare, decimal, encodeBinary64, rankingKey } from '../src/evaluation/numeric';
import { contextBody } from '../src/security/context';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-checkpoints-'));
after(() => fs.rmSync(temporary, { recursive: true, force: true }));
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
function fixture(extra: (inputs: SelectionInputs) => void = () => {}, hostOverride: Partial<CheckpointHost> = {}) {
  const directory = path.join(temporary, randomUUID());
  const metricId = randomUUID(), secondaryId = randomUUID(), measurementId = randomUUID();
  const inputs: SelectionInputs = {
    schemaVersion: 1, projectId: randomUUID(), runId: randomUUID(), attemptId: randomUUID(), role: 'candidate',
    snapshotId: randomUUID(), preparedManifestId: randomUUID(), testedCommit: '1'.repeat(40),
    modelConfigRef: randomUUID(), initializationRef: randomUUID(), processingRef: randomUUID(), softwareRef: randomUUID(),
    evaluationContextRef: randomUUID(), rankingPolicyRef: randomUUID(), metricRegistryRef: randomUUID(),
    metrics: [{ metricId, name: 'accuracy', direction: 'maximize', quantum: '0.000001' },
      { metricId: secondaryId, name: 'cross_entropy_nats', direction: 'minimize', quantum: '0.000001' }],
    rankingMetricIds: [metricId, secondaryId], constraints: [{ constraintId: randomUUID(), scope: 'checkpoint',
      source: { kind: 'count', measurementId }, operator: '<=', threshold: '1000000', definitionRef: randomUUID() }],
  };
  extra(inputs);
  // Controlled model adapter: load saved JSON state (including buffer) and check
  // shape and pinned software/model bindings. This is not a live PyTorch proof.
  const host: CheckpointHost = { verifyLoadable: (folder, snapshot, pinned) => {
    assert.equal(pinned.modelConfigRef, inputs.modelConfigRef);
    return snapshot.files.every(file => {
      const state = JSON.parse(fs.readFileSync(path.join(folder, file.name), 'utf8'));
      return Array.isArray(state.weights) && Array.isArray(state.buffers);
    });
  }, ...hostOverride };
  let service = CheckpointSelection.create(directory, inputs, host);
  function save(weights: number, shards = 1) {
    const files = Array.from({ length: shards }, (_, index) => {
      const bytes = JSON.stringify({ weights: [weights, index], buffers: [weights + 100] });
      const sourcePath = path.join(temporary, `${randomUUID()}.json`); fs.writeFileSync(sourcePath, bytes);
      return { sourcePath, size: Buffer.byteLength(bytes), sha256: hash(bytes) };
    });
    return { snapshot: service.saveSnapshot({ artifactId: randomUUID(), stateIncludes: 'weights_and_buffers', files }), files };
  }
  function result(snapshot: Snapshot, primary: number, secondary = .5, parameters = '900000'): ValidationResult {
    return { schemaVersion: 1, recordKind: 'validation_result', owner: 'protected_evaluation', evaluationId: randomUUID(), resultId: randomUUID(),
      projectId: inputs.projectId, runId: inputs.runId, attemptId: inputs.attemptId, role: inputs.role, snapshotId: inputs.snapshotId,
      preparedManifestId: inputs.preparedManifestId, testedCommit: inputs.testedCommit, modelConfigRef: inputs.modelConfigRef, metricRegistryRef: inputs.metricRegistryRef,
      artifactId: snapshot.artifactId, contentDigest: snapshot.contentDigest, checkpointSequence: snapshot.checkpointSequence,
      evaluationContextRef: inputs.evaluationContextRef, rankingPolicyRef: inputs.rankingPolicyRef, phase: 'periodic_validation',
      environmentRef: randomUUID(), validity: 'valid', coverage: { planned: '10', observed: '10', evidenceRef: randomUUID() },
      metrics: [{ metricId, bits: encodeBinary64(primary) }, { metricId: secondaryId, bits: encodeBinary64(secondary) }],
      counts: [{ measurementId, value: parameters, evidenceRef: randomUUID() }] };
  }
  return { directory, inputs, metricId, secondaryId, measurementId, host, save, result, get service() { return service; },
    reopen: () => { service = CheckpointSelection.reopen(directory, inputs, host); return service; } };
}
test('constraint-first selection preserves exact multi-shard weights/buffers and metric identity through restart', () => {
  const f = fixture(), good = f.save(1, 2), bad = f.save(2);
  const goodResult = f.result(good.snapshot, .84, .4);
  f.service.recordValidation(goodResult);
  f.service.recordValidation(f.result(bad.snapshot, .99, .1, '1000001'));
  fs.writeFileSync(good.files[0].sourcePath, 'trainer mutates its live state');
  const selected = f.reopen().finish();
  assert.equal(selected.status, 'selected'); assert.deepEqual(selected.selected?.result, goodResult);
  assert.equal(selected.checkpoints[1].assessment.status, 'ineligible');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.directory, 'selection.json'), 'utf8')).state.entries[0].rankingKeys, ['840000', '400000']);
  assert.equal(selected.next, 'final_validation_required');
  const handoff = f.service.finalEvaluationInput()!;
  assert.deepEqual(handoff.snapshot, good.snapshot); assert.equal(handoff.selectionResultId, goodResult.resultId);
  assert.deepEqual(handoff.inputs, f.inputs);
  for (const file of handoff.snapshot.files) {
    const bytes = fs.readFileSync(path.join(handoff.directory, file.name)); assert.equal(hash(bytes), file.sha256);
    const model = JSON.parse(bytes.toString()); assert.equal(model.weights[0], 1); assert.equal(model.buffers[0], 101);
  }
  assert.equal('accepted' in selected, false); assert.equal('finalResult' in selected, false);
  assert.throws(() => f.save(3), { code: 'conflict' });
});
test('secondary metrics decide primary ties, complete ties use sequence independent of arrival', () => {
  const f = fixture(), first = f.save(1).snapshot, second = f.save(2).snapshot, third = f.save(3).snapshot;
  f.service.recordValidation(f.result(third, .8, .49));
  assert.equal(f.service.selection().selected?.snapshot.artifactId, third.artifactId);
  f.service.recordValidation(f.result(first, .8, .5));
  f.service.recordValidation(f.result(second, .8000004, .49));
  assert.equal(f.service.finish().selected?.snapshot.artifactId, second.artifactId);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.service.finalEvaluationInput()!.directory, 'state-0.bin'), 'utf8')).weights[0], 2);
});
test('ordered secondaries use lexicographic directions with no implicit diagnostic tie breaker', () => {
  const thirdId = randomUUID();
  const f = fixture(inputs => {
    inputs.metrics.push({ metricId: thirdId, name: 'macro_f1', direction: 'maximize', quantum: '0.000001' });
    inputs.rankingMetricIds.push(thirdId);
  });
  const first = f.save(1).snapshot, second = f.save(2).snapshot, third = f.save(3).snapshot;
  for (const [snapshot, ce, f1] of [[first, .5, .8], [second, .5, .9], [third, .6, 1]] as const) {
    const result = f.result(snapshot, .8, ce); result.metrics.push({ metricId: thirdId, bits: encodeBinary64(f1) });
    f.service.recordValidation(result);
  }
  assert.equal(f.service.finish().selected?.snapshot.artifactId, second.artifactId);
});
test('no eligible checkpoint and empty training produce explicit null, never a fabricated model', () => {
  const f = fixture(); f.service.recordValidation(f.result(f.save(1).snapshot, .99, .1, '1000001'));
  const selection = f.service.finish();
  assert.equal(selection.status, 'no_eligible_checkpoint'); assert.equal(selection.selected, null);
  assert.equal(f.service.finalEvaluationInput(), null);
  const empty = fixture(inputs => { inputs.role = 'baseline'; });
  assert.equal(empty.service.finish().selected, null); assert.equal(empty.service.finalEvaluationInput(), null);
});
test('exact half-even keys, binary64 transport, sub-quantum ties and raw hard thresholds', () => {
  assert.equal(rankingKey(encodeBinary64(.125), '0.01'), '12');
  assert.equal(rankingKey(encodeBinary64(.375), '0.01'), '38');
  assert.equal(rankingKey(encodeBinary64(-.125), '0.01'), '-12');
  assert.equal(rankingKey(encodeBinary64(-.375), '0.01'), '-38');
  assert.equal(rankingKey(encodeBinary64(.8000004), '0.000001'), '800000');
  assert.equal(rankingKey(encodeBinary64(.8000006), '0.000001'), '800001');
  assert.equal(rankingKey(encodeBinary64(Number.MIN_VALUE), '0.000001'), '0');
  assert.equal(rankingKey(encodeBinary64(Number.MAX_VALUE), '1'), BigInt(Number.MAX_VALUE).toString());
  assert.equal(encodeBinary64(-0), '0000000000000000');
  assert.equal(compare(binary64(encodeBinary64(.8)), decimal('0.8')), 1); // binary64 .8 is slightly above exact decimal .8.
  for (const q of ['0', '-1', '0.03', 'NaN', '1e-6']) assert.throws(() => rankingKey(encodeBinary64(1), q));
  const f = fixture(inputs => inputs.constraints.push({ constraintId: randomUUID(), scope: 'checkpoint',
    source: { kind: 'metric', metricId: inputs.rankingMetricIds[0] }, threshold: '0.800000', operator: '>=', definitionRef: randomUUID() }));
  f.service.recordValidation(f.result(f.save(1).snapshot, .7999999));
  assert.equal(f.service.finish().checkpoints[0].assessment.status, 'ineligible');
});
test('invalid/non-finite/out-of-range/missing vectors and incomplete coverage cannot win', () => {
  const changes: ((result: ValidationResult) => void)[] = [
    result => { result.metrics[0].bits = '7ff8000000000000'; },
    result => { result.metrics[0].bits = '7ff0000000000000'; },
    result => { result.metrics[0].bits = 'fff0000000000000'; },
    result => { result.metrics[0].bits = encodeBinary64(1.01); },
    result => { result.metrics[1].bits = encodeBinary64(-.1); },
    result => { result.metrics.pop(); }, result => { result.counts = []; },
    result => { result.coverage.observed = '9'; }, result => { result.coverage.planned = result.coverage.observed = '0'; },
    result => { result.validity = 'invalid'; },
  ];
  for (const change of changes) {
    const f = fixture(), good = f.save(1).snapshot; f.service.recordValidation(f.result(good, .8));
    const invalid = f.result(f.save(2).snapshot, .99); change(invalid); f.service.recordValidation(invalid);
    const selected = f.service.finish(); assert.equal(selected.selected?.snapshot.artifactId, good.artifactId);
    assert.equal(selected.checkpoints[1].assessment.status, 'invalid');
  }
});
test('pending evaluations cannot finish, completed evidence is immutable and replay is idempotent', () => {
  const f = fixture(), saved = f.save(1), snapshot = saved.snapshot;
  assert.deepEqual(f.service.saveSnapshot({ artifactId: snapshot.artifactId, stateIncludes: 'weights_and_buffers', files: saved.files }), snapshot);
  assert.throws(() => f.service.saveSnapshot({ artifactId: snapshot.artifactId, stateIncludes: 'weights_and_buffers',
    files: saved.files.map(file => ({ ...file, sha256: '0'.repeat(64) })) }), { code: 'conflict' });
  assert.equal(f.service.selection().checkpoints[0].assessment.status, 'pending');
  assert.throws(() => f.service.finish(), { code: 'conflict' });
  assert.throws(() => f.service.finalEvaluationInput(), { code: 'conflict' });
  const result = f.result(snapshot, .8);
  const pending = structuredClone(result); pending.validity = 'pending'; assert.throws(() => f.service.recordValidation(pending), { code: 'invalid_input' });
  const selection = f.service.recordValidation(result);
  assert.deepEqual(f.service.recordValidation(result), selection);
  const conflicting = structuredClone(result); conflicting.metrics[0].bits = encodeBinary64(.9);
  assert.throws(() => f.service.recordValidation(conflicting), { code: 'conflict' });
  assert.deepEqual(f.reopen().finish().selected?.result, result);
});
test('unranked validation diagnostics do not break complete ties but can be explicit constraints', () => {
  for (const constrained of [false, true]) {
    const diagnosticId = randomUUID();
    const f = fixture(inputs => {
      inputs.metrics.push({ metricId: diagnosticId, name: 'macro_f1', direction: 'maximize', quantum: '0.000001' });
      if (constrained) inputs.constraints.push({ constraintId: randomUUID(), scope: 'checkpoint',
        source: { kind: 'metric', metricId: diagnosticId }, operator: '>=', threshold: '0.5', definitionRef: randomUUID() });
    });
    const first = f.save(1).snapshot, second = f.save(2).snapshot;
    for (const [snapshot, value] of [[first, .4], [second, .9]] as const) {
      const result = f.result(snapshot, .8); result.metrics.push({ metricId: diagnosticId, bits: encodeBinary64(value) });
      f.service.recordValidation(result);
    }
    assert.equal(f.service.finish().selected?.snapshot.artifactId, constrained ? second.artifactId : first.artifactId);
  }
});
test('all raw constraint operators and counts above binary64 integer precision remain exact', () => {
  for (const [operator, threshold, eligible] of [['<', '9007199254740993', false], ['<=', '9007199254740993', true],
    ['>', '9007199254740992', true], ['>=', '9007199254740994', false]] as const) {
    const f = fixture(inputs => { inputs.constraints[0].operator = operator; inputs.constraints[0].threshold = threshold; });
    f.service.recordValidation(f.result(f.save(1).snapshot, .8, .5, '9007199254740993'));
    assert.equal(f.service.finish().status, eligible ? 'selected' : 'no_eligible_checkpoint');
  }
});
test('attempt-wide evidence is required and its failure disqualifies every checkpoint', () => {
  const measurementId = randomUUID();
  const f = fixture(inputs => inputs.constraints.push({ constraintId: randomUUID(), scope: 'attempt',
    source: { kind: 'count', measurementId }, threshold: '100', operator: '<=', definitionRef: randomUUID() }));
  for (const value of [.8, .9]) f.service.recordValidation(f.result(f.save(value).snapshot, value));
  assert.equal(f.service.selection().selected, null);
  assert.equal(f.service.selection().checkpoints[0].assessment.reason, 'awaiting_attempt_evidence');
  assert.throws(() => f.service.finish(), { code: 'conflict' });
  f.service.completeAttempt({ evidenceId: randomUUID(), attemptId: f.inputs.attemptId, complete: true,
    counts: [{ measurementId, value: '101', evidenceRef: randomUUID() }] });
  const selected = f.reopen().finish(); assert.equal(selected.selected, null);
  assert.ok(selected.checkpoints.every(checkpoint => checkpoint.assessment.status === 'ineligible'));
});
test('missing completed attempt evidence is invalid, passing evidence enables selection', () => {
  for (const missing of [true, false]) {
    const measurementId = randomUUID();
    const f = fixture(inputs => inputs.constraints.push({ constraintId: randomUUID(), scope: 'attempt',
      source: { kind: 'count', measurementId }, threshold: '100', operator: '<=', definitionRef: randomUUID() }));
    const snapshot = f.save(1).snapshot; f.service.recordValidation(f.result(snapshot, .8));
    f.service.completeAttempt({ evidenceId: randomUUID(), attemptId: f.inputs.attemptId, complete: true,
      counts: missing ? [] : [{ measurementId, value: '100', evidenceRef: randomUUID() }] });
    const selected = f.service.finish(); assert.equal(selected.checkpoints[0].assessment.status, missing ? 'invalid' : 'eligible');
    assert.equal(selected.selected?.snapshot.artifactId ?? null, missing ? null : snapshot.artifactId);
  }
});
test('identity mismatches fence the whole attempt durably and preserve previous bytes', () => {
  for (const key of ['attemptId', 'evaluationContextRef', 'rankingPolicyRef', 'contentDigest', 'checkpointSequence'] as const) {
    const f = fixture(), first = f.save(1).snapshot; f.service.recordValidation(f.result(first, .8));
    const bad = f.result(f.save(2).snapshot, .99);
    if (key === 'checkpointSequence') bad[key]++; else bad[key] = key === 'contentDigest' ? '0'.repeat(64) : randomUUID();
    assert.throws(() => f.service.recordValidation(bad), { code: 'integrity_failure' });
    assert.throws(() => f.reopen().selection(), { code: 'integrity_failure' });
    assert.equal(hash(fs.readFileSync(path.join(f.directory, first.artifactId, 'state-0.bin'))), first.files[0].sha256);
  }
});
test('corrupt/incomplete/unloadable replacement never publishes or displaces safe selection', () => {
  const f = fixture(), first = f.save(1).snapshot; f.service.recordValidation(f.result(first, .8));
  const sourcePath = path.join(temporary, randomUUID()); fs.writeFileSync(sourcePath, 'partial');
  for (const file of [{ sourcePath, size: 100, sha256: hash('partial') }, { sourcePath, size: 7, sha256: hash('different') },
    { sourcePath, size: 7, sha256: hash('partial') }]) {
    assert.throws(() => f.service.saveSnapshot({ artifactId: randomUUID(), stateIncludes: 'weights_and_buffers', files: [file] }));
    assert.equal(f.reopen().selection().selected?.snapshot.artifactId, first.artifactId);
    assert.equal(f.service.selection().checkpoints.length, 1);
  }
});
test('corruption between capture and evaluation publication preserves the prior durable selection', () => {
  const f = fixture(), first = f.save(1).snapshot; f.service.recordValidation(f.result(first, .8));
  const second = f.save(2).snapshot;
  fs.writeFileSync(path.join(f.directory, second.artifactId, 'state-0.bin'), 'corrupt');
  assert.throws(() => f.service.recordValidation(f.result(second, .99)), { code: 'integrity_failure' });
  const restored = f.reopen().selection();
  assert.equal(restored.selected?.snapshot.artifactId, first.artifactId);
  assert.equal(restored.checkpoints[1].assessment.status, 'pending');
  const invalid = f.result(second, .99); invalid.validity = 'invalid';
  f.service.recordValidation(invalid);
  assert.equal(f.service.finish().selected?.snapshot.artifactId, first.artifactId);
});
test('an invalid evaluation of missing weights can finish honestly with no selected model', () => {
  const f = fixture(), snapshot = f.save(1).snapshot;
  fs.unlinkSync(path.join(f.directory, snapshot.artifactId, 'state-0.bin'));
  const invalid = f.result(snapshot, .9); invalid.validity = 'invalid';
  f.service.recordValidation(invalid);
  assert.equal(f.reopen().finish().status, 'no_eligible_checkpoint');
  assert.equal(f.service.finalEvaluationInput(), null);
});
test('missing or corrupt selected bytes fail explicitly without switching to another score', () => {
  for (const missing of [false, true]) {
    const f = fixture(), first = f.save(1).snapshot; f.service.recordValidation(f.result(first, .9));
    f.service.recordValidation(f.result(f.save(2).snapshot, .8));
    const file = path.join(f.directory, first.artifactId, 'state-0.bin');
    if (missing) fs.unlinkSync(file); else fs.writeFileSync(file, 'corrupt');
    assert.throws(() => f.reopen().finish(), { code: 'integrity_failure' });
    assert.ok(fs.readFileSync(path.join(f.directory, 'selection.json'), 'utf8').includes(first.artifactId));
  }
});
test('space preflight preserves old selection and does not begin copying', () => {
  const f = fixture(), first = f.save(1).snapshot; f.service.recordValidation(f.result(first, .8));
  f.host.reserveBytes = Number.MAX_SAFE_INTEGER;
  assert.throws(() => f.save(2), { code: 'insufficient_space' });
  assert.equal(f.reopen().selection().selected?.snapshot.artifactId, first.artifactId);
  assert.equal(fs.readdirSync(f.directory).filter(name => name !== 'selection.json').length, 1);
});
test('partial shards and orphan directories after interruption are never usable models', () => {
  const f = fixture(), first = f.save(1).snapshot; f.service.recordValidation(f.result(first, .8));
  const orphan = path.join(f.directory, randomUUID()); fs.mkdirSync(orphan, 0o700); fs.writeFileSync(path.join(orphan, 'state-0.bin'), 'partial');
  fs.writeFileSync(path.join(f.directory, 'unpublished.tmp'), 'partial selection');
  assert.equal(f.reopen().selection().selected?.snapshot.artifactId, first.artifactId);
  const next = f.save(3).snapshot; assert.equal(next.checkpointSequence, 2);
  const invalid = f.result(next, .99); invalid.validity = 'invalid'; f.service.recordValidation(invalid);
  assert.equal(f.service.finish().selected?.snapshot.artifactId, first.artifactId);
});
test('copy failure halfway through shards keeps the old selection and leaves the replacement unpublished', () => {
  const f = fixture(), first = f.save(1).snapshot; f.service.recordValidation(f.result(first, .8));
  const copy = fsRuntime.copyFileSync; let copies = 0;
  const injected = mock.method(fsRuntime, 'copyFileSync', (...args: Parameters<typeof copy>) => {
    if (++copies === 2) throw new Error('synthetic disk failure');
    copy(...args);
  });
  try { assert.throws(() => f.save(2, 2), { code: 'storage_unavailable' }); }
  finally { injected.mock.restore(); }
  assert.equal(copies, 2);
  const restored = f.reopen().finish(); assert.equal(restored.selected?.snapshot.artifactId, first.artifactId);
  assert.equal(restored.checkpoints.length, 1);
});
test('failed atomic result publication fences the writer and recovers the prior selection without deleting weights', () => {
  const f = fixture(), first = f.save(1).snapshot; f.service.recordValidation(f.result(first, .8));
  const second = f.save(2).snapshot, result = f.result(second, .99);
  const injected = mock.method(fsRuntime, 'renameSync', () => { throw new Error('synthetic disk failure'); });
  try { assert.throws(() => f.service.recordValidation(result), { code: 'storage_unavailable' }); }
  finally { injected.mock.restore(); }
  assert.throws(() => f.service.selection(), { code: 'integrity_failure' });
  const restored = f.reopen().selection(); assert.equal(restored.selected?.snapshot.artifactId, first.artifactId);
  assert.equal(restored.checkpoints[1].assessment.status, 'pending');
  assert.equal(hash(fs.readFileSync(path.join(f.directory, first.artifactId, 'state-0.bin'))), first.files[0].sha256);
  assert.equal(f.service.recordValidation(result).selected?.snapshot.artifactId, second.artifactId);
});
test('state corruption, incompatible policy and symlinks fail without resetting evidence', () => {
  const f = fixture(), snapshot = f.save(1).snapshot; f.service.recordValidation(f.result(snapshot, .8));
  const bytes = fs.readFileSync(path.join(f.directory, 'selection.json'));
  const changed = structuredClone(f.inputs); changed.metrics[0].quantum = '0.01';
  assert.throws(() => CheckpointSelection.reopen(f.directory, changed, f.host), { code: 'integrity_failure' });
  fs.writeFileSync(path.join(f.directory, 'selection.json'), bytes.toString().replace('900000', '900001'));
  assert.throws(() => f.reopen(), { code: 'integrity_failure' });
  fs.writeFileSync(path.join(f.directory, 'selection.json'), bytes);
  const file = path.join(f.directory, snapshot.artifactId, 'state-0.bin'); fs.unlinkSync(file);
  fs.symlinkSync(path.join(f.directory, 'selection.json'), file);
  assert.throws(() => f.reopen().selection(), { code: 'integrity_failure' });
});
test('separate test results/data cannot rank, enter persisted selection or agent context', () => {
  const f = fixture(), first = f.save(1).snapshot; const result = f.result(first, .8);
  const before = fs.readFileSync(path.join(f.directory, 'selection.json'));
  for (const injected of [{ ...result, phase: 'test_assessment' }, { ...result, testScore: .999 },
    { ...result, metrics: [...result.metrics, { metricId: randomUUID(), bits: encodeBinary64(.999) }] }]) {
    assert.throws(() => f.service.recordValidation(injected as ValidationResult));
    assert.deepEqual(fs.readFileSync(path.join(f.directory, 'selection.json')), before);
  }
  f.service.recordValidation(result);
  const final = f.service.finish(); assert.equal(final.selected?.snapshot.artifactId, first.artifactId);
  assert.ok(!JSON.stringify(final).includes('testScore'));
  assert.throws(() => contextBody('test_assessment', { value: .999 }));
  assert.throws(() => contextBody('validation', { evaluationId: result.evaluationId, metricId: f.metricId, split: 'test', value: .999 }));
  assert.throws(() => contextBody('validation', { evaluationId: result.evaluationId, metricId: f.metricId, split: 'validation', value: .8, testScore: .999 }));
  const projection = { evaluationId: result.evaluationId, metricId: f.metricId, split: 'validation', value: .8 };
  assert.deepEqual(contextBody('validation', projection), projection);
});
test('policies reject duplicate priorities, unsupported metrics, invalid directions and test-dependent constraints', () => {
  const changes: ((inputs: SelectionInputs) => void)[] = [
    inputs => inputs.rankingMetricIds.push(inputs.rankingMetricIds[0]),
    inputs => { inputs.metrics[0].direction = 'minimize'; },
    inputs => { inputs.metrics[0].name = 'test_accuracy' as 'accuracy'; },
    inputs => { inputs.constraints[0] = { ...inputs.constraints[0], source: { kind: 'test', metricId: randomUUID() } } as unknown as Constraint; },
    inputs => { inputs.rankingMetricIds = []; },
  ];
  for (const change of changes) assert.throws(() => fixture(change), { code: 'invalid_input' });
});

test('sealed checkpoint state reconciles identical artifact, result and attempt evidence after reopen without mutation', () => {
  const f = fixture(), saved = f.save(1), result = f.result(saved.snapshot, .8);
  const request = { artifactId: saved.snapshot.artifactId, stateIncludes: 'weights_and_buffers' as const, files: saved.files };
  const evidence = { evidenceId: randomUUID(), attemptId: f.inputs.attemptId, complete: true, counts: [] };
  f.service.recordValidation(result); f.service.completeAttempt(evidence); const sealed = f.service.finish();
  const persisted = fs.readFileSync(path.join(f.directory, 'selection.json'));
  for (const service of [f.service, f.reopen()]) {
    // Reconciliation reads the durable package even if trainer source is gone.
    for (const file of saved.files) fs.rmSync(file.sourcePath, { force: true });
    assert.deepEqual(service.saveSnapshot(request), saved.snapshot);
    assert.deepEqual(service.recordValidation(result), sealed);
    assert.deepEqual(service.completeAttempt(evidence), sealed);
    assert.throws(() => service.saveSnapshot({ ...request, artifactId: randomUUID() }), { code: 'conflict' });
    assert.throws(() => service.saveSnapshot({ ...request, files: request.files.map(file => ({ ...file, sha256: '0'.repeat(64) })) }), { code: 'conflict' });
    assert.throws(() => service.recordValidation({ ...result, resultId: randomUUID(), evaluationId: randomUUID() }), { code: 'conflict' });
    assert.throws(() => service.recordValidation({ ...result, metrics: result.metrics.map(metric => ({ ...metric, bits: encodeBinary64(.9) })) }), { code: 'conflict' });
    assert.throws(() => service.completeAttempt({ ...evidence, evidenceId: randomUUID() }), { code: 'conflict' });
    assert.deepEqual(service.selection(), sealed);
    assert.deepEqual(fs.readFileSync(path.join(f.directory, 'selection.json')), persisted);
  }
  // Sealing never makes replay bypass saved-artifact integrity or an existing fence.
  const handoff = f.service.finalEvaluationInput()!; fs.writeFileSync(path.join(handoff.directory, 'state-0.bin'), 'corrupt');
  assert.throws(() => f.service.saveSnapshot(request), { code: 'integrity_failure' });
  assert.throws(() => f.service.recordValidation(result), { code: 'integrity_failure' });
  assert.throws(() => f.service.completeAttempt(evidence), { code: 'conflict' });
});

test('reconstructed immutable input objects ignore key insertion order while retaining actual policy and ranking order', () => {
  const f = fixture(), saved = f.save(1); f.service.recordValidation(f.result(saved.snapshot, .8));
  const expected = f.service.finish();
  function reordered(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(reordered);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reordered(item)]));
    return value;
  }
  const equivalent = reordered(f.inputs) as SelectionInputs;
  assert.notEqual(JSON.stringify(equivalent), JSON.stringify(f.inputs));
  assert.deepEqual(CheckpointSelection.reopen(f.directory, equivalent, f.host).selection(), expected);
  for (const mutate of [
    (inputs: SelectionInputs) => { inputs.rankingMetricIds.reverse(); },
    (inputs: SelectionInputs) => { inputs.metrics[0].quantum = '0.00001'; },
    (inputs: SelectionInputs) => { inputs.modelConfigRef = randomUUID(); },
    (inputs: SelectionInputs) => { inputs.constraints[0].threshold = '999999'; },
  ]) {
    const changed = structuredClone(equivalent); mutate(changed);
    assert.throws(() => CheckpointSelection.reopen(f.directory, changed, f.host), { code: 'integrity_failure' });
  }
});

for (const damage of ['missing', 'corrupt'] as const) test(`completed attempt replay survives ${damage} losing weights while preserving selected-artifact checks`, () => {
  const f = fixture(), losing = f.save(1).snapshot, winner = f.save(2).snapshot;
  f.service.recordValidation(f.result(losing, .8)); f.service.recordValidation(f.result(winner, .9));
  const evidence = { evidenceId: randomUUID(), attemptId: f.inputs.attemptId, complete: true, counts: [] };
  f.service.completeAttempt(evidence); const sealed = f.service.finish();
  const persisted = fs.readFileSync(path.join(f.directory, 'selection.json'));
  const damageFile = (snapshot: Snapshot) => {
    const file = path.join(f.directory, snapshot.artifactId, 'state-0.bin');
    if (damage === 'missing') fs.unlinkSync(file); else fs.writeFileSync(file, 'corrupt');
  };
  damageFile(losing);
  for (const service of [f.service, f.reopen()]) {
    assert.deepEqual(service.selection(), sealed);
    assert.equal(service.finalEvaluationInput()?.snapshot.artifactId, winner.artifactId);
    assert.throws(() => service.completeAttempt({ ...evidence, evidenceId: randomUUID() }), { code: 'conflict' });
    assert.deepEqual(service.completeAttempt(evidence), sealed);
    assert.deepEqual(fs.readFileSync(path.join(f.directory, 'selection.json')), persisted);
  }
  damageFile(winner);
  assert.throws(() => f.reopen().completeAttempt(evidence), { code: 'integrity_failure' });
  assert.deepEqual(fs.readFileSync(path.join(f.directory, 'selection.json')), persisted);
});
