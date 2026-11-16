import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, renameSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { ProjectCatalog } from '../src/catalog/catalog';
import { openStore } from '../src/catalog/storage';
import type { ProjectRecord } from '../src/projects';
import type { ReleaseCheckpoint, ReservationOptions } from '../src/compute/reservations';
import { ReservationError, type AcquireReservation, type ReleaseEvidence } from '../src/compute/contracts';
import { allocation, quiescence } from './reservation-fixture';

function project(catalog: ProjectCatalog, name: string) {
  const operationId = randomUUID();
  const reply = catalog.handle({ kind: 'create', operationId, input: { requestId: operationId, name, folderName: name } });
  if (!reply.ok) assert.fail(reply.error.message);
  return reply.value as ProjectRecord;
}
function fixture(options: ReservationOptions = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'lab-reservations-'));
  const catalog = new ProjectCatalog(root, () => {}, options);
  const p1 = project(catalog, 'one'); const p2 = project(catalog, 'two');
  return { root, catalog, p1, p2 };
}
function rejects(operation: () => unknown, code = 'unavailable') {
  assert.throws(operation, (e: unknown) => e instanceof ReservationError && e.code === code);
}
function cleanup(f: ReturnType<typeof fixture>) { f.catalog.close(); rmSync(f.root, { recursive: true, force: true }); }

