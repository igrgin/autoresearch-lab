import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, renameSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { ProjectCatalog } from '../src/catalog/catalog';
import { ConfigurationStore } from '../src/configuration/store';
import { assertSafeConfiguration, validateOverrides } from '../src/configuration/validation';
import { Sanitizer } from '../src/security/sanitizer';
import type { ChoiceOverrides, ConfigurationDraft, ConfigurationReply, ConfigurationRequest, ConfigurationSnapshot, DefaultsRecord } from '../src/configuration';
import type { ProjectRecord } from '../src/projects';

function value<T>(reply: ConfigurationReply<T>): T { if (!reply.ok) assert.fail(reply.error.message); return reply.value; }
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'lab-defaults-'));
  const catalog = new ProjectCatalog(root);
  const create = (folderName: string) => {
    const requestId = randomUUID();
    const reply = catalog.handle({ kind: 'create', operationId: requestId, input: { requestId, folderName, name: folderName } });
    if (!reply.ok) assert.fail(reply.error.message);
    return reply.value as ProjectRecord;
  };
  const project = create('first');
  const other = create('second');
  const store = new ConfigurationStore(root, catalog);
  return { root, catalog, project, other, store,
    cleanup: () => { store.close(); catalog.close(); rmSync(root, { recursive: true, force: true }); } };
}
function call<T>(store: ConfigurationStore, request: Omit<ConfigurationRequest, 'operationId'> | Record<string, unknown>) {
  return store.handle({ operationId: randomUUID(), ...request } as ConfigurationRequest) as ConfigurationReply<T>;
}
function get(store: ConfigurationStore, projectId?: string) { return value(call<DefaultsRecord>(store, projectId ? { kind: 'project:get', projectId } : { kind: 'global:get' })); }
function update(store: ConfigurationStore, values: ChoiceOverrides, projectId?: string) {
  const requestId = randomUUID();
  return store.handle({ kind: projectId ? 'project:update' : 'global:update', operationId: requestId, projectId,
    input: { requestId, expectedRevision: get(store, projectId).revision, values } } as ConfigurationRequest) as ConfigurationReply<DefaultsRecord>;
}
function draft(store: ConfigurationStore, projectId: string) { return value(call<ConfigurationDraft>(store, { kind: 'prepare', projectId })); }
function saveRequest(draft: ConfigurationDraft, overrides: ChoiceOverrides = {}): ConfigurationRequest {
  const requestId = randomUUID();
  return { kind: 'save', operationId: requestId, input: { requestId, projectId: draft.projectId, globalRevision: draft.globalRevision, projectRevision: draft.projectRevision, overrides } };
}
function snapshot(store: ConfigurationStore, projectId: string, snapshotId: string) { return value(call<ConfigurationSnapshot>(store, { kind: 'snapshot', projectId, snapshotId })); }
function error(reply: ConfigurationReply<unknown>, code: string) { assert.equal(reply.ok, false); if (reply.ok) assert.fail(); assert.equal(reply.error.code, code); }

