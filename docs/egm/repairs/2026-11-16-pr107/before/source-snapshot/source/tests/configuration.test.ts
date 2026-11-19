import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, renameSync, rmSync, writeFileSync, statSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { ProjectCatalog } from '../src/catalog/catalog';
import { ConfigurationStore } from '../src/configuration/store';
import { assertSafeConfiguration, validateOverrides } from '../src/configuration/validation';
import { Sanitizer } from '../src/security/sanitizer';
import type { ChoiceOverrides, ConfigurationDraft, ConfigurationReply, ConfigurationRequest, ConfigurationSnapshot, DefaultsRecord, DefaultsRecovery } from '../src/configuration';
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

test('resolved inherited choices are admitted before snapshot persistence, including retained matching values', async () => {
  for (const scope of ['global', 'project'] as const) {
    const f = fixture();
    try {
      const matcher = new Sanitizer(), credential = 'laterRecognizedObjective20';
      value(update(f.store, { objective: credential }, scope === 'project' ? f.project.projectId : undefined));
      const request = saveRequest(draft(f.store, f.project.projectId));
      // Registration happens after preparation; the request contains only overrides.
      matcher.register(randomUUID(), credential);
      assert.doesNotThrow(() => assertSafeConfiguration(request, matcher));
      const admit = async (input: unknown) => assertSafeConfiguration(input, matcher);
      for (let reuse = 0; reuse < 2; reuse++) {
        error(await f.store.handleAdmitted(request, admit), 'unavailable');
        assert.equal(value(call<ConfigurationSnapshot[]>(f.store, { kind: 'snapshots', projectId: f.project.projectId })).length, 0);
      }
      const filename = path.join(f.project.location, '.lab', 'configuration.sqlite');
      // A project override predates registration in this case. It must not gain
      // a snapshot copy; global inheritance must never enter the project store.
      if (scope === 'global') for (const file of [filename, `${filename}-wal`, `${filename}-shm`]) {
        if (existsSync(file)) assert.equal(readFileSync(file).includes(Buffer.from(credential)), false);
      }
    } finally { f.cleanup(); }
  }
});

test('a defaults change during resolved-choice admission cannot change the values written', async () => {
  const f = fixture();
  try {
    value(update(f.store, { objective: 'Reviewed objective' }));
    const request = saveRequest(draft(f.store, f.project.projectId));
    let admissions = 0;
    const reply = await f.store.handleAdmitted(request, async () => {
      if (++admissions === 2) value(update(f.store, { objective: 'Unreviewed replacement' }));
    });
    error(reply, 'conflict');
    assert.equal(value(call<ConfigurationSnapshot[]>(f.store, { kind: 'snapshots', projectId: f.project.projectId })).length, 0);
  } finally { f.cleanup(); }
});

test('credential recognition between approval and writer continuation cannot publish a new snapshot copy', async () => {
  const f = fixture();
  try {
    const canary = 'DelayedAdmissionObjective107';
    value(update(f.store, { objective: canary }));
    const request = saveRequest(draft(f.store, f.project.projectId));
    const matcher = new Sanitizer(); let admissions = 0;
    const reply = await f.store.handleAdmitted(request, async input => {
      assertSafeConfiguration(input, matcher);
      if (++admissions === 2) matcher.register(randomUUID(), canary);
    });
    error(reply, 'unavailable');
    assert.equal(value(call<ConfigurationSnapshot[]>(f.store, { kind: 'snapshots', projectId: f.project.projectId })).length, 0);
    const filename = path.join(f.project.location, '.lab', 'configuration.sqlite');
    for (const file of [filename, `${filename}-wal`]) if (existsSync(file)) assert.equal(readFileSync(file).includes(Buffer.from(canary)), false);
  } finally { f.cleanup(); }
});

test('empty replacements of established global or project stores fail without initialization and originals recover', () => {
  for (const scope of ['global', 'project'] as const) {
    const f = fixture();
    value(update(f.store, { objective: 'Retained settings' }, scope === 'project' ? f.project.projectId : undefined));
    const saved = value(f.store.handle(saveRequest(draft(f.store, f.project.projectId)))) as ConfigurationSnapshot;
    const filename = scope === 'global' ? path.join(f.root, 'defaults.sqlite') : path.join(f.project.location, '.lab', 'configuration.sqlite');
    if (scope === 'global') f.store.close();
    renameSync(filename, `${filename}.preserved`); writeFileSync(filename, '');
    let restored: ConfigurationStore | undefined;
    try {
      if (scope === 'global') assert.throws(() => new ConfigurationStore(f.root, f.catalog));
      else error(call(f.store, { kind: 'project:get', projectId: f.project.projectId }), 'unavailable');
      assert.equal(statSync(filename).size, 0);
      rmSync(filename); renameSync(`${filename}.preserved`, filename);
      restored = scope === 'global' ? new ConfigurationStore(f.root, f.catalog) : f.store;
      assert.equal(get(restored, scope === 'project' ? f.project.projectId : undefined).revision, 1);
      assert.deepEqual(snapshot(restored, f.project.projectId, saved.snapshotId), saved);
    } finally {
      restored?.close(); if (scope === 'project' && !restored) f.store.close();
      f.catalog.close(); rmSync(f.root, { recursive: true, force: true });
    }
  }
});

