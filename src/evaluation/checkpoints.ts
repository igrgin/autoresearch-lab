import { constants, closeSync, copyFileSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, readSync, renameSync, statfsSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { assess, digest, exact, id, normalizeResult, validateCounts, validateInputs } from './contracts';
import type { AttemptEvidence, CheckpointAssessment, SelectionInputs, Snapshot, ValidationResult } from './contracts';
import { CheckpointError, requireValue } from './numeric';

export interface SnapshotRequest {
  artifactId: string; stateIncludes: 'weights_and_buffers';
  files: { sourcePath: string; size: number; sha256: string }[];
}
interface Entry { snapshot: Snapshot; result?: ValidationResult; rankingKeys?: string[] }
interface State {
  schemaVersion: 1; inputs: SelectionInputs; revision: number; entries: Entry[];
  attemptEvidence?: AttemptEvidence; sealed: boolean; invalidated: boolean;
}
export type Selection = {
  schemaVersion: 1; recordKind: 'checkpoint_selection'; owner: 'protected_evaluation';
  projectId: string; runId: string; attemptId: string; revision: number;
  inputs: SelectionInputs;
  status: 'selected' | 'no_eligible_checkpoint';
  selected: { snapshot: Snapshot; result: ValidationResult } | null;
  checkpoints: { artifactId: string; checkpointSequence: number; resultId: string | null; assessment: CheckpointAssessment }[];
  // This is a periodic-selection handoff, never a final result or acceptance.
  next: 'final_validation_required' | 'no_eligible_checkpoint';
};
export interface CheckpointHost {
  // Trusted preparation/model adapter must load saved files in a clean model and
  // confirm all weights/buffers and matching inputs. No candidate callback.
  verifyLoadable(directory: string, snapshot: Snapshot, inputs: SelectionInputs): boolean;
  // Host may reserve additional space; filesystem free-space checking is mandatory.
  reserveBytes?: number;
}
function hash(bytes: Buffer | string): string { return createHash('sha256').update(bytes).digest('hex'); }
function syncDirectory(directory: string): void {
  const fd = openSync(directory, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function privateDirectory(directory: string, create: boolean): void {
  if (create) mkdirSync(directory, { mode: 0o700 });
  const info = lstatSync(directory);
  requireValue(info.isDirectory() && !info.isSymbolicLink() && info.uid === process.getuid?.() && !(info.mode & 0o077), 'integrity_failure');
}
function fileDigest(file: string, size: number): string {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = fstatSync(fd); requireValue(info.isFile() && info.size === size, 'integrity_failure');
    const hasher = createHash('sha256'), chunk = Buffer.alloc(1024 * 1024);
    let bytes;
    while ((bytes = readSync(fd, chunk, 0, chunk.length, null))) hasher.update(chunk.subarray(0, bytes));
    return hasher.digest('hex');
  } finally { closeSync(fd); }
}
function readState(directory: string): State {
  const file = path.join(directory, 'selection.json');
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = fstatSync(fd); requireValue(info.isFile() && info.size <= 16 * 1024 * 1024, 'integrity_failure');
    const envelope = JSON.parse(readFileSync(fd, 'utf8')) as { state: State; sha256: string };
    exact(envelope, ['state', 'sha256']);
    requireValue(hash(JSON.stringify(envelope.state)) === envelope.sha256, 'integrity_failure');
    return envelope.state;
  } finally { closeSync(fd); }
}
function publish(directory: string, state: State): void {
  const temporary = path.join(directory, `${randomUUID()}.tmp`);
  let fd;
  try {
    const bytes = JSON.stringify({ state, sha256: hash(JSON.stringify(state)) });
    requireValue(Buffer.byteLength(bytes) <= 16 * 1024 * 1024, 'storage_unavailable');
    fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    writeFileSync(fd, bytes); fsyncSync(fd); closeSync(fd); fd = undefined;
    renameSync(temporary, path.join(directory, 'selection.json')); syncDirectory(directory);
  } finally { if (fd !== undefined) closeSync(fd); if (existsSync(temporary)) unlinkSync(temporary); }
}

// Owned by the utility coordinator/protected evaluator. The caller supplies an
// exclusive, private attempt directory outside the candidate workspace. This
// service writes no registry/project DB and exposes no renderer IPC or raw SQL.
// All operations are synchronous under the existing single-writer coordinator.
export class CheckpointSelection {
  private state: State;
  private fenced = false;
  private constructor(private readonly directory: string, private readonly host: CheckpointHost, state: State) { this.state = state; }

  static create(directory: string, inputs: SelectionInputs, host: CheckpointHost): CheckpointSelection {
    validateInputs(inputs);
    requireValue(typeof host.verifyLoadable === 'function');
    const state: State = { schemaVersion: 1, inputs: structuredClone(inputs), revision: 0, entries: [], sealed: false, invalidated: false };
    try {
      privateDirectory(directory, true); publish(directory, state);
      return new CheckpointSelection(directory, host, state);
    } catch (error) { throw error instanceof CheckpointError ? error : new CheckpointError('storage_unavailable'); }
  }
  static reopen(directory: string, inputs: SelectionInputs, host: CheckpointHost): CheckpointSelection {
    validateInputs(inputs); requireValue(typeof host.verifyLoadable === 'function');
    try {
      privateDirectory(directory, false);
      const state = readState(directory);
      validateInputs(state.inputs);
      requireValue(state.schemaVersion === 1 && isDeepStrictEqual(state.inputs, inputs), 'integrity_failure');
      exact(state, ['schemaVersion', 'inputs', 'revision', 'entries', 'sealed', 'invalidated', ...(state.attemptEvidence ? ['attemptEvidence'] : [])]);
      requireValue(Number.isSafeInteger(state.revision) && state.revision >= 0 && Array.isArray(state.entries) && typeof state.sealed === 'boolean' && typeof state.invalidated === 'boolean', 'integrity_failure');
      const service = new CheckpointSelection(directory, host, state);
      const artifacts = new Set<string>(), evaluations = new Set<string>(), results = new Set<string>();
      for (const [index, entry] of state.entries.entries()) {
        exact(entry, ['snapshot', ...(entry.result ? ['result', 'rankingKeys'] : [])]);
        service.validateSnapshot(entry.snapshot); requireValue(entry.snapshot.checkpointSequence === index + 1, 'integrity_failure');
        requireValue(!artifacts.has(entry.snapshot.artifactId), 'integrity_failure'); artifacts.add(entry.snapshot.artifactId);
        if (entry.result) {
          normalizeResult(entry.result); service.join(entry.snapshot, entry.result);
          requireValue(JSON.stringify(entry.rankingKeys) === JSON.stringify(assess(inputs, entry.result).keys), 'integrity_failure');
          requireValue(!evaluations.has(entry.result.evaluationId) && !results.has(entry.result.resultId), 'integrity_failure');
          evaluations.add(entry.result.evaluationId); results.add(entry.result.resultId);
        }
      }
      if (state.attemptEvidence) service.validateAttemptEvidence(state.attemptEvidence);
      return service;
    } catch { throw new CheckpointError('integrity_failure'); }
  }
  private available(): void { requireValue(!this.fenced && !this.state.invalidated, 'conflict'); }
  private active(): void { this.available(); requireValue(!this.state.sealed, 'conflict'); }
  private commit(next: State): void {
    next.revision++;
    try { publish(this.directory, next); this.state = next; }
    catch { this.fenced = true; throw new CheckpointError('storage_unavailable'); }
  }
  private artifactDirectory(snapshot: Snapshot): string { return path.join(this.directory, snapshot.artifactId); }
  private validateSnapshot(snapshot: Snapshot): void {
    exact(snapshot, ['artifactId', 'checkpointSequence', 'contentDigest', 'files', 'stateIncludes']);
    id(snapshot.artifactId); digest(snapshot.contentDigest);
    requireValue(Number.isSafeInteger(snapshot.checkpointSequence) && snapshot.checkpointSequence > 0);
    requireValue(snapshot.stateIncludes === 'weights_and_buffers' && Array.isArray(snapshot.files) && snapshot.files.length > 0 && snapshot.files.length <= 1024);
    for (const [index, file] of snapshot.files.entries()) {
      exact(file, ['name', 'size', 'sha256']); requireValue(file.name === `state-${index}.bin` && Number.isSafeInteger(file.size) && file.size > 0); digest(file.sha256);
    }
    requireValue(hash(JSON.stringify({ stateIncludes: snapshot.stateIncludes, files: snapshot.files })) === snapshot.contentDigest, 'integrity_failure');
  }
  private verify(snapshot: Snapshot): void {
    const directory = this.artifactDirectory(snapshot); privateDirectory(directory, false);
    for (const file of snapshot.files) requireValue(fileDigest(path.join(directory, file.name), file.size) === file.sha256, 'integrity_failure');
    requireValue(this.host.verifyLoadable(directory, structuredClone(snapshot), structuredClone(this.state.inputs)) === true, 'integrity_failure');
    // Load verification must not have altered the published state.
    for (const file of snapshot.files) requireValue(fileDigest(path.join(directory, file.name), file.size) === file.sha256, 'integrity_failure');
  }
  saveSnapshot(request: SnapshotRequest): Snapshot {
    this.available(); exact(request, ['artifactId', 'stateIncludes', 'files']); id(request.artifactId);
    const existing = this.state.entries.find(entry => entry.snapshot.artifactId === request.artifactId);
    requireValue(Array.isArray(request.files) && request.files.length > 0 && request.files.length <= 1024);
    for (const file of request.files) {
      exact(file, ['sourcePath', 'size', 'sha256']);
      requireValue(typeof file.sourcePath === 'string' && path.isAbsolute(file.sourcePath));
    }
    const snapshot: Snapshot = { artifactId: request.artifactId, checkpointSequence: existing?.snapshot.checkpointSequence ?? this.state.entries.length + 1,
      stateIncludes: request.stateIncludes, files: request.files.map((file, index) => ({ name: `state-${index}.bin`, size: file.size, sha256: file.sha256 })), contentDigest: '' };
    snapshot.contentDigest = hash(JSON.stringify({ stateIncludes: snapshot.stateIncludes, files: snapshot.files }));
    this.validateSnapshot(snapshot);
    if (existing) {
      requireValue(JSON.stringify(existing.snapshot) === JSON.stringify(snapshot), 'conflict');
      try { this.verify(existing.snapshot); } catch { throw new CheckpointError('integrity_failure'); }
      return structuredClone(existing.snapshot);
    }
    this.active();
    try {
      const space = statfsSync(this.directory, { bigint: true });
      const bytes = snapshot.files.reduce((sum, file) => sum + BigInt(file.size), 0n);
      const reserve = this.host.reserveBytes ?? 1024 * 1024;
      requireValue(Number.isSafeInteger(reserve) && reserve >= 0);
      // Old models are already allocated and never removed to make room. Budget
      // two replacement copies plus metadata/reserve before the first copy.
      requireValue(space.bavail * space.bsize >= bytes * 2n + BigInt(reserve), 'insufficient_space');
      const directory = this.artifactDirectory(snapshot); privateDirectory(directory, true);
      for (const [index, file] of request.files.entries()) {
        requireValue(fileDigest(file.sourcePath, file.size) === file.sha256, 'integrity_failure');
        const destination = path.join(directory, snapshot.files[index].name);
        copyFileSync(file.sourcePath, destination, constants.COPYFILE_EXCL);
        const fd = openSync(destination, constants.O_RDONLY | constants.O_NOFOLLOW);
        try { fsyncSync(fd); } finally { closeSync(fd); }
      }
      this.verify(snapshot); syncDirectory(directory); syncDirectory(this.directory);
      const next = structuredClone(this.state); next.entries.push({ snapshot }); this.commit(next);
      return structuredClone(snapshot);
    } catch (error) {
      // Interrupted/partial artifacts are deliberately left unreferenced. Neither
      // the old selection nor its bytes are touched; retry uses a fresh ID.
      throw error instanceof CheckpointError ? error : new CheckpointError('storage_unavailable');
    }
  }
  private join(snapshot: Snapshot, result: ValidationResult): void {
    const inputs = this.state.inputs;
    for (const key of ['projectId', 'runId', 'attemptId', 'role', 'snapshotId', 'preparedManifestId', 'testedCommit', 'modelConfigRef',
      'metricRegistryRef', 'evaluationContextRef', 'rankingPolicyRef'] as const) requireValue(result[key] === inputs[key], 'integrity_failure');
    requireValue(result.artifactId === snapshot.artifactId && result.contentDigest === snapshot.contentDigest && result.checkpointSequence === snapshot.checkpointSequence, 'integrity_failure');
  }
  recordValidation(input: ValidationResult): Selection {
    this.available();
    const result = normalizeResult(structuredClone(input));
    requireValue(result.validity !== 'pending'); // Completion publishes a new immutable result; absence stays pending in the snapshot record.
    requireValue(result.metrics.every(entry => this.state.inputs.metrics.some(metric => metric.metricId === entry.metricId)));
    const existing = this.state.entries.find(entry => entry.result?.resultId === result.resultId || entry.result?.evaluationId === result.evaluationId);
    if (existing) { requireValue(isDeepStrictEqual(existing.result, result), 'conflict'); return this.selection(); }
    this.active();
    const entry = this.state.entries.find(entry => entry.snapshot.artifactId === result.artifactId); requireValue(entry);
    try { this.join(entry.snapshot, result); }
    catch (error) {
      const next = structuredClone(this.state); next.invalidated = true; this.commit(next);
      throw error; // Changed input identity invalidates the attempt durably, not just this checkpoint.
    }
    requireValue(!entry.result, 'conflict');
    // Recheck at publication, not only at snapshot capture: training or a failed
    // transfer may have altered bytes while protected evaluation was running.
    // A bad replacement never changes the durable prior selection.
    if (result.validity === 'valid') {
      try { this.verify(entry.snapshot); }
      catch { throw new CheckpointError('integrity_failure'); }
    }
    const next = structuredClone(this.state), target = next.entries.find(item => item.snapshot.artifactId === result.artifactId)!;
    target.result = result; target.rankingKeys = assess(this.state.inputs, result).keys;
    this.commit(next); return this.selection();
  }
  private validateAttemptEvidence(evidence: AttemptEvidence): void {
    exact(evidence, ['evidenceId', 'attemptId', 'complete', 'counts']); id(evidence.evidenceId); id(evidence.attemptId);
    requireValue(evidence.attemptId === this.state.inputs.attemptId && typeof evidence.complete === 'boolean'); validateCounts(evidence.counts);
  }
  completeAttempt(evidence: AttemptEvidence): Selection {
    this.available(); this.validateAttemptEvidence(evidence); requireValue(evidence.complete);
    if (this.state.attemptEvidence) {
      requireValue(isDeepStrictEqual(evidence, this.state.attemptEvidence), 'conflict');
      // Recorded evidence survives loss/cleanup of non-winning weights. The
      // current selection still verifies the chosen package and existing fences.
      return this.selection();
    }
    this.active();
    // Completed attempt evidence can make an earlier checkpoint eligible; prove
    // those saved bytes again before publishing the completed evidence.
    for (const entry of this.state.entries) {
      if (assess(this.state.inputs, entry.result, evidence).status === 'eligible') {
        try { this.verify(entry.snapshot); } catch { throw new CheckpointError('integrity_failure'); }
      }
    }
    const next = structuredClone(this.state); next.attemptEvidence = structuredClone(evidence); this.commit(next);
    return this.selection();
  }
  selection(): Selection {
    requireValue(!this.fenced && !this.state.invalidated, 'integrity_failure');
    const { inputs } = this.state;
    const checkpoints = this.state.entries.map(entry => ({ artifactId: entry.snapshot.artifactId, checkpointSequence: entry.snapshot.checkpointSequence,
      resultId: entry.result?.resultId ?? null, assessment: assess(inputs, entry.result, this.state.attemptEvidence) }));
    let selectedIndex = -1;
    for (const [index, checkpoint] of checkpoints.entries()) {
      if (checkpoint.assessment.status !== 'eligible') continue;
      if (selectedIndex < 0) { selectedIndex = index; continue; }
      const previous = checkpoints[selectedIndex];
      for (const [position, metricId] of inputs.rankingMetricIds.entries()) {
        const key = BigInt(checkpoint.assessment.keys[position]), prior = BigInt(previous.assessment.keys[position]);
        if (key === prior) continue;
        const direction = inputs.metrics.find(metric => metric.metricId === metricId)!.direction;
        if (direction === 'maximize' ? key > prior : key < prior) selectedIndex = index;
        break;
      }
      // Entries are persisted in trusted creation order; complete ties keep earliest.
    }
    const entry = this.state.entries[selectedIndex];
    if (entry) {
      try { this.verify(entry.snapshot); }
      catch { this.fenced = true; throw new CheckpointError('integrity_failure'); }
    }
    return structuredClone({ schemaVersion: 1, recordKind: 'checkpoint_selection', owner: 'protected_evaluation',
      projectId: inputs.projectId, runId: inputs.runId, attemptId: inputs.attemptId, inputs, revision: this.state.revision,
      status: entry ? 'selected' : 'no_eligible_checkpoint', selected: entry ? { snapshot: entry.snapshot, result: entry.result! } : null,
      checkpoints, next: entry ? 'final_validation_required' : 'no_eligible_checkpoint' });
  }
  finish(): Selection {
    if (this.state.sealed) return this.selection();
    this.active();
    requireValue(this.state.entries.every(entry => entry.result && entry.result.validity !== 'pending'), 'conflict');
    if (this.state.inputs.constraints.some(constraint => constraint.scope === 'attempt')) requireValue(this.state.attemptEvidence?.complete, 'conflict');
    const selection = this.selection();
    const next = structuredClone(this.state); next.sealed = true; this.commit(next);
    return { ...selection, revision: this.state.revision };
  }
  // The evaluator receives only a verified saved package, never live trainer state.
  finalEvaluationInput(): { inputs: SelectionInputs; snapshot: Snapshot; selectionResultId: string; directory: string } | null {
    requireValue(this.state.sealed, 'conflict'); const selection = this.selection();
    if (!selection.selected) return null;
    return { inputs: structuredClone(this.state.inputs), snapshot: selection.selected.snapshot,
      selectionResultId: selection.selected.result.resultId, directory: this.artifactDirectory(selection.selected.snapshot) };
  }
}