test('per-field precedence, explicit null and atomic agent choice survive full store restart; snapshots never reread defaults', () => {
  const f = fixture();
  const global = { agent: { integration: 'codex' as const, model: 'fixture-model-1' }, trainingDurationSeconds: 120, objective: 'Improve validation' };
  value(update(f.store, global));
  value(update(f.store, { trainingDurationSeconds: 45, objective: null }, f.project.projectId));
  const prepared = draft(f.store, f.project.projectId);
  assert.deepEqual(prepared.choices, { ...global, trainingDurationSeconds: 45, objective: null });
  assert.deepEqual(prepared.origins.agent, { level: 'global', revision: 1 });
  assert.deepEqual(prepared.origins.objective, { level: 'project', revision: 1 });
  const request = saveRequest(prepared, { agent: { integration: 'claude', model: null } });
  const saved = value(f.store.handle(request)) as ConfigurationSnapshot;
  assert.deepEqual(saved.choices.agent, { integration: 'claude', model: null });
  assert.deepEqual(saved.origins.agent, { level: 'run', revision: null });
  const immutable = structuredClone(saved);
  saved.choices.trainingDurationSeconds = 999; // Caller mutation cannot alter persistence.
  value(update(f.store, { ...global, trainingDurationSeconds: 300, objective: 'Changed global' }));
  value(update(f.store, { trainingDurationSeconds: 60 }, f.project.projectId));
  assert.deepEqual(snapshot(f.store, f.project.projectId, immutable.snapshotId), immutable);
  assert.deepEqual(value(f.store.handle(request)), immutable); // Lost response retry uses old pinned values.
  const next = draft(f.store, f.project.projectId);
  assert.equal(next.choices.trainingDurationSeconds, 60);
  assert.equal(next.choices.objective, 'Changed global'); // Removed override inherits again.
  assert.equal(draft(f.store, f.other.projectId).choices.trainingDurationSeconds, 300);
  f.store.close(); f.catalog.close();
  const catalog = new ProjectCatalog(f.root);
  const restarted = new ConfigurationStore(f.root, catalog);
  try {
    assert.deepEqual(draft(restarted, f.project.projectId), next);
    assert.deepEqual(snapshot(restarted, f.project.projectId, immutable.snapshotId), immutable);
    assert.deepEqual(value(restarted.handle(request)), immutable);
    assert.deepEqual(get(restarted).values, { ...global, trainingDurationSeconds: 300, objective: 'Changed global' });
    assert.deepEqual(get(restarted, f.project.projectId).values, { trainingDurationSeconds: 60 });
  } finally { restarted.close(); catalog.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('stale editors and drafts fail without overwriting; identical retries reconcile, changed retries conflict', () => {
  const f = fixture();
  try {
    const before = draft(f.store, f.project.projectId);
    const requestId = randomUUID();
    const request: ConfigurationRequest = { kind: 'global:update', operationId: requestId, input: { requestId, expectedRevision: 0, values: { trainingDurationSeconds: 12 } } };
    const first = value(f.store.handle(request));
    assert.deepEqual(value(f.store.handle(request)), first);
    error(f.store.handle({ ...request, input: { ...request.input, values: { trainingDurationSeconds: 13 } } }), 'idempotency_conflict');
    const anotherId = randomUUID();
    error(f.store.handle({ ...request, operationId: anotherId, input: { ...request.input, requestId: anotherId } }), 'conflict');
    error(f.store.handle(saveRequest(before)), 'conflict');
    assert.equal(value(call<ConfigurationSnapshot[]>(f.store, { kind: 'snapshots', projectId: f.project.projectId })).length, 0);
    const save = saveRequest(draft(f.store, f.project.projectId));
    value(f.store.handle(save));
    if (save.kind !== 'save') assert.fail();
    error(f.store.handle({ ...save, input: { ...save.input, overrides: { objective: 'Changed' } } }), 'idempotency_conflict');
    assert.equal(value(call<ConfigurationSnapshot[]>(f.store, { kind: 'snapshots', projectId: f.project.projectId })).length, 1);
  } finally { f.cleanup(); }
});

test('malformed, unsupported and credential-bearing values fail before persistence', () => {
  const f = fixture();
  try {
    for (const values of [{ trainingDurationSeconds: 0 }, { trainingDurationSeconds: -1 }, { trainingDurationSeconds: 1.5 }, { trainingDurationSeconds: NaN },
      { agent: { integration: 'other', model: null } }, { agent: { integration: 'codex', model: 'https://user:pass@host?token=secret' } },
      { agent: { integration: 'codex', model: 'sk-proj-fixturecredential12345' } }, { objective: 'Bearer syntheticcredential' }, { objective: ' ' },
      { objective: 'x'.repeat(2001) }, { token: 'synthetic' }, { agent: undefined }, []]) {
      error(update(f.store, values as ChoiceOverrides), 'invalid_input');
    }
    assert.equal(get(f.store).revision, 0);
    error(f.store.handle(null as never), 'invalid_input');
    error(call(f.store, { kind: 'not-a-command' }), 'invalid_input');
    // Trusted admission uses the same sanitizer as app-owned current/retired matching.
    const matcher = new Sanitizer(); matcher.register(randomUUID(), 'synthetic-known-value');
    assert.throws(() => assertSafeConfiguration({ objective: 'Use synthetic-known-value' }, matcher));
    assert.throws(() => assertSafeConfiguration({ objective: encodeURIComponent('synthetic-known-value') }, matcher));
    assert.doesNotThrow(() => assertSafeConfiguration({ objective: 'Improve validation' }, matcher));
    assert.throws(() => validateOverrides({ objective: '\ud800' }));
  } finally { f.cleanup(); }
});

test('unavailable or cross-project stores cannot be used; missing projects are never recreated', () => {
  const f = fixture();
  try {
    const saved = value(f.store.handle(saveRequest(draft(f.store, f.project.projectId)))) as ConfigurationSnapshot;
    error(call(f.store, { kind: 'snapshot', projectId: f.other.projectId, snapshotId: saved.snapshotId }), 'not_found');
    error(call(f.store, { kind: 'prepare', projectId: randomUUID() }), 'not_found');
    renameSync(f.project.location, `${f.project.location}-saved`);
    const missingId = randomUUID();
    error(f.store.handle({ kind: 'project:update', operationId: missingId, projectId: f.project.projectId, input: { requestId: missingId, expectedRevision: 0, values: { objective: 'Cannot write' } } }), 'unavailable');
    renameSync(`${f.project.location}-saved`, f.project.location);
    const configFile = path.join(f.project.location, '.lab', 'configuration.sqlite');
    renameSync(configFile, `${configFile}.missing`);
    error(call(f.store, { kind: 'project:get', projectId: f.project.projectId }), 'unavailable');
    renameSync(`${configFile}.missing`, configFile);
    // Swapping another valid store must not substitute its defaults/history.
    const firstFile = path.join(f.project.location, '.lab', 'configuration.sqlite');
    const otherFile = path.join(f.other.location, '.lab', 'configuration.sqlite');
    renameSync(firstFile, `${firstFile}.saved`); renameSync(otherFile, firstFile);
    error(call(f.store, { kind: 'project:get', projectId: f.project.projectId }), 'unavailable');
    renameSync(firstFile, otherFile); renameSync(`${firstFile}.saved`, firstFile);
    assert.deepEqual(snapshot(f.store, f.project.projectId, saved.snapshotId), saved);
  } finally { f.cleanup(); }
});

test('SQL rejects snapshot mutation/deletion and future schemas without resetting records', () => {
  const f = fixture();
  try {
    const saved = value(f.store.handle(saveRequest(draft(f.store, f.project.projectId)))) as ConfigurationSnapshot;
    const db = new Database(path.join(f.project.location, '.lab', 'configuration.sqlite'));
    try {
      assert.throws(() => db.prepare('UPDATE snapshots SET record_json = ?').run('{}'), /Immutable/);
      assert.throws(() => db.prepare('DELETE FROM snapshots').run(), /Immutable/);
      db.prepare("INSERT INTO schema_migrations VALUES (2, 'future')").run();
      error(call(f.store, { kind: 'prepare', projectId: f.project.projectId }), 'unavailable');
      assert.equal((db.prepare('SELECT snapshot_id FROM snapshots').get() as { snapshot_id: string }).snapshot_id, saved.snapshotId);
      db.prepare('DELETE FROM schema_migrations WHERE version = 2').run();
    } finally { db.close(); }
    assert.deepEqual(snapshot(f.store, f.project.projectId, saved.snapshotId), saved);
  } finally { f.cleanup(); }
});

test('a failed SQL write preserves defaults and the same request can recover without duplicate revisions', () => {
  const f = fixture();
  try {
    value(update(f.store, { trainingDurationSeconds: 15 }));
    const db = new Database(path.join(f.root, 'defaults.sqlite'));
    const requestId = randomUUID();
    const request: ConfigurationRequest = { kind: 'global:update', operationId: requestId, input: { requestId, expectedRevision: 1, values: { trainingDurationSeconds: 30 } } };
    try {
      db.exec("CREATE TRIGGER synthetic_write_fault BEFORE INSERT ON defaults_revisions BEGIN SELECT RAISE(ABORT, 'Synthetic storage fault'); END");
      const failed = f.store.handle(request);
      error(failed, 'unavailable');
      if (failed.ok) assert.fail();
      assert.equal(failed.error.retry, 'same_key');
      assert.equal(get(f.store).values.trainingDurationSeconds, 15);
      db.exec('DROP TRIGGER synthetic_write_fault');
      assert.equal((value(f.store.handle(request)) as DefaultsRecord).revision, 2);
      assert.equal((value(f.store.handle(request)) as DefaultsRecord).revision, 2);
    } finally { db.close(); }
  } finally { f.cleanup(); }
});

test('missing established global storage fails startup rather than replacing saved defaults', () => {
  const f = fixture();
  value(update(f.store, { trainingDurationSeconds: 100 }));
  f.store.close(); f.catalog.close();
  const filename = path.join(f.root, 'defaults.sqlite');
  renameSync(filename, `${filename}.saved`);
  const catalog = new ProjectCatalog(f.root);
  try {
    assert.throws(() => new ConfigurationStore(f.root, catalog));
    renameSync(`${filename}.saved`, filename);
    const restored = new ConfigurationStore(f.root, catalog);
    try { assert.equal(get(restored).values.trainingDurationSeconds, 100); }
    finally { restored.close(); }
  } finally { catalog.close(); rmSync(f.root, { recursive: true, force: true }); }
});
