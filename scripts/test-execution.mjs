import assert from 'node:assert/strict';
import { execFileSync, fork, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';

const build = await mkdtemp(path.join(os.tmpdir(), 'lab-execution-'));
execFileSync('node_modules/.bin/tsc', ['--noEmit', 'false', '--rootDir', '.', '--outDir', build], { stdio: 'pipe' });
const require = createRequire(import.meta.url);
const { PHASES, ExecutionBounds, defaultBoundPolicy, ContactAuthority } = require(path.join(build, 'src/execution/bounds.js'));
const { ExecutionGuardian } = require(path.join(build, 'src/execution/guardian.js'));
const { guardianJournal } = require(path.join(build, 'src/execution/journal.js'));
const { launchGuardian } = require(path.join(build, 'src/execution/client.js'));
const { CgroupScope, linuxBootClock } = require(path.join(build, 'src/execution/cgroup.js'));
const directories = [build];
const children = new Set();
const fixturePids = new Set();
after(async () => {
  for (const child of children) child.kill('SIGKILL');
  for (const pid of fixturePids) { try { process.kill(pid, 'SIGKILL'); } catch { /* already stopped */ } }
  for (const directory of directories) await rm(directory, { recursive: true, force: true });
});
const policy = () => ({ version: 1, phaseMs: Object.fromEntries(PHASES.map(p => [p, 100])),
  attemptMs: 1000, trainingMs: 100, cancellationMs: 20, supervisorMs: 500 });
const identity = () => ({ projectId: randomUUID(), runId: randomUUID(), supervisorIncarnationId: randomUUID(), attemptId: randomUUID(), reservationId: randomUUID() });
const at = ms => ({ bootId: 'boot-a', ms });
function fixture(p = policy(), parent = p.attemptMs) {
  let now = at(0); let empty = false; let observable = true; let seal = true; let failSave = false;
  const calls = []; const records = [];
  const scope = { seal: () => { calls.push('seal'); return seal; }, cancel: phase => calls.push(`cancel:${phase}`),
    kill: () => calls.push('kill'), empty: () => observable ? empty : 'unknown' };
  const training = { ...scope, seal: () => { calls.push('training-seal'); return seal; }, kill: () => { calls.push('training-kill'); empty = true; } };
  const bounds = new ExecutionBounds(p, now, parent);
  const guardian = new ExecutionGuardian(bounds, scope, () => now, r => { if (failSave) throw new Error('synthetic-private-platform-detail'); records.push(r); }, '0:1', training);
  return { bounds, guardian, records, calls, scope, training,
    time: ms => { now = at(ms); guardian.tick(); }, now: () => now,
    setEmpty: value => { empty = value; }, setObservable: value => { observable = value; },
    setSeal: value => { seal = value; }, failSave: () => { failSave = true; } };
}

test('shipped profile resolves every positive finite bound without altering configured training duration', () => {
  const p = defaultBoundPolicy(300000);
  assert.equal(p.trainingMs, 300000); assert.equal(p.phaseMs.compilation, 300000);
  assert.equal(Object.keys(p.phaseMs).length, PHASES.length);
  for (const invalid of [0, -1, NaN, Infinity, 0.5]) assert.throws(() => defaultBoundPolicy(invalid));
  for (const phase of PHASES) {
    const bad = policy(); delete bad.phaseMs[phase]; assert.throws(() => new ExecutionBounds(bad, at(0)));
  }
});
for (const phase of PHASES) test(`hung ${phase} expires with actual phase/bound and fences every owned participant`, () => {
  const f = fixture(); f.guardian.phase(phase, phase === 'periodic_validation' ? randomUUID() : undefined);
  f.time(100);
  if (['compilation', 'training', 'periodic_validation'].includes(phase)) {
    assert.equal(f.guardian.record().trainingCutoff.receipt.phase, phase);
    f.time(110); assert.ok(f.calls.includes('training-kill')); f.time(111);
    assert.equal(f.guardian.record().bounds.phase, 'final_evaluation');
    assert.equal(f.guardian.record().trainingCutoff.state, 'confirmed_stopped');
    return;
  }
  assert.equal(f.guardian.record().receipt.phase, phase); assert.equal(f.guardian.record().receipt.reason, 'phase_deadline');
  assert.equal(f.guardian.record().reservation, 'retain'); f.time(110); assert.ok(f.calls.includes('kill'));
  f.setEmpty(true); f.time(111); assert.equal(f.guardian.record().state, 'confirmed_stopped');
  assert.equal(f.guardian.record().reservation, 'quiescence_evidence_available');
});
test('compilation/validation share inclusive training clock; only stopped training permits finite evaluation and finalization', () => {
  const f = fixture(); f.guardian.phase('compilation');
  f.time(30); f.guardian.phase('training'); f.time(70); f.guardian.phase('periodic_validation', randomUUID());
  assert.equal(f.bounds.snapshot().trainingDeadlineMs, 100);
  assert.throws(() => f.guardian.phase('final_evaluation'));
  f.time(100); f.time(110); f.time(111);
  assert.equal(f.guardian.record().state, 'armed');
  assert.throws(() => f.guardian.phase('training'));
  f.time(150); f.guardian.phase('publication'); f.time(200); f.guardian.phase('cleanup'); f.setEmpty(false);
  f.time(300); assert.equal(f.guardian.record().receipt.phase, 'cleanup');
  assert.equal(f.guardian.record().receipt.reason, 'phase_deadline');
});
test('phase retry, progress inspections, transitions and restored snapshots cannot reset parent/outer deadlines', () => {
  const p = policy(); p.phaseMs.preparation = 900; p.phaseMs.agent = 900; p.phaseMs.tool = 900;
  const b = new ExecutionBounds(p, at(0), 400); b.enter('agent', at(10));
  for (const time of [100, 200, 300]) { b.inspect(at(time)); b.enter('agent', at(time)); b.enter('tool', at(time)); }
  assert.equal(b.snapshot().deadlines.agent, 400); assert.equal(b.snapshot().outerDeadlineMs, 1000);
  const restored = ExecutionBounds.restore(JSON.parse(JSON.stringify(b.snapshot())), at(399));
  assert.equal(restored.inspect(at(400)).reason, 'parent_deadline');
  assert.throws(() => restored.enter('repair', at(401)));
  const altered = b.snapshot(); altered.outerDeadlineMs++; assert.throws(() => ExecutionBounds.restore(altered, at(399)));
});
test('PR112-F01 distinct periodic validation calls get finite deadlines under the original training clock', () => {
  const b = new ExecutionBounds(defaultBoundPolicy(1800000), at(0));
  const first = randomUUID(); const second = randomUUID();
  b.enter('training', at(0));
  assert.equal(b.enter('periodic_validation', at(60000), first), 360000);
  b.enter('training', at(120000));
  assert.equal(b.enter('periodic_validation', at(420000), second), 720000);
  assert.equal(b.snapshot().trainingDeadlineMs, 1800000);
  assert.equal(b.snapshot().receipt, undefined);
});
test('validation retry/reentry and durable restore retain call deadlines; expired replay fences rather than renews', () => {
  const b = new ExecutionBounds(defaultBoundPolicy(1800000), at(0));
  const first = randomUUID(); const second = randomUUID();
  b.enter('training', at(0)); b.enter('periodic_validation', at(60000), first);
  assert.equal(b.enter('periodic_validation', at(90000), first), 360000);
  b.enter('training', at(120000));
  assert.equal(b.enter('periodic_validation', at(180000), first), 360000);
  b.enter('training', at(200000));
  const restored = ExecutionBounds.restore(JSON.parse(JSON.stringify(b.snapshot())), at(420000));
  assert.equal(restored.enter('periodic_validation', at(420000), second), 720000);
  assert.throws(() => restored.enter('periodic_validation', at(420001), first), { code: 'deadline_exceeded' });
  assert.equal(restored.snapshot().receipt.deadlineMs, 360000);
  assert.throws(() => restored.enter('periodic_validation', at(420002), randomUUID()));
  const active = new ExecutionBounds(defaultBoundPolicy(1800000), at(0));
  active.enter('periodic_validation', at(0), first);
  assert.throws(() => active.enter('periodic_validation', at(300000), second));
  assert.equal(active.snapshot().validationCalls[second], undefined);
});
test('each validation call stays capped by the inclusive training, attempt and recovery-parent deadlines', () => {
  for (const [trainingMs, attemptMs, parent, cap, reason] of [[1000, 2000, 2000, 1000, 'training_deadline'],
    [2000, 1000, 2000, 1000, 'attempt_deadline'], [2000, 3000, 900, 900, 'parent_deadline']]) {
    const p = policy(); p.trainingMs = trainingMs; p.attemptMs = attemptMs;
    p.phaseMs.training = 5000; p.phaseMs.periodic_validation = 5000;
    const b = new ExecutionBounds(p, at(0), parent); b.enter('training', at(0));
    const id = randomUUID(); assert.equal(b.enter('periodic_validation', at(100), id), cap);
    const restored = ExecutionBounds.restore(b.snapshot(), at(cap - 1));
    assert.equal(restored.enter('periodic_validation', at(cap - 1), id), cap);
    assert.equal(restored.inspect(at(cap)).reason, reason);
  }
});
test('malformed validation identities and persisted call state fail closed without minting a new call', () => {
  const b = new ExecutionBounds(defaultBoundPolicy(1800000), at(0)); const id = randomUUID();
  for (const invalid of [undefined, null, '', 'a'.repeat(36), '__proto__', 1, {}, id.toUpperCase()]) {
    assert.throws(() => b.enter('periodic_validation', at(0), invalid), { code: 'invalid_input' });
  }
  assert.throws(() => b.enter('training', at(0), id), { code: 'invalid_input' });
  assert.deepEqual(b.snapshot().validationCalls, {});
  b.enter('periodic_validation', at(0), id);
  const mutations = [s => { s.version = 1; }, s => { delete s.validationCalls; }, s => { s.validationCalls = []; },
    s => { delete s.validationCallId; }, s => { s.validationCallId = randomUUID(); },
    s => { s.validationCalls[id].deadlineMs++; }, s => { s.validationCalls[id].startMs = -1; },
    s => { s.validationCalls[id].extra = true; }, s => { s.validationCalls.bad = s.validationCalls[id]; },
    s => { s.deadlines.periodic_validation = 300000; }, s => { s.phase = 'training'; s.deadlines.training = 1800000; }];
  for (const mutate of mutations) { const s = b.snapshot(); mutate(s); assert.throws(() => ExecutionBounds.restore(s, at(1))); }
});
test('PR112-F02 restored unfinished training cutoff immediately enforces original escalation', () => {
  let now = at(0); let empty = false; const calls = [];
  const scope = { seal: () => true, cancel: () => {}, kill: () => calls.push('kill'), empty: () => empty };
  const training = { ...scope, kill: () => calls.push('training-kill') };
  const b = new ExecutionBounds(policy(), now);
  const g = new ExecutionGuardian(b, scope, () => now, () => {}, '0:1', training);
  g.phase('training'); now = at(100); g.tick(); const record = g.record();
  assert.equal(record.trainingCutoff.cancellationDeadlineMs, 120);
  now = at(119);
  const restored = new ExecutionGuardian(ExecutionBounds.restore(record.bounds, now), scope, () => now, () => {}, '0:1', training, record);
  assert.ok(calls.includes('training-kill'));
  assert.ok(calls.includes('kill'));
  assert.equal(restored.record().cancellationDeadlineMs, 120);
  now = at(121); restored.tick();
  assert.equal(restored.record().state, 'unknown'); assert.equal(restored.record().reservation, 'retain');
  empty = true; restored.tick(); assert.equal(restored.record().state, 'confirmed_stopped');
});
test('restore cannot skip an already-due training cutoff if the crash preceded its receipt', () => {
  const f = fixture(); f.training.kill = () => f.calls.push('training-kill'); f.guardian.phase('training');
  const saved = f.guardian.record(); assert.equal(saved.trainingCutoff, undefined);
  for (const time of [119, 121]) {
    f.calls.length = 0;
    const g = new ExecutionGuardian(ExecutionBounds.restore(saved.bounds, at(time)), f.scope, () => at(time), () => {}, '0:1', f.training, saved);
    assert.ok(f.calls.includes('training-kill')); assert.ok(f.calls.includes('kill'));
    assert.equal(g.record().trainingCutoff.cancellationDeadlineMs, 120); assert.equal(g.record().cancellationDeadlineMs, 120);
    assert.equal(g.record().state, time < 120 ? 'terminating' : 'unknown'); assert.equal(g.record().reservation, 'retain');
  }
});
test('persisted training cutoff restart after expiry retains unknown until trusted whole-scope emptiness', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lab-training-restart-')); directories.push(directory);
  for (const restoreAt of [119, 121]) {
    let now = at(0); let trainingEmpty = false; let wholeEmpty = false; const calls = [];
    const j = guardianJournal(directory, randomUUID(), randomUUID(), identity()); j.acquire();
    const scope = { seal: () => true, cancel: () => {}, kill: () => calls.push('kill'), empty: () => wholeEmpty };
    const training = { ...scope, kill: () => calls.push('training-kill'), empty: () => trainingEmpty };
    const b = new ExecutionBounds(policy(), now);
    const g = new ExecutionGuardian(b, scope, () => now, j.save, '0:1', training);
    g.phase('training'); now = at(100); g.tick();
    const saved = j.read(); assert.equal(saved.state, 'armed'); assert.equal(saved.trainingCutoff.cancellationDeadlineMs, 120);
    now = at(restoreAt);
    const writes = [];
    const recovered = new ExecutionGuardian(ExecutionBounds.restore(saved.bounds, now), scope, () => now, r => { writes.push(r); j.save(r); }, '0:1', training, saved);
    assert.ok(calls.includes('training-kill')); assert.ok(calls.includes('kill'));
    assert.equal(recovered.record().cancellationDeadlineMs, 120);
    for (const record of writes) { assert.notEqual(record.state, 'armed'); assert.equal(record.cancellationDeadlineMs, 120); }
    assert.equal(recovered.record().state, restoreAt < 120 ? 'terminating' : 'unknown');
    now = at(125); recovered.tick();
    assert.equal(recovered.record().trainingCutoff.state, 'unknown'); assert.equal(recovered.record().reservation, 'retain');
    assert.throws(() => recovered.phase('periodic_validation', randomUUID()));
    assert.throws(() => recovered.phase('final_evaluation'));
    recovered.complete(); assert.equal(recovered.record().state, 'unknown');
    const againRecord = j.read(); calls.length = 0; now = at(130);
    const again = new ExecutionGuardian(ExecutionBounds.restore(againRecord.bounds, now), scope, () => now, j.save, '0:1', training, againRecord);
    assert.equal(again.record().cancellationDeadlineMs, 120); assert.equal(again.record().state, 'unknown');
    assert.ok(calls.includes('training-kill')); assert.ok(calls.includes('kill'));
    trainingEmpty = true; again.tick();
    assert.equal(again.record().trainingCutoff.state, 'confirmed_stopped'); assert.equal(again.record().reservation, 'retain');
    wholeEmpty = true; again.tick();
    assert.equal(j.read().state, 'confirmed_stopped'); assert.equal(j.read().reservation, 'quiescence_evidence_available');
  }
});
test('recovery termination keeps earlier parent/attempt escalation limits and rejects extended cutoff state', () => {
  for (const cap of ['parent', 'attempt']) {
    const p = policy(); if (cap === 'attempt') p.attemptMs = 105;
    const f = fixture(p, cap === 'parent' ? 105 : p.attemptMs); f.training.kill = () => f.calls.push('training-kill');
    f.guardian.phase('training'); f.time(100); f.time(105);
    const saved = f.guardian.record(); assert.equal(saved.cancellationDeadlineMs, 120);
    const g = new ExecutionGuardian(ExecutionBounds.restore(saved.bounds, at(119)), f.scope, () => at(119), () => {}, '0:1', f.training, saved);
    assert.equal(g.record().cancellationDeadlineMs, 120); assert.ok(f.calls.includes('training-kill'));
    for (const mutate of [s => { s.trainingCutoff.cancellationDeadlineMs++; }, s => { s.cancellationDeadlineMs++; },
      s => { s.trainingCutoff.receipt.reason = 'cancelled'; }, s => { s.trainingCutoff.receipt.deadlineMs--; }]) {
      const corrupt = structuredClone(saved); mutate(corrupt);
      assert.throws(() => new ExecutionGuardian(ExecutionBounds.restore(corrupt.bounds, at(119)), f.scope, () => at(119), () => {}, '0:1', f.training, corrupt));
    }
  }
});
test('whole attempt ends repeated bounded phases with no aggregate run ceiling', () => {
  const p = policy(); p.attemptMs = 150; p.phaseMs.preparation = 200; p.phaseMs.agent = 200;
  const b = new ExecutionBounds(p, at(0)); b.enter('agent', at(99));
  assert.equal(b.inspect(at(150)).reason, 'attempt_deadline');
  // A genuinely new authorized operation may have its own deadline, never a reset of this one.
  assert.equal(new ExecutionBounds(p, at(10000)).snapshot().outerDeadlineMs, 10150);
});
test('fixed recovery parent survives all two-retry/two-repair scheduling positions and restart', () => {
  const p = policy(); p.phaseMs.preparation = 1000;
  for (const start of [0, 50, 100, 150, 200]) {
    const b = new ExecutionBounds(p, at(start), 250);
    const restored = ExecutionBounds.restore(b.snapshot(), at(249));
    assert.equal(restored.inspect(at(250)).reason, 'parent_deadline');
  }
  assert.throws(() => new ExecutionBounds(p, at(250), 250));
});
test('boot change/backward elapsed clock revokes authority and never restores expired work', () => {
  const b = new ExecutionBounds(policy(), at(0)); b.inspect(at(10));
  assert.equal(b.inspect(at(9)).reason, 'clock_changed');
  const recovered = ExecutionBounds.restore(b.snapshot(), { bootId: 'boot-b', ms: 0 });
  assert.throws(() => recovered.enter('repair', { bootId: 'boot-b', ms: 0 }));
});
test('renewals require fresh single-use epoch challenge; reconnect near expiry cannot revive pause latch or parent deadline', () => {
  const authority = new ContactAuthority(2, 'boot-a', 0);
  const c = authority.challenge(at(29000));
  assert.throws(() => authority.renew(1, c.sequence, at(29001)));
  authority.renew(2, c.sequence, at(29001)); assert.throws(() => authority.renew(2, c.sequence, at(29002)));
  const delayed = authority.challenge(at(58000));
  assert.throws(() => authority.renew(2, delayed.sequence, at(59001)));
  assert.equal(authority.allowed(at(59001)), false);
  assert.throws(() => authority.challenge(at(60000)));
  const bounds = new ExecutionBounds(policy(), at(0));
  assert.equal(bounds.inspect(at(100)).reason, 'phase_deadline');
});
test('cancellation expiry/ack/parent exit/unobservable exit never manufacture pause or release', () => {
  const f = fixture(); f.setObservable(false); f.guardian.stop('cancelled'); f.time(10); f.time(20);
  assert.equal(f.guardian.record().state, 'unknown'); assert.equal(f.guardian.record().reservation, 'retain');
  assert.equal(f.guardian.record().receipt.reason, 'cancelled');
  f.setObservable(true); f.setEmpty(true); f.time(30);
  assert.equal(f.guardian.record().state, 'confirmed_stopped');
  const unsealed = fixture(); unsealed.setSeal(false); unsealed.setEmpty(true); unsealed.guardian.stop('cancelled'); unsealed.time(20);
  assert.equal(unsealed.guardian.record().state, 'unknown'); assert.equal(unsealed.guardian.record().reservation, 'retain');
});
test('failed evidence persistence kills the owned scope without raw error or fabricated outcome/counter changes', () => {
  const f = fixture(); const counters = { startedCandidates: 4, failures: 1, stagnation: 3 }; const before = structuredClone(counters);
  f.failSave(); assert.throws(() => f.guardian.phase('agent'));
  assert.ok(f.calls.includes('kill')); assert.deepEqual(counters, before);
  const record = f.guardian.record();
  for (const absent of ['acceptance', 'executionOutcome', 'stagnation', 'providerStop']) assert.equal(record[absent], undefined);
  assert.ok(!JSON.stringify(record).includes('synthetic-private-platform-detail'));
});
test('restarted guardian retains original escalation deadline and fences old authority', () => {
  const f = fixture(); f.guardian.stop('cancelled'); f.time(15); const record = f.guardian.record();
  const b = ExecutionBounds.restore(record.bounds, at(19));
  const g = new ExecutionGuardian(b, f.scope, () => at(19), () => {}, '0:1', f.training, record);
  assert.equal(g.record().cancellationDeadlineMs, 20);
  const late = new ExecutionGuardian(ExecutionBounds.restore(record.bounds, at(21)), f.scope, () => at(21), () => {}, '0:1', undefined, record);
  assert.equal(late.record().state, 'unknown'); assert.equal(late.record().reservation, 'retain');
});
test('journal survives restart, pins operation/scope and refuses non-private storage', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lab-guardian-journal-')); directories.push(directory);
  const op = randomUUID(); const scope = randomUUID(); const ids = identity(); const j = guardianJournal(directory, op, scope, ids); const f = fixture();
  j.acquire(); assert.throws(() => j.acquire()); j.save(f.guardian.record()); j.seal(); assert.deepEqual(j.read(), f.guardian.record());
  assert.throws(() => guardianJournal(directory, op, randomUUID(), ids).read());
});
test('per-call journal exhaustion preserves the last readable record and fences execution', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lab-call-capacity-')); directories.push(directory);
  const j = guardianJournal(directory, randomUUID(), randomUUID(), identity()); j.acquire();
  const f = fixture(); j.save(f.guardian.record()); const original = j.read();
  const p = defaultBoundPolicy(1800000); const b = new ExecutionBounds(p, at(0));
  for (let i = 0; i < 1000; i++) b.enter('periodic_validation', at(0), randomUUID());
  const g = new ExecutionGuardian(b, f.scope, () => at(0), j.save, '0:1', f.training);
  assert.equal(g.record().state, 'terminating'); assert.equal(g.record().reservation, 'retain');
  assert.equal(g.record().receipt.reason, 'persistence_failed');
  assert.ok(f.calls.includes('seal')); assert.ok(f.calls.includes('kill')); assert.deepEqual(j.read(), original);
});
test('unsupported local containment has no process-group/bare-shell fallback', () => {
  assert.throws(() => new CgroupScope('/tmp/not-a-cgroup', randomUUID(), () => true, () => {}));
  if (process.platform !== 'linux') assert.throws(() => linuxBootClock(), { code: 'unsupported_capability' });
});