test('admitted identical saved replay uses its pinned choices even when newer unrelated defaults are unsafe', async () => {
  const f = fixture();
  try {
    value(update(f.store, { objective: 'Frozen original objective' }));
    const request = saveRequest(draft(f.store, f.project.projectId));
    const saved = value(f.store.handle(request));
    const canary = 'UnrelatedLaterRecognizedDefault20';
    value(update(f.store, { objective: canary }));
    const matcher = new Sanitizer(); matcher.register(randomUUID(), canary);
    const admit = async (input: unknown) => assertSafeConfiguration(input, matcher);
    assert.deepEqual(value(await f.store.handleAdmitted(request, admit)), saved);
    assert.equal(value(call<ConfigurationSnapshot[]>(f.store, { kind: 'snapshots', projectId: f.project.projectId })).length, 1);
    const current = saveRequest(draft(f.store, f.project.projectId));
    error(await f.store.handleAdmitted(current, admit), 'unavailable');
    assert.equal(value(call<ConfigurationSnapshot[]>(f.store, { kind: 'snapshots', projectId: f.project.projectId })).length, 1);
  } finally { f.cleanup(); }
});


test('minimal defaults recovery preserves scope, revision fencing, immutable history and current policy after restart', async () => {
  const f = fixture();
  let reopened: ConfigurationStore | undefined;
  try {
    value(update(f.store, { objective: 'Safe original default' }));
    const saved = value(f.store.handle(saveRequest(draft(f.store, f.project.projectId)))) as ConfigurationSnapshot;
    const globalCanary = 'RetainedGlobalRecovery20', projectCanary = 'RetainedProjectRecovery20';
    value(update(f.store, { objective: globalCanary }));
    value(update(f.store, { objective: projectCanary }, f.project.projectId));
    const matcher = new Sanitizer(); matcher.register(randomUUID(), globalCanary); matcher.register(randomUUID(), projectCanary);
    const admit = async (input: unknown) => assertSafeConfiguration(input, matcher);
    f.store.close(); reopened = new ConfigurationStore(f.root, f.catalog);
    for (const scope of ['global', 'project'] as const) {
      const projectId = scope === 'project' ? f.project.projectId : null;
      assert.throws(() => assertSafeConfiguration(get(reopened!, projectId ?? undefined), matcher));
      const request = { kind: scope === 'global' ? 'global:recover' : 'project:recover', operationId: randomUUID(), ...(projectId ? { projectId } : {}) } as ConfigurationRequest;
      const identity = value(await reopened.handleAdmitted(request, admit)) as DefaultsRecovery;
      assert.deepEqual(Object.keys(identity).sort(), ['projectId', 'revision', 'scope']);
      assert.equal(identity.scope, scope); assert.equal(identity.projectId, projectId); assert.equal(identity.revision, scope === 'global' ? 2 : 1);
      assertSafeConfiguration(identity, matcher);
      const requestId = randomUUID();
      const replacement = { kind: scope === 'global' ? 'global:update' : 'project:update', operationId: requestId, ...(projectId ? { projectId } : {}), input: { requestId, expectedRevision: identity.revision, values: { objective: 'Explicit safe replacement' } } } as ConfigurationRequest;
      const next = value(await reopened.handleAdmitted(replacement, admit)) as DefaultsRecord;
      assert.equal(next.revision, identity.revision + 1);
      assert.deepEqual(value(await reopened.handleAdmitted(replacement, admit)), next);
      const staleId = randomUUID();
      error(await reopened.handleAdmitted({ ...replacement, operationId: staleId, input: { ...(replacement as Extract<ConfigurationRequest, { kind: 'global:update' }>).input, requestId: staleId } } as ConfigurationRequest, admit), 'conflict');
      error(await reopened.handleAdmitted(request, async () => { throw new Error('policy unavailable'); }), 'unavailable');
    }
    assert.deepEqual(snapshot(reopened, f.project.projectId, saved.snapshotId), saved);
    error(await reopened.handleAdmitted({ kind: 'project:recover', operationId: randomUUID(), projectId: randomUUID() }, admit), 'not_found');
  } finally { reopened?.close(); f.catalog.close(); rmSync(f.root, { recursive: true, force: true }); }
});