for (const provider of ['runpod', 'vast'] as const) {
  test(`${provider}: whole instance conflicts across projects, aliases, disjoint GPUs and incarnation changes`, () => {
    const f = fixture();
    try {
      const input = allocation(f.p1.projectId, provider);
      const r = f.catalog.reservations.forProvider(provider).acquire(input);
      assert.deepEqual(f.catalog.reservations.acquire(input), r);
      assert.deepEqual(r.allocation.gpuIds, input.allocation.gpuIds);
      const other = allocation(f.p2.projectId, provider);
      other.allocation.accountId = 'another-alias';
      other.allocation.incarnationId = 'another-incarnation';
      other.allocation.gpuIds = [{ uuid: 'GPU-11111111-1111-1111-1111-111111111111', ordinal: 1 }];
      rejects(() => f.catalog.reservations.forProvider(provider).acquire(other), 'conflict');
      const separate = { ...other, allocation: { ...other.allocation, instanceId: provider === 'runpod' ? 'other-pod' : '5678' } };
      assert.equal(f.catalog.reservations.forProvider(provider).acquire(separate).state, 'held');
      assert.equal(f.catalog.reservations.list().length, 2);
      rejects(() => f.catalog.reservations.acquire({ ...input, allocation: { ...input.allocation, accountId: 'changed-payload' } }), 'idempotency_conflict');
      rejects(() => f.catalog.reservations.acquire({ ...input, operationId: randomUUID() }), 'idempotency_conflict');
      rejects(() => f.catalog.reservations.forProvider(provider === 'runpod' ? 'vast' : 'runpod').acquire(input), 'invalid_input');
      rejects(() => f.catalog.reservations.acquire({ ...allocation(f.p1.projectId, provider, provider === 'runpod' ? 'new-pod' : '9999'), runId: input.runId }), 'conflict');
    } finally { cleanup(f); }
  });

  test(`${provider}: simultaneous acquisitions in independent processes grant exactly one`, { timeout: 30_000 }, async () => {
    const f = fixture();
    const children: ReturnType<typeof spawn>[] = [];
    try {
      const requests = [allocation(f.p1.projectId, provider), allocation(f.p2.projectId, provider)];
      requests[1].allocation.accountId = 'alias-two';
      requests[1].allocation.gpuIds = [{ uuid: 'GPU-11111111-1111-1111-1111-111111111111', ordinal: 1 }];
      const ready: Promise<void>[] = [];
      const finished = requests.map((request) => {
        const child = spawn(process.execPath, [path.join(__dirname, 'reservation-worker.cjs'), 'acquire', f.root, JSON.stringify(request)], {
          env: { ELECTRON_RUN_AS_NODE: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
        children.push(child);
        let output = ''; let errors = '';
        ready.push(new Promise<void>((resolve, reject) => {
          child.stdout?.on('data', (data) => { output += data.toString(); if (output.includes('READY\n')) resolve(); });
          child.once('error', reject);
          child.once('exit', () => { if (!output.includes('READY\n')) reject(new Error(errors || output)); });
        }));
        child.stderr?.on('data', (data) => { errors += data.toString(); });
        return new Promise<{ state?: string; code?: string }>((resolve, reject) => {
          child.once('error', reject);
          child.once('exit', (code) => {
            if (code !== 0) return reject(new Error(errors || output));
            try { resolve(JSON.parse(output.trim().split('\n').at(-1)!)); } catch (e) { reject(e); }
          });
        });
      });
      await Promise.all(ready);
      children.forEach((child) => child.stdin?.end('GO\n'));
      const results = await Promise.all(finished);
      assert.equal(results.filter((r) => r.state === 'held').length, 1);
      assert.equal(results.filter((r) => r.code === 'conflict').length, 1);
      assert.equal(f.catalog.reservations.list().length, 1);
    } finally { children.forEach((child) => { if (child.exitCode === null) child.kill('SIGKILL'); }); cleanup(f); }
  });
}

test('invalid/unresolved identities cannot acquire, and input mutation cannot change the grant', () => {
  const f = fixture();
  try {
    for (const mutate of [
      (a: AcquireReservation) => { a.allocation.identityStatus = 'unknown' as never; },
      (a: AcquireReservation) => { a.allocation.gpuIds = []; },
      (a: AcquireReservation) => { a.allocation.gpuIds.push(a.allocation.gpuIds[0]); },
      (a: AcquireReservation) => { a.allocation.gpuIds[0].uuid = '0'; },
      (a: AcquireReservation) => { a.allocation.instanceId = 'https://token@host'; },
      (a: AcquireReservation) => { a.authorityId = ''; },
    ]) { const a = allocation(f.p1.projectId); mutate(a); rejects(() => f.catalog.reservations.acquire(a), 'invalid_input'); }
    rejects(() => f.catalog.reservations.acquire(allocation(f.p1.projectId, 'vast', '0012')), 'invalid_input');
    rejects(() => f.catalog.reservations.acquire(allocation(randomUUID())));
    const a = allocation(f.p1.projectId); const r = f.catalog.reservations.acquire(a);
    a.allocation.gpuIds[0].uuid = 'GPU-mutated'; r.allocation.accountId = 'mutated';
    assert.notEqual(f.catalog.reservations.get(r.reservationId).allocation.gpuIds[0].uuid, 'GPU-mutated');
    assert.notEqual(f.catalog.reservations.get(r.reservationId).allocation.accountId, 'mutated');
  } finally { cleanup(f); }
});

test('overlapping GPU identities across distinct instances conflict; provider identity remains part of the namespace', () => {
  const f = fixture();
  try {
    const input = allocation(f.p1.projectId); f.catalog.reservations.acquire(input);
    const overlapping = allocation(f.p2.projectId, 'runpod', 'different-pod');
    overlapping.allocation.gpuIds = input.allocation.gpuIds;
    rejects(() => f.catalog.reservations.acquire(overlapping), 'conflict');
    const otherProvider = allocation(f.p2.projectId, 'vast'); otherProvider.allocation.gpuIds = input.allocation.gpuIds;
    assert.equal(f.catalog.reservations.acquire(otherProvider).state, 'held');
  } finally { cleanup(f); }
});

test('trusted coordinator requests use the shared provider ports and return safe structured failures', () => {
  const f = fixture();
  try {
    const input = allocation(f.p1.projectId);
    const reply = f.catalog.reservations.handle({ kind: 'compute.acquire', operationId: input.operationId, input });
    assert.equal(reply.ok, true);
    const listed = f.catalog.reservations.handle({ kind: 'compute.list', operationId: randomUUID() });
    assert.equal(listed.ok, true);
    if (listed.ok) assert.equal((listed.value as unknown[]).length, 1);
    assert.equal(f.catalog.reservations.handle(null as never).ok, false);
    const mismatched = f.catalog.reservations.handle({ kind: 'compute.acquire', operationId: randomUUID(), input });
    assert.equal(mismatched.ok, false);
    if (!mismatched.ok) assert.equal(mismatched.error.code, 'invalid_input');
    const denied = f.catalog.reservations.handle({ kind: 'compute.release', operationId: randomUUID(), reservationId: input.reservationId, expectedRevision: 1, releaseId: randomUUID() });
    assert.equal(denied.ok, false);
    if (!denied.ok) { assert.equal(denied.error.origin, 'reservation_coordinator'); assert.equal(denied.error.code, 'unavailable'); }
  } finally { cleanup(f); }
});

test('uncertain stopping survives restart; acknowledgment, parent exit, idle GPUs and missing/access-lost observations supply no proof', () => {
  const f = fixture();
  const r = f.catalog.reservations.acquire(allocation(f.p1.projectId));
  const stopping = f.catalog.reservations.markStopping(r.reservationId, r.revision);
  assert.deepEqual(f.catalog.reservations.markStopping(r.reservationId, r.revision), stopping);
  rejects(() => f.catalog.reservations.assertLaunchable(r.reservationId, stopping.revision), 'conflict');
  f.catalog.close();
  const restarted = new ProjectCatalog(f.root);
  try {
    assert.deepEqual(restarted.reservations.get(r.reservationId), stopping);
    rejects(() => restarted.reservations.release(r.reservationId, stopping.revision, randomUUID()));
    rejects(() => restarted.reservations.acquire(allocation(f.p2.projectId)), 'conflict');
    rejects(() => restarted.reservations.acquire({ ...allocation(f.p1.projectId, 'runpod', 'replacement'), runId: r.runId }), 'conflict');
    for (const remote of [{ kind: 'cancel_acknowledged' }, { kind: 'parent_exited' }, { kind: 'gpu_idle' }, { kind: 'list_omission' }, { kind: 'access_denied' }, { kind: 'stopped_restartable' }]) {
      const c = new ProjectCatalog(f.root, () => {}, { evidence: { inspect: (held) => ({ ...quiescence(held), remote } as ReleaseEvidence) } });
      try { rejects(() => c.reservations.release(r.reservationId, stopping.revision, randomUUID())); }
      finally { c.close(); }
    }
    assert.equal(restarted.reservations.get(r.reservationId).state, 'stopping_unknown');
  } finally { restarted.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('a held grant recovered after restart cannot authorize an implicit Resume, but Stop and release reconciliation remain available', () => {
  const f = fixture(); const r = f.catalog.reservations.acquire(allocation(f.p1.projectId));
  f.catalog.close();
  const restarted = new ProjectCatalog(f.root, () => {}, { evidence: { inspect: quiescence } });
  try {
    assert.equal(restarted.reservations.get(r.reservationId).state, 'held');
    rejects(() => restarted.reservations.assertLaunchable(r.reservationId, 1), 'conflict');
    const stopping = restarted.reservations.markStopping(r.reservationId, 1);
    assert.equal(stopping.state, 'stopping_unknown');
    assert.equal(restarted.reservations.release(r.reservationId, stopping.revision, randomUUID()).state, 'released');
    const fresh = restarted.reservations.acquire({ ...allocation(f.p1.projectId), runId: r.runId });
    assert.equal(restarted.reservations.assertLaunchable(fresh.reservationId, 1).reservationId, fresh.reservationId);
  } finally { restarted.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('all-scope, authority and incarnation proof is mandatory, including every rank/helper and settled receipts', () => {
  let alter: (e: ReleaseEvidence) => ReleaseEvidence = (e) => e;
  const f = fixture({ evidence: { inspect: (r) => alter(quiescence(r)) } });
  try {
    const r = f.catalog.reservations.acquire(allocation(f.p1.projectId));
    const changes: Partial<ReleaseEvidence>[] = [
      { reservationId: randomUUID() }, { projectId: randomUUID() }, { runId: randomUUID() }, { authorityId: randomUUID() },
      { episodeId: randomUUID() }, { scopeId: randomUUID() }, { instanceId: 'different' }, { incarnationId: 'old' }, { provider: 'vast' },
      { futureLaunches: 'unknown' }, { mutationAuthority: 'unknown' }, { receipts: 'unknown' }, { localAgents: 'running' }, { localHelpers: 'unknown' },
      { remote: { kind: 'scope', coverage: 'partial', workers: 'stopped' } },
      { remote: { kind: 'scope', coverage: 'all_application_work', workers: 'running' } },
      { remote: { kind: 'scope', coverage: 'all_application_work', workers: 'unknown' } },
      { remote: { kind: 'destroyed', source: 'authoritative_incarnation_destruction', irreversible: false } },
    ];
    for (const change of changes) { alter = (e) => ({ ...e, ...change }); rejects(() => f.catalog.reservations.release(r.reservationId, 1, randomUUID())); }
    assert.equal(f.catalog.reservations.get(r.reservationId).state, 'held');
    rejects(() => f.catalog.reservations.release(r.reservationId, 99, randomUUID()), 'conflict');
    const h = new Database(path.join(f.p1.location, '.lab', 'history.sqlite'), { readonly: true });
    assert.equal((h.prepare('SELECT COUNT(*) AS n FROM compute_release_intents').get() as { n: number }).n, 0); h.close();
  } finally { cleanup(f); }
});

for (const kind of ['scope', 'destroyed'] as const) {
  test(`confirmed ${kind} releases with acceptance still pending; retries preserve history and cannot reacquire`, () => {
    const f = fixture({ evidence: { inspect: (r) => ({ ...quiescence(r),
      ...(kind === 'destroyed' ? { remote: { kind: 'destroyed', source: 'authoritative_incarnation_destruction', irreversible: true } as const } : {}),
      acceptanceStatus: 'pending', vendorBody: 'excluded-fixture' }) } });
    try {
      const input = allocation(f.p1.projectId); const r = f.catalog.reservations.acquire(input);
      const releaseId = randomUUID();
      const released = f.catalog.reservations.release(r.reservationId, 1, releaseId);
      assert.equal(released.state, 'released'); assert.equal(released.revision, 2);
      assert.equal(JSON.stringify(released).includes('acceptanceStatus'), false);
      assert.equal(JSON.stringify(released).includes('vendorBody'), false);
      assert.deepEqual(f.catalog.reservations.release(r.reservationId, 1, releaseId), released);
      assert.deepEqual(f.catalog.reservations.acquire(input), released);
      rejects(() => f.catalog.reservations.release(r.reservationId, 1, randomUUID()), 'conflict');
      assert.equal(f.catalog.reservations.acquire(allocation(f.p2.projectId)).state, 'held');
      rejects(() => f.catalog.reservations.assertLaunchable(r.reservationId, 2), 'conflict');
    } finally { cleanup(f); }
  });
}

for (const stage of ['before_project_intent', 'project_intent', 'before_global_release', 'global_release'] as ReleaseCheckpoint[]) {
  test(`SIGKILL at ${stage}: conservative project/global boundary recovers the same release identity`, () => {
    const f = fixture(); const r = f.catalog.reservations.acquire(allocation(f.p1.projectId));
    const stopping = f.catalog.reservations.markStopping(r.reservationId, 1); const releaseId = randomUUID();
    f.catalog.close();
    const child = spawnSync(process.execPath, [path.join(__dirname, 'reservation-worker.cjs'), 'release', f.root, r.reservationId, stage, releaseId], { env: { ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' });
    assert.equal(child.signal, 'SIGKILL', child.stderr);
    const restarted = new ProjectCatalog(f.root);
    try {
      const current = restarted.reservations.get(r.reservationId);
      assert.equal(current.state, stage === 'global_release' ? 'released' : 'stopping_unknown');
      if (stage !== 'global_release') rejects(() => restarted.reservations.acquire(allocation(f.p2.projectId)), 'conflict');
      if (stage === 'before_project_intent') {
        rejects(() => restarted.reservations.release(r.reservationId, stopping.revision, releaseId));
      } else {
        const released = restarted.reservations.release(r.reservationId, stopping.revision, releaseId);
        assert.equal(released.state, 'released'); assert.equal(released.release?.releaseId, releaseId);
        assert.equal(released.authorityId, r.authorityId); assert.equal(released.episodeId, r.episodeId);
        assert.equal(restarted.reservations.acquire(allocation(f.p2.projectId)).state, 'held');
      }
    } finally { restarted.close(); rmSync(f.root, { recursive: true, force: true }); }
  });
}

test('failed project and registry writes retain reservation; durable project intent fences launches and survives evidence-source loss', () => {
  let stage: ReleaseCheckpoint | undefined = 'before_project_intent';
  const f = fixture({ evidence: { inspect: quiescence }, checkpoint: (at) => { if (at === stage) throw new Error('fixture write failure'); } });
  try {
    const r = f.catalog.reservations.acquire(allocation(f.p1.projectId)); const releaseId = randomUUID();
    rejects(() => f.catalog.reservations.release(r.reservationId, 1, releaseId));
    assert.equal(f.catalog.reservations.get(r.reservationId).state, 'held');
    rejects(() => f.catalog.reservations.assertLaunchable(r.reservationId, 1), 'conflict');
    stage = 'before_global_release';
    rejects(() => f.catalog.reservations.release(r.reservationId, 1, releaseId));
    rejects(() => f.catalog.reservations.assertLaunchable(r.reservationId, 1), 'conflict');
    rejects(() => f.catalog.reservations.markStopping(r.reservationId, 1), 'conflict');
    rejects(() => f.catalog.reservations.acquire(allocation(f.p2.projectId)), 'conflict');
    const recovered = new ProjectCatalog(f.root);
    try { assert.equal(recovered.reservations.release(r.reservationId, 1, releaseId).state, 'released'); }
    finally { recovered.close(); }
  } finally { cleanup(f); }
});

test('missing project history cannot release or silently reconstruct evidence', () => {
  const f = fixture({ evidence: { inspect: quiescence } });
  try {
    const r = f.catalog.reservations.acquire(allocation(f.p1.projectId));
    renameSync(f.p1.location, `${f.p1.location}-saved`);
    rejects(() => f.catalog.reservations.release(r.reservationId, 1, randomUUID()));
    rejects(() => f.catalog.reservations.acquire(allocation(f.p2.projectId)), 'conflict');
    assert.equal(f.catalog.reservations.get(r.reservationId).state, 'held');
    renameSync(`${f.p1.location}-saved`, f.p1.location);
  } finally { cleanup(f); }
});

test('SQLite rejects either release write without exposing the instance; recovery reuses the committed project intent', () => {
  const f = fixture({ evidence: { inspect: quiescence } });
  const projectDb = new Database(path.join(f.p1.location, '.lab', 'history.sqlite'));
  const registry = new Database(path.join(f.root, 'registry.sqlite'));
  try {
    const r = f.catalog.reservations.acquire(allocation(f.p1.projectId)); const releaseId = randomUUID();
    projectDb.exec("CREATE TRIGGER fixture_project_failure BEFORE INSERT ON compute_release_intents BEGIN SELECT RAISE(ABORT, 'fixture'); END");
    rejects(() => f.catalog.reservations.release(r.reservationId, 1, releaseId));
    assert.equal((projectDb.prepare('SELECT COUNT(*) AS n FROM compute_release_intents').get() as { n: number }).n, 0);
    assert.equal(f.catalog.reservations.get(r.reservationId).state, 'held');
    projectDb.exec('DROP TRIGGER fixture_project_failure');
    registry.exec("CREATE TRIGGER fixture_global_failure BEFORE UPDATE ON compute_reservation_gpus BEGIN SELECT RAISE(ABORT, 'fixture'); END");
    rejects(() => f.catalog.reservations.release(r.reservationId, 1, releaseId));
    assert.equal((projectDb.prepare('SELECT COUNT(*) AS n FROM compute_release_intents').get() as { n: number }).n, 1);
    assert.equal(f.catalog.reservations.get(r.reservationId).state, 'held');
    assert.equal((registry.prepare('SELECT active FROM compute_reservation_gpus').get() as { active: number }).active, 1);
    rejects(() => f.catalog.reservations.acquire(allocation(f.p2.projectId)), 'conflict');
    registry.exec('DROP TRIGGER fixture_global_failure');
    const recovered = new ProjectCatalog(f.root);
    try {
      assert.equal(recovered.reservations.release(r.reservationId, 1, releaseId).state, 'released');
      assert.equal((registry.prepare('SELECT active FROM compute_reservation_gpus').get() as { active: number }).active, 0);
    } finally { recovered.close(); }
  } finally { projectDb.close(); registry.close(); cleanup(f); }
});

test('existing v1 catalog and project histories upgrade without changing project identity or Git binding', () => {
  const f = fixture(); f.catalog.close();
  const registryFile = path.join(f.root, 'registry.sqlite'); const historyFile = path.join(f.p1.location, '.lab', 'history.sqlite');
  const registry = new Database(registryFile); const history = new Database(historyFile);
  registry.exec('DROP TABLE compute_reservation_gpus; DROP TABLE compute_reservations; DELETE FROM schema_migrations WHERE version = 2; PRAGMA user_version = 1');
  history.exec('DROP TABLE compute_release_intents; DELETE FROM schema_migrations WHERE version = 2; PRAGMA user_version = 1');
  registry.close(); history.close();
  const upgraded = new ProjectCatalog(f.root, () => {}, { evidence: { inspect: quiescence } });
  try {
    const reopened = upgraded.handle({ kind: 'open', operationId: randomUUID(), projectId: f.p1.projectId });
    assert.equal(reopened.ok, true); if (reopened.ok) assert.deepEqual(reopened.value, f.p1);
    const r = upgraded.reservations.acquire(allocation(f.p1.projectId));
    assert.equal(upgraded.reservations.release(r.reservationId, 1, randomUUID()).state, 'released');
    for (const file of [registryFile, historyFile]) {
      const folder = path.dirname(file); const backup = readdirSync(folder).find((name) => name.startsWith(path.basename(file) + '.before-v2-'));
      assert.ok(backup);
      const db = new Database(path.join(folder, backup), { readonly: true });
      assert.equal((db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n, 1); db.close();
    }
  } finally { upgraded.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('schema upgrades preserve v1 data with consistent backup; failed/unknown migrations never reset the store', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'lab-migration-')); const filename = path.join(root, 'history.sqlite');
  const v1 = 'CREATE TABLE identity (id TEXT PRIMARY KEY)'; const v2 = 'CREATE TABLE release_intents (id TEXT PRIMARY KEY)';
  try {
    let db = openStore(filename, v1); db.prepare('INSERT INTO identity VALUES (?)').run('fixture'); db.close();
    assert.throws(() => openStore(filename, v1, ['not valid SQL']));
    db = openStore(filename, v1); assert.equal((db.prepare('SELECT id FROM identity').get() as { id: string }).id, 'fixture'); db.close();
    db = openStore(filename, v1, [v2]); assert.equal((db.prepare('SELECT id FROM identity').get() as { id: string }).id, 'fixture'); db.close();
    const backups = readdirSync(root).filter((name) => name.includes('.before-v2-'));
    assert.equal(backups.length, 2);
    for (const backup of backups) {
      const b = new Database(path.join(root, backup), { readonly: true });
      assert.equal((b.prepare('SELECT id FROM identity').get() as { id: string }).id, 'fixture');
      assert.equal((b.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n, 1); b.close();
    }
    assert.throws(() => openStore(filename, v1), /Unsupported database schema/);
    assert.throws(() => openStore(filename, v1, ['changed checksum']), /Unsupported database schema/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