function waitFor(child, predicate, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('Fixture timed out')); }, timeoutMs);
    const onMessage = value => { if (predicate(value)) { cleanup(); resolve(value); } };
    const cleanup = () => { clearTimeout(timer); child.off('message', onMessage); };
    child.on('message', onMessage);
  });
}
async function waitForJournal(directory, op, predicate) {
  // Controlled automated test only; event-loop polling checks independent output,
  // never PR state or a live provider. Fixed wall limit prevents hanging the suite.
  const expires = Date.now() + 10000;
  while (Date.now() < expires) {
    try { const record = JSON.parse(await readFile(path.join(directory, `${op}.json`), 'utf8')); if (predicate(record)) return record; } catch { /* not yet committed */ }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Guardian did not publish expected evidence');
}
for (const phase of ['final_evaluation', 'publication', 'cleanup']) {
  for (const fault of ['hang', 'exit']) test(`independent guardian contains real detached fixture descendants after supervisor ${fault} in ${phase}`, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lab-independent-')); directories.push(directory);
    const op = randomUUID(); const scope = randomUUID(); const p = policy();
    p.supervisorMs = 300; p.attemptMs = 10000; p.cancellationMs = 100;
    for (const key of PHASES) p.phaseMs[key] = 5000;
    const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { env: { PATH: '/usr/bin:/bin' }, stdio: 'ignore' }); children.add(unrelated);
    const supervisor = fork('tests/execution/supervisor.cjs', [build, fault], { env: { PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }); children.add(supervisor);
    supervisor.on('message', message => { if (message.kind === 'participants') for (const pid of message.pids) fixturePids.add(pid); });
    const participants = waitFor(supervisor, value => value.kind === 'participants');
    const guardian = waitFor(supervisor, value => value.kind === 'guardian');
    supervisor.send({ directory, identity: identity(), operationId: op, scopeId: scope, policy: p, phase, ...(phase === 'periodic_validation' ? { validationCallId: randomUUID() } : {}) });
    const { pids } = await participants; const { pid } = await guardian; fixturePids.add(pid);
    const result = await waitForJournal(directory, op, r => r.state === 'confirmed_stopped');
    assert.equal(result.receipt.phase, phase); assert.equal(result.receipt.reason, 'supervisor_lost');
    assert.equal(result.admissionSealed, true);
    for (const owned of pids) assert.throws(() => process.kill(owned, 0));
    assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
    supervisor.kill('SIGKILL'); unrelated.kill('SIGKILL');
  });
}

test('Pause and Finish drain without new repairs and expire beyond training clock', () => {
  for (const intent of ['pause', 'finish']) {
    const f = fixture(); f.guardian.phase('training'); f.guardian.drain(intent, true);
    f.guardian.drain('pause', true); assert.equal(f.guardian.record().drainIntent, intent);
    assert.throws(() => f.guardian.phase('repair'));
    f.time(100); f.time(110); f.time(111); f.setEmpty(false);
    f.time(211); assert.equal(f.guardian.record().receipt.phase, 'final_evaluation');
    f.time(231); assert.equal(f.guardian.record().state, 'unknown'); assert.equal(f.guardian.record().reservation, 'retain');
  }
  const setup = fixture(); setup.guardian.drain('pause', false);
  assert.equal(setup.guardian.record().receipt.phase, 'preparation');
});
test('contact expiry latches durably, drains only an admitted attempt and never authorizes more exploration', () => {
  const f = fixture(); f.guardian.phase('final_evaluation'); f.guardian.contactExpired(true);
  assert.equal(f.guardian.record().automaticPause, true); assert.equal(f.guardian.record().state, 'armed');
  assert.throws(() => f.guardian.phase('repair')); f.guardian.contactExpired(true);
  f.time(100); assert.equal(f.guardian.record().receipt.phase, 'final_evaluation');
  const local = fixture(); local.guardian.phase('agent'); local.guardian.contactExpired(false);
  assert.equal(local.guardian.record().receipt.reason, 'contact_expired');
});
test('late wakeup immediately escalates using original deadline rather than giving a new cancellation interval', () => {
  const f = fixture(); f.time(500);
  assert.ok(f.calls.includes('kill')); assert.equal(f.guardian.record().cancellationDeadlineMs, 120);
  assert.equal(f.guardian.record().state, 'unknown'); assert.equal(f.guardian.record().reservation, 'retain');
});
test('completed scope cannot be resurrected by IPC disconnect or a late cancel', () => {
  const f = fixture(); f.setEmpty(true); f.guardian.complete(); f.guardian.supervisorLost(); f.guardian.stop('cancelled');
  assert.equal(f.guardian.record().state, 'confirmed_stopped'); assert.equal(f.guardian.record().receipt, undefined);
});
for (const phase of PHASES) test(`real hanging fixture work in ${phase} reaches a bounded disposition`, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lab-phase-hang-')); directories.push(directory);
  const op = randomUUID(); const scope = randomUUID(); const p = policy();
  p.phaseMs = Object.fromEntries(PHASES.map(p => [p, 200])); p.attemptMs = 5000; p.supervisorMs = 10000; p.cancellationMs = 1000;
  const child = fork('tests/execution/guardian-fixture.cjs', [build], { env: { PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }); children.add(child);
  const participants = waitFor(child, v => v.kind === 'participants');
  child.send({ directory, identity: identity(), operationId: op, scopeId: scope, policy: p, phase, ...(phase === 'periodic_validation' ? { validationCallId: randomUUID() } : {}) });
  for (const pid of (await participants).pids) fixturePids.add(pid);
  const record = await waitForJournal(directory, op, r => r.state === 'confirmed_stopped');
  if (['compilation','training','periodic_validation'].includes(phase)) {
    assert.equal(record.trainingCutoff.receipt.phase, phase); assert.equal(record.trainingCutoff.receipt.reason, 'training_deadline');
    assert.equal(record.receipt.phase, 'final_evaluation');
  } else assert.equal(record.receipt.phase, phase);
  assert.equal(record.admissionSealed, true);
});


test('supervisor client waits for durable phase/drain receipts, rejects fenced repair and observes scoped cancellation', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lab-guardian-client-')); directories.push(directory);
  const p = policy(); p.supervisorMs = 10000; p.attemptMs = 10000; p.cancellationMs = 500;
  for (const key of PHASES) p.phaseMs[key] = 2000;
  let stopped;
  const quiescent = new Promise(resolve => { stopped = resolve; });
  const client = launchGuardian(process.execPath, path.resolve('tests/execution/guardian-fixture.cjs'), {
    build, directory, journalDirectory: directory, identity: identity(), operationId: randomUUID(), scopeId: randomUUID(),
    epoch: 1, admittedAttempt: true, policy: p, parentDeadlineMs: 10000, delegatedRoot: '/fixture-only',
  }, record => { if (record.state === 'confirmed_stopped') stopped(record); });
  assert.equal((await client.ready).state, 'armed');
  assert.equal((await client.phase('final_evaluation')).bounds.phase, 'final_evaluation');
  assert.equal((await client.drain('finish')).drainIntent, 'finish');
  await assert.rejects(client.phase('repair'));
  assert.equal((await client.cancel()).receipt.reason, 'cancelled');
  // Final independently observed scope evidence is pushed before IPC closes.
  let limit;
  try {
    const record = await Promise.race([quiescent, new Promise((_, reject) => {
      limit = setTimeout(() => reject(new Error('No quiescence evidence')), 8000);
    })]);
    assert.equal(record.admissionSealed, true);
  } finally { clearTimeout(limit); }
});
test('private client and host persist trusted validation-call IDs and reject missing/malformed or misplaced IDs', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lab-validation-client-')); directories.push(directory);
  const p = defaultBoundPolicy(1800000); const op = randomUUID();
  const first = randomUUID(); const second = randomUUID();
  const client = launchGuardian(process.execPath, path.resolve('tests/execution/guardian-fixture.cjs'), {
    build, directory, journalDirectory: directory, identity: identity(), operationId: op, scopeId: randomUUID(),
    epoch: 1, admittedAttempt: true, policy: p, parentDeadlineMs: p.attemptMs, delegatedRoot: '/fixture-only',
  }, () => {});
  try {
    await client.ready;
    for (const invalid of [undefined, null, 'malformed', {}, 12]) await assert.rejects(client.phase('periodic_validation', invalid));
    await assert.rejects(client.phase('training', first));
    assert.equal((await client.inspect()).bounds.phase, 'preparation');
    const one = (await client.phase('periodic_validation', first)).bounds;
    const retry = (await client.phase('periodic_validation', first)).bounds;
    assert.deepEqual(retry.validationCalls[first], one.validationCalls[first]);
    await client.phase('training');
    const two = (await client.phase('periodic_validation', second)).bounds;
    assert.equal(two.validationCallId, second); assert.deepEqual(two.validationCalls[first], one.validationCalls[first]);
    assert.ok(two.validationCalls[second].deadlineMs > one.validationCalls[first].deadlineMs);
    const durable = JSON.parse(await readFile(path.join(directory, `${op}.json`), 'utf8'));
    assert.deepEqual(durable.bounds, two);
    assert.deepEqual((await client.phase('periodic_validation', first)).bounds.validationCalls, two.validationCalls);
  } finally { await client.cancel(); }
  await waitForJournal(directory, op, r => r.state === 'confirmed_stopped');
});

test('corrupt persisted bound or stop receipts cannot be re-emitted as trusted guardian evidence', () => {
  const f = fixture(); f.guardian.stop('cancelled'); const record = f.guardian.record();
  const b = ExecutionBounds.restore(record.bounds, at(1));
  const corrupt = structuredClone(record); corrupt.receipt.reason = 'synthetic-private-value';
  assert.throws(() => new ExecutionGuardian(b, f.scope, () => at(1), () => {}, '0:1', undefined, corrupt));
  const extra = f.bounds.snapshot(); extra.unrecognized = 'synthetic-private-value';
  assert.throws(() => ExecutionBounds.restore(extra, at(1)));
});

test('expired contact is checked on the request path before admitting a repair, including before the next timer tick', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lab-contact-fence-')); directories.push(directory);
  const p = policy(); p.attemptMs = 100000; p.supervisorMs = 100000; p.cancellationMs = 500;
  for (const key of PHASES) p.phaseMs[key] = 100000;
  const op = randomUUID();
  const child = fork('tests/execution/guardian-fixture.cjs', [build], { env: { PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }); children.add(child);
  const participants = waitFor(child, v => v.kind === 'participants'); const armed = waitFor(child, v => v.kind === 'armed');
  child.send({ testClock: true, directory, identity: identity(), operationId: op, scopeId: randomUUID(), policy: p, phase: 'final_evaluation' });
  for (const pid of (await participants).pids) fixturePids.add(pid);
  await armed;
  for (const payload of [
    { phase: 'periodic_validation' }, { phase: 'periodic_validation', validationCallId: 'malformed' },
    { phase: 'training', validationCallId: randomUUID() },
    { phase: 'periodic_validation', validationCallId: randomUUID(), unexpected: true },
  ]) {
    const requestId = randomUUID(); const rejected = waitFor(child, v => v.kind === 'rejected' && v.requestId === requestId);
    child.send({ kind: 'phase', ...payload, requestId }); await rejected;
  }
  const before = JSON.parse(await readFile(path.join(directory, `${op}.json`), 'utf8'));
  assert.equal(before.bounds.phase, 'final_evaluation'); assert.deepEqual(before.bounds.validationCalls, {});
  const requestId = randomUUID(); const rejection = waitFor(child, v => v.kind === 'rejected' && v.requestId === requestId);
  child.send({ kind: 'test_advance', ms: 30001 }); child.send({ kind: 'phase', phase: 'repair', requestId });
  await rejection;
  const record = await waitForJournal(directory, op, r => r.automaticPause);
  assert.equal(record.bounds.phase, 'final_evaluation'); assert.equal(record.state, 'armed');
  child.send({ kind: 'cancel', requestId: randomUUID() });
  await waitForJournal(directory, op, r => r.state === 'confirmed_stopped');
});

test('recovery before cutoff receipt with already empty training', () => {
 for(const restoreAt of [119,121]) {
  let now=at(0),wholeEmpty=false;const calls=[],writes=[];
  const outer={seal:()=>true,cancel:()=>{},kill:()=>calls.push('kill'),empty:()=>wholeEmpty};
  const training={...outer,kill:()=>calls.push('training-kill'),empty:()=>true};
  const initial=new ExecutionGuardian(new ExecutionBounds(policy(),now),outer,()=>now,()=>{},'0:1',training);initial.phase('training');const saved=initial.record();assert.equal(saved.trainingCutoff,undefined);
  now=at(restoreAt);const recovered=new ExecutionGuardian(ExecutionBounds.restore(saved.bounds,now),outer,()=>now,r=>writes.push(r),'0:1',training,saved);
  assert.equal(recovered.record().cancellationDeadlineMs,120);assert.ok(calls.includes('kill'));assert.ok(writes.length);for(const record of writes){assert.notEqual(record.state,'armed');assert.equal(record.cancellationDeadlineMs,120);}
  const first=writes[0];now=at(125);calls.length=0;const again=new ExecutionGuardian(ExecutionBounds.restore(first.bounds,now),outer,()=>now,()=>{},'0:1',training,first);
  assert.equal(again.record().cancellationDeadlineMs,120);assert.equal(again.record().state,'unknown');assert.equal(again.record().reservation,'retain');assert.ok(calls.includes('kill'));
  wholeEmpty=true;again.tick();assert.equal(again.record().state,'confirmed_stopped');
 }
});


test('journal identity key order is semantic while changed identity remains rejected', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lab-order-journal-')); directories.push(directory);
  const op = randomUUID(), scope = randomUUID(), ids = identity(); const f = fixture();
  guardianJournal(directory, op, scope, ids).save(f.guardian.record());
  const reordered = Object.fromEntries(Object.entries(ids).reverse());
  assert.deepEqual(guardianJournal(directory, op, scope, reordered).read(), f.guardian.record());
  assert.throws(() => guardianJournal(directory, op, scope, { ...reordered, runId: randomUUID() }).read());
});

test('extended whole-scope cancellation is rejected at recovery', () => {
  const f = fixture(); f.guardian.stop('cancelled'); const record = f.guardian.record();
  assert.equal(record.cancellationDeadlineMs, 20); record.cancellationDeadlineMs = 2000;
  assert.throws(() => new ExecutionGuardian(ExecutionBounds.restore(record.bounds, at(21)), f.scope, () => at(21), () => {}, '0:1', undefined, record), /reconciliation/);
});

for (const phase of ['compilation', 'training', 'periodic_validation']) for (const trigger of ['tick', 'supervisorLost', 'stop', 'contactExpired']) {
  test(`late training wakeup preserves earliest cutoff: ${phase} / ${trigger}`, () => {
    let now = at(0), empty = false; const calls = [];
    const scope = { seal: () => true, cancel: () => {}, kill: () => calls.push('kill'), empty: () => empty };
    const training = { ...scope, kill: () => calls.push('training-kill') };
    const g = new ExecutionGuardian(new ExecutionBounds(defaultBoundPolicy(1000), now), scope, () => now, () => {}, '0:1', training);
    g.phase(phase, phase === 'periodic_validation' ? randomUUID() : undefined);
    now = at(16000);
    if (trigger === 'tick') g.tick(); else if (trigger === 'stop') g.stop('cancelled'); else if (trigger === 'contactExpired') g.contactExpired(false); else g.supervisorLost();
    assert.ok(calls.includes('kill'), 'overdue scope is killed on the first runnable turn');
    assert.ok(g.record().cancellationDeadlineMs <= 11000, 'training expiry cannot be replaced with a later cancellation window');
    assert.equal(g.record().state, 'unknown'); assert.equal(g.record().reservation, 'retain');
    empty = true; g.tick(); assert.equal(g.record().state, 'confirmed_stopped');
    assert.equal(g.record().reservation, 'quiescence_evidence_available');
  });
}
