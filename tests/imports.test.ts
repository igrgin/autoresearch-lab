import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, link, mkdir, mkdtemp, readFile, realpath, readdir, rm, rename, symlink, writeFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { ProjectCatalog } from '../src/catalog/catalog';
import { DatasetImports, type ImportCheckpoint } from '../src/importer/importer';
import type { ImportRecord, ImportRequest } from '../src/imports';
import type { ProjectRecord, ProjectReply } from '../src/projects';
import { requestImport } from '../src/importer/host';
import { SafeRecording } from '../src/security/recording';
import { Sanitizer } from '../src/security/sanitizer';
import { PrivateFiles } from '../src/security/private-files';
import { storedMetadataEnvelope } from '../src/security/stored-metadata';
import { ImportPolicyClient, ImportPolicyHost, type ImportPolicyReply, type ImportPolicyRequest } from '../src/importer/policy';

function value<T>(reply: ProjectReply<T>): T { if (!reply.ok) assert.fail(reply.error.message); return reply.value; }
async function fixture(options: ConstructorParameters<typeof DatasetImports>[1] = {}) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'lab-import-')));
  const catalog = new ProjectCatalog(path.join(root, 'app'));
  const requestId = randomUUID();
  const project = value(catalog.handle({ kind: 'create', operationId: requestId, input: { requestId, name: 'Import fixture', folderName: 'import-fixture' } })) as ProjectRecord;
  const source = path.join(root, 'source'); await mkdir(source);
  await mkdir(path.join(source, 'class-one')); await mkdir(path.join(source, 'class-two'));
  await writeFile(path.join(source, 'class-one', 'one.txt'), 'first document\n');
  await writeFile(path.join(source, 'class-two', 'two.txt'), 'second document\n');
  const resolveProject = (projectId: string) => value(catalog.handle({ kind: 'open', operationId: randomUUID(), projectId })) as ProjectRecord;
  const matcher = new Sanitizer(), revoked: string[] = [];
  const securityRoot = path.join(root, 'import-security');
  let recording = new SafeRecording(new PrivateFiles(securityRoot), matcher, async id => { revoked.push(id); });
  await recording.initialize();
  const policyCalls = { pieces: 0, revisions: 0 };
  const recordingPort = { recheck: (record: Parameters<SafeRecording['recheck']>[0]) => { policyCalls.pieces++; return recording.recheck(record); },
    metadataRevision: (meta: Parameters<SafeRecording['metadataRevision']>[0]) => { policyCalls.revisions++; return recording.metadataRevision(meta); } };
  const importOptions = { recording: recordingPort, ownMetadata: () => ({ release: matcher.holdMatchingPolicy(), recording: options.recording ?? recordingPort }), ...options };
  const security = { get recording() { return recording; }, initialize: () => recording.initialize(),
    assertSafeConfiguration: (input: unknown) => { if (matcher.filter(input).redacted) throw new Error(); } };
  let imports = new DatasetImports(resolveProject, importOptions);
  const request = (request: Omit<Extract<ImportRequest, { kind: 'imports:action' }>, 'projectId' | 'operationId'>) => imports.handle({ ...request, projectId: project.projectId, operationId: randomUUID() });
  return { root, source, project, catalog, matcher, revoked, securityRoot, security, policyCalls, get recording() { return recording; }, get imports() { return imports; }, request,
    async start(mode: 'copy' | 'move' = 'copy', destinationName = 'data', sourcePaths = [source]) {
      const id = randomUUID();
      const records = value(await imports.handle({ kind: 'imports:start', operationId: id, projectId: project.projectId, sourcePaths, destinationName, mode }));
      return records.find(record => record.operationId === id)!.importId;
    },
    async list() { return value(await imports.handle({ kind: 'imports:list', operationId: randomUUID(), projectId: project.projectId })); },
    async record(id: string) { await imports.settled(id); return (await this.list()).find(row => row.importId === id)!; },
    restart() { imports.close(); imports = new DatasetImports(resolveProject, importOptions); },
    async restartSecurity() { recording = new SafeRecording(new PrivateFiles(securityRoot), matcher, async id => { revoked.push(id); }); await recording.initialize(); },
    async cleanup() {
      const filename = path.join(project.location, '.lab', 'imports.sqlite');
      if (await stat(filename).catch(() => undefined)) {
        const db = new Database(filename, { readonly: true });
        const ids = db.prepare('SELECT import_id FROM imports').all() as { import_id: string }[]; db.close();
        for (const row of ids) await imports.settled(row.import_id);
      }
      imports.close(); catalog.close(); await rm(root, { recursive: true, force: true });
    },
  };
}
function action(record: ImportRecord, action: 'retry' | 'cancel' | 'discard' | 'retry_cleanup') { return { kind: 'imports:action' as const, importId: record.importId, expectedRevision: record.revision, action }; }

test('ordinary tokenized directory imports without quarantine', async () => {
  const f = await fixture();
  try {
    const parent = path.join(f.root, 'secret-data', 'password-samples'); await mkdir(parent, { recursive: true });
    const source = path.join(parent, 'tokenized'); await rename(f.source, source);
    const record = await f.record(await f.start('copy', 'ordinary', [source]));
    assert.equal(record.state, 'complete'); assert.equal(record.bytesUsable, true);
    assert.equal(record.completedFiles, 2); assert.equal(record.completedBytes, 31);
    for (const [relative, expected] of [['class-one/one.txt', 'first document\n'], ['class-two/two.txt', 'second document\n']]) {
      assert.equal(await readFile(path.join(f.project.location, record.destination, relative), 'utf8'), expected);
    }
    assert.deepEqual(f.revoked, []); assert.deepEqual(await readdir(f.securityRoot), []);
    assert.equal(JSON.stringify(await f.list()).includes(source), false);
    f.restart(); await f.restartSecurity(); assert.deepEqual((await f.list())[0], record);
    assert.equal((await f.record(await f.start('copy', 'subsequent', [source]))).state, 'complete');
    assert.deepEqual(await readdir(f.securityRoot), []);
  } finally { await f.cleanup(); }
});

test('inventory above record node limit completes without quarantine and remains usable after restart', async () => {
  const f = await fixture();
  try {
    const source = path.join(f.root, 'many'); await mkdir(source);
    for (let offset = 0; offset < 7000; offset += 100) {
      await Promise.all(Array.from({ length: 100 }, (_, i) => writeFile(path.join(source, `${offset + i}.txt`), 'x')));
    }
    const started = performance.now();
    const record = await f.record(await f.start('copy', 'many', [source]));
    assert.equal(record.state, 'complete'); assert.equal(record.bytesUsable, true);
    assert.equal(record.completedFiles, 7000); assert.equal(record.completedBytes, 7000);
    assert.equal((await readdir(path.join(f.project.location, record.destination))).length, 7000);
    for (let offset = 0; offset < 7000; offset += 100) {
      await Promise.all(Array.from({ length: 100 }, async (_, i) => {
        assert.equal(await readFile(path.join(f.project.location, record.destination, `${offset + i}.txt`), 'utf8'), 'x');
      }));
    }
    console.info(`Controlled 7000-file import and byte assertions: ${Math.round(performance.now() - started)}ms; policy calls ${JSON.stringify(f.policyCalls)}`);
    assert.deepEqual(f.revoked, []); assert.deepEqual(await readdir(f.securityRoot), []);
    f.restart(); await f.restartSecurity(); assert.deepEqual((await f.list())[0], record);
    assert.equal((await f.record(await f.start('copy', 'smaller'))).state, 'complete');
    assert.deepEqual(await readdir(f.securityRoot), []);
  } finally { await f.cleanup(); }
});

test('aggregate metadata above the string bound uses bounded pieces and rechecks cached directory identity paths', async () => {
  let checked = 0;
  const f = await fixture({ recording: {
    recheck: async record => {
      checked++;
      assert.ok(Buffer.byteLength(JSON.stringify(record.body)) <= 256 * 1024);
      return f.recording.recheck(record);
    },
    metadataRevision: meta => f.recording.metadataRevision(meta),
  } });
  try {
    const record = await f.record(await f.start()); f.restart();
    const db = new Database(path.join(f.project.location, '.lab', 'imports.sqlite'));
    const saved = JSON.parse((db.prepare('SELECT payload FROM imports').get() as { payload: string }).payload);
    saved.entries = Array.from({ length: 2400 }, (_, i) => ({ ...saved.entries[0],
      relative: `${i}-${'r'.repeat(1000)}.txt`, source: `/controlled/${i}-${'s'.repeat(1000)}.txt` }));
    const canary = 'OnlyInDirectoryIdentity23';
    saved.directoryIds[`/controlled/${canary}`] = '1:2';
    assert.throws(() => new Sanitizer().filter(saved));
    db.prepare('UPDATE imports SET payload = ?').run(JSON.stringify(saved)); db.close();
    assert.deepEqual((await f.list())[0], record);
    const before = checked; await f.list(); assert.equal(checked, before, 'unchanged pieces use current-policy cache');
    await f.restartSecurity(); await f.list(); assert.ok(checked > before, 'a fresh policy instance invalidates cached checks');
    assert.deepEqual(await readdir(f.securityRoot), []);
    const credentialId = randomUUID(); f.matcher.register(credentialId, canary);
    const denied = await f.imports.handle({ kind: 'imports:list', operationId: randomUUID(), projectId: f.project.projectId });
    assert.equal(denied.ok, false); assert.equal(JSON.stringify(denied).includes(canary), false);
    assert.deepEqual(f.revoked, [credentialId]);
    f.matcher.forget(credentialId); f.restart(); await f.restartSecurity();
    assert.equal((await f.imports.handle({ kind: 'imports:list', operationId: randomUUID(), projectId: f.project.projectId })).ok, false);
  } finally { await f.cleanup(); }
});

test('a matcher change during a multi-piece scan invalidates earlier admitted pieces', async () => {
  const canary = 'EarlierHeaderOnly23', credentialId = randomUUID(); let armed = false;
  const f = await fixture({ recording: {
    recheck: async record => {
      if (armed && record.body && typeof record.body === 'object' && 'directories' in record.body) {
        armed = false; f.matcher.register(credentialId, canary);
      }
      return f.recording.recheck(record);
    },
    metadataRevision: meta => f.recording.metadataRevision(meta),
  } });
  try {
    await f.record(await f.start()); f.restart();
    const db = new Database(path.join(f.project.location, '.lab', 'imports.sqlite'));
    const saved = JSON.parse((db.prepare('SELECT payload FROM imports').get() as { payload: string }).payload);
    saved.view.problem = canary; db.prepare('UPDATE imports SET payload = ?').run(JSON.stringify(saved)); db.close();
    armed = true;
    const denied = await f.imports.handle({ kind: 'imports:list', operationId: randomUUID(), projectId: f.project.projectId });
    assert.equal(armed, false); assert.equal(denied.ok, false); assert.deepEqual(f.revoked, [credentialId]);
    assert.equal(JSON.stringify(denied).includes(canary), false);
  } finally { await f.cleanup(); }
});

test('an unavailable policy revision cannot reuse cached metadata or expose service errors', async () => {
  let unavailable = false;
  const f = await fixture({ recording: {
    recheck: record => f.recording.recheck(record),
    metadataRevision: meta => {
      if (unavailable) throw new Error('unsafe revision diagnostic');
      return f.recording.metadataRevision(meta);
    },
  } });
  try {
    const record = await f.record(await f.start()); unavailable = true;
    const denied = await f.imports.handle({ kind: 'imports:list', operationId: randomUUID(), projectId: f.project.projectId });
    assert.equal(denied.ok, false); assert.equal(JSON.stringify(denied).includes('unsafe revision diagnostic'), false);
    unavailable = false; assert.deepEqual((await f.list())[0], record);
    assert.deepEqual(await readdir(f.securityRoot), []);
  } finally { await f.cleanup(); }
});

test('copy publishes independent verified bytes and relative location, persists after restart, never claims research readiness', async () => {
  const f = await fixture();
  try {
    const id = await f.start(); const result = await f.record(id);
    assert.equal(result.state, 'complete'); assert.equal(result.bytesUsable, true); assert.equal(result.researchReadiness, 'not_prepared');
    assert.equal(result.destination, 'dataset/data/files'); assert.equal(result.totalFiles, 2); assert.equal(result.completedFiles, 2);
    const destination = path.join(f.project.location, result.destination, 'class-one', 'one.txt');
    assert.equal(await readFile(destination, 'utf8'), 'first document\n');
    assert.notEqual((await stat(destination)).ino, (await stat(path.join(f.source, 'class-one', 'one.txt'))).ino);
    assert.equal((await stat(destination)).nlink, 1);
    await writeFile(path.join(f.source, 'class-one', 'one.txt'), 'source mutation');
    assert.equal(await readFile(destination, 'utf8'), 'first document\n');
    f.restart(); assert.deepEqual((await f.list())[0], result);
    const db = new Database(path.join(f.project.location, '.lab', 'imports.sqlite'), { readonly: true });
    const saved = JSON.parse((db.prepare('SELECT payload FROM imports').get() as { payload: string }).payload);
    assert.match(saved.entries[0].digest, /^[a-f0-9]{64}$/); assert.equal(saved.entries[0].copied, true); db.close();
  } finally { await f.cleanup(); }
});

test('selected CSV/JSONL shards import without parsing or changing task/data meaning', async () => {
  const f = await fixture();
  try {
    const csv = path.join(f.root, 'shard.csv'); const jsonl = path.join(f.root, 'shard.jsonl');
    await writeFile(csv, 'feature,target\n3,yes\n'); await writeFile(jsonl, '{"feature":4,"target":"no"}\n');
    const result = await f.record(await f.start('copy', 'records', [csv, jsonl]));
    assert.equal(result.state, 'complete'); assert.equal(await readFile(path.join(f.project.location, result.destination, 'shard.csv'), 'utf8'), 'feature,target\n3,yes\n');
    assert.equal(result.preparationRef, null);
  } finally { await f.cleanup(); }
});

test('cancellation preserves source, records partial inventory, verifies staged bytes on retry and supports discard', async () => {
  let cancel = false; let release!: () => void; let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }); const reached = new Promise<void>(resolve => { entered = resolve; });
  const f = await fixture({ checkpoint: async stage => { if (stage === 'copied' && !cancel) { cancel = true; entered(); await gate; } } });
  try {
    const id = await f.start(); await reached;
    let current = (await f.list())[0]; assert.equal(current.completedFiles, 1); assert.ok(current.completedBytes > 0);
    value(await f.request(action(current, 'cancel'))); release(); current = await f.record(id);
    assert.equal(current.state, 'partial'); assert.equal(current.bytesUsable, false); assert.equal(current.failedFiles, 1);
    assert.match(current.problem!, /cancelled/); assert.equal(await readFile(path.join(f.source, 'class-one', 'one.txt'), 'utf8'), 'first document\n');
    await writeFile(path.join(f.project.location, '.lab', 'imports', id, 'files', 'class-one', 'one.txt'), 'corrupted-stage');
    value(await f.request(action(current, 'retry'))); assert.equal((await f.record(id)).state, 'complete');
    const unavailableId = await f.start('copy', 'partial', [path.join(f.root, 'missing.txt')]);
    const missing = await f.record(unavailableId); assert.equal(missing.state, 'partial'); assert.match(missing.problem!, /unavailable/);
    value(await f.request(action(missing, 'discard'))); assert.equal((await f.record(unavailableId)).state, 'discarded');
  } finally { release(); await f.cleanup(); }
});

test('source mutation during copy blocks publication and stable retry requires a new import', async () => {
  let changed = false;
  const f = await fixture({ checkpoint: async stage => { if (stage === 'copied' && !changed) { changed = true; await writeFile(path.join(f.source, 'class-one', 'one.txt'), 'changed data'); } } });
  try {
    const id = await f.start(); let result = await f.record(id); assert.equal(result.state, 'partial'); assert.equal(result.bytesUsable, false); assert.match(result.problem!, /changed/);
    value(await f.request(action(result, 'retry'))); result = await f.record(id); assert.equal(result.state, 'partial');
    value(await f.request(action(result, 'discard'))); const fresh = await f.record(await f.start()); assert.equal(fresh.state, 'complete');
  } finally { await f.cleanup(); }
});

test('occupied destination, including empty folder, is never merged or overwritten', async () => {
  const f = await fixture();
  try {
    await mkdir(path.join(f.project.location, 'dataset', 'data'), { recursive: true });
    const sentinel = path.join(f.project.location, 'dataset', 'data', 'existing.txt'); await writeFile(sentinel, 'preserve');
    const result = await f.record(await f.start()); assert.equal(result.state, 'partial'); assert.match(result.problem!, /occupied/);
    value(await f.request(action(result, 'discard'))); assert.equal(await readFile(sentinel, 'utf8'), 'preserve');
    await mkdir(path.join(f.project.location, 'dataset', 'empty'));
    assert.equal((await f.record(await f.start('copy', 'empty'))).state, 'partial');
  } finally { await f.cleanup(); }
});

test('an unowned empty files subtree can discard its pre-inventory conflict without deleting the destination', async () => {
  const f = await fixture();
  try {
    const destination = path.join(f.project.location, 'dataset', 'data', 'files');
    await mkdir(destination, { recursive: true }); const original = await stat(destination);
    const id = await f.start(); const partial = await f.record(id);
    assert.equal(partial.state, 'partial'); assert.equal(partial.totalFiles, 0);
    value(await f.request(action(partial, 'discard')));
    assert.equal((await f.record(id)).state, 'discarded'); assert.equal((await stat(destination)).ino, original.ino);
    f.restart(); assert.equal((await f.record(id)).state, 'discarded');
    // The old reservation is gone; another attempt can be recorded, but it must
    // still preserve the occupied destination rather than merge into it.
    const next = await f.record(await f.start()); assert.equal(next.state, 'partial');
    value(await f.request(action(next, 'discard')));
    assert.equal((await stat(destination)).ino, original.ino);
  } finally { await f.cleanup(); }
});

test('all import replies recheck retained metadata and persist exposure quarantine before disclosure', async () => {
  const f = await fixture();
  try {
    const canary = 'LaterRecognizedImportDestination23';
    const record = await f.record(await f.start('copy', canary));
    const otherCanary = 'AnotherLaterRecognizedDestination23';
    const otherRecord = await f.record(await f.start('copy', otherCanary));
    const credentialId = randomUUID(), otherCredentialId = randomUUID();
    const { matcher, revoked, recording, security } = f; const records = f.securityRoot;
    matcher.register(credentialId, canary); matcher.register(otherCredentialId, otherCanary);
    const call = (request: ImportRequest) => requestImport(request, input => f.imports.handle(input), security);
    const requests: ImportRequest[] = [
      { kind: 'imports:list', operationId: randomUUID(), projectId: f.project.projectId },
      { kind: 'imports:action', operationId: randomUUID(), projectId: f.project.projectId, importId: record.importId, expectedRevision: record.revision, action: 'cancel' },
      { kind: 'imports:start', operationId: randomUUID(), projectId: f.project.projectId, sourcePaths: [f.source], destinationName: 'OtherSafeImport', mode: 'copy' },
    ];
    for (const request of requests) {
      const reply = await call(request); assert.equal(reply.ok, false); assert.equal(JSON.stringify(reply).includes(canary), false);
      if (!reply.ok) assert.equal(reply.error.effect, 'none'); // Withheld before operation reuse.
    }
    assert.ok(revoked.includes(credentialId)); assert.ok(revoked.includes(otherCredentialId));
    const state = await readFile(path.join(records, 'security-state.json'), 'utf8');
    assert.equal(state.includes(canary), false); assert.equal(state.includes(otherCanary), false);
    assert.ok(state.includes(record.importId)); assert.ok(state.includes(otherRecord.importId));
    assert.doesNotThrow(() => recording.assertCanAct({ projectId: f.project.projectId, runId: record.importId,
      actionId: randomUUID(), operationId: randomUUID() })); // Metadata fencing uses a separate namespace.
    // Quarantine is durable even if matching material is subsequently removed.
    await f.imports.settled(record.importId); await f.imports.settled(otherRecord.importId);
    f.restart(); matcher.forget(credentialId); matcher.forget(otherCredentialId);
    assert.equal((await call(requests[0])).ok, false);
  } finally { await f.cleanup(); }
});

for (const kind of ['list', 'action'] as const) test(`late source-only credential recognition contains private import metadata on ${kind}`, async () => {
  const f = await fixture();
  try {
    const canary = 'LaterRecognizedPrivateSource23';
    const source = path.join(f.root, canary); await rename(f.source, source);
    const record = await f.record(await f.start('move', 'safe-destination', [source]));
    const credentialId = randomUUID();
    const { matcher, revoked, security } = f; const records = f.securityRoot;
    matcher.register(credentialId, canary);
    const request: ImportRequest = kind === 'list' ? { kind: 'imports:list', operationId: randomUUID(), projectId: f.project.projectId }
      : { ...action(record, 'cancel'), operationId: randomUUID(), projectId: f.project.projectId };
    const reply = await requestImport(request, input => f.imports.handle(input), security);
    assert.equal(reply.ok, false, 'complete private source metadata must be checked before reuse');
    assert.equal(JSON.stringify(reply).includes(source), false); assert.equal(JSON.stringify(reply).includes(canary), false);
    assert.deepEqual(revoked, [credentialId]);
    const state = await readFile(path.join(records, 'security-state.json'), 'utf8');
    assert.equal(state.includes(source), false); assert.equal(state.includes(canary), false); assert.ok(state.includes(record.importId));
    assert.deepEqual(await readdir(records), ['security-state.json']);
    // In-place quarantine preserves the sole original payload but makes every
    // private reuse unavailable, even after security restart and remediation.
    const db = new Database(path.join(f.project.location, '.lab', 'imports.sqlite'), { readonly: true });
    const payload = (db.prepare('SELECT payload FROM imports').get() as { payload: string }).payload; db.close();
    const saved = JSON.parse(payload);
    assert.deepEqual(saved.sources, [source]); assert.equal(saved.sourceRoot, source);
    assert.ok(saved.directories.includes(source)); assert.ok(saved.entries.every((entry: { source: string }) => entry.source.startsWith(source)));
    f.restart(); matcher.forget(credentialId); await f.restartSecurity();
    const incident = JSON.parse(state).incidents[0];
    await f.recording.recover(incident.incidentId, { replacementVerified: true, boundaryVerified: true, effectsReconciled: true,
      containmentComplete: true, explicitResume: true, freshSessionId: randomUUID() });
    for (const request of [
      { kind: 'imports:list' as const, operationId: randomUUID(), projectId: f.project.projectId },
      ...(['retry', 'retry_cleanup', 'discard', 'cancel'] as const).map(kind => ({ ...action(record, kind), operationId: randomUUID(), projectId: f.project.projectId })),
    ]) {
      const denied = await requestImport(request, input => f.imports.handle(input), security);
      assert.equal(denied.ok, false); assert.equal(JSON.stringify(denied).includes(source), false);
    }
    await assert.rejects(f.imports.confirmPreparation(f.project.projectId, record.importId, record.revision, randomUUID()), /withheld by credential protection/);
    assert.equal(await readFile(path.join(source, 'class-one', 'one.txt'), 'utf8'), 'first document\n');
    assert.equal(await readFile(path.join(f.project.location, record.destination, 'class-two', 'two.txt'), 'utf8'), 'second document\n');
    const reopened = new Database(path.join(f.project.location, '.lab', 'imports.sqlite'), { readonly: true });
    assert.equal((reopened.prepare('SELECT payload FROM imports').get() as { payload: string }).payload, payload); reopened.close();
    assert.deepEqual(await readdir(records), ['security-state.json']);
    assert.equal((await readFile(path.join(records, 'security-state.json'), 'utf8')).includes(canary), false);
  } finally { await f.cleanup(); }
});

for (const response of ['unavailable', 'omitted', 'changed'] as const) test(`private import recheck fails closed on ${response} security response`, async () => {
  let deny = false;
  const f = await fixture({ recording: { recheck: async record => {
    if (!deny) return recording.recheck(record);
    if (response === 'unavailable') throw new Error('unsafe private service diagnostic');
    if (response === 'omitted') return { ...record, body: null, coverage: 'omitted', omission: 'filter_unavailable' };
    return { ...record, body: { changed: true } };
  } } }); const recording = f.recording;
  try {
    const record = await f.record(await f.start('move')); deny = true;
    const requests: ImportRequest[] = [
      { kind: 'imports:list', operationId: randomUUID(), projectId: f.project.projectId },
      { ...action(record, 'cancel'), operationId: randomUUID(), projectId: f.project.projectId },
      { kind: 'imports:start', operationId: randomUUID(), projectId: f.project.projectId, sourcePaths: [f.source], destinationName: 'another', mode: 'copy' },
    ];
    for (const request of requests) {
      const reply = await requestImport(request, input => f.imports.handle(input), f.security);
      assert.equal(reply.ok, false); assert.equal(JSON.stringify(reply).includes(f.source), false);
      assert.equal(JSON.stringify(reply).includes('unsafe private service diagnostic'), false);
      if (!reply.ok) assert.match(reply.error.message, /^Import records were withheld by credential protection\./);
    }
    await assert.rejects(f.imports.confirmPreparation(f.project.projectId, record.importId, record.revision, randomUUID()), /withheld by credential protection/);
    assert.equal(await readFile(path.join(f.source, 'class-one', 'one.txt'), 'utf8'), 'first document\n');
    deny = false; assert.equal((await f.list())[0].revision, record.revision);
  } finally { deny = false; await f.cleanup(); }
});

test('policy failure after retry is durably accepted reports partial effect and recovers without duplicate publication', async () => {
  let failCopy = true, arm = false, deny = false, inventorying = false;
  const f = await fixture({ checkpoint: stage => { if (stage === 'copied' && failCopy) { failCopy = false; throw new Error('controlled copy failure'); } },
    recording: { recheck: async record => {
      if (deny) throw new Error('controlled policy unavailable');
      const checked = await recording.recheck(record);
      const body = record.body as unknown as { view?: ImportRecord; directoryIds?: unknown[] };
      if (body.view) inventorying = body.view.state === 'inventorying';
      // The final fixture inventory piece completes this check; the next
      // boundary fails only after retry's inventorying revision is persisted.
      if (arm && inventorying && body.directoryIds) { arm = false; deny = true; }
      return checked;
    } } }); const recording = f.recording;
  try {
    const id = await f.start(); const partial = await f.record(id); assert.equal(partial.state, 'partial'); arm = true;
    const reply = await f.request(action(partial, 'retry')); await f.imports.settled(id);
    assert.equal(reply.ok, false);
    if (!reply.ok) { assert.equal(reply.error.effect, 'partial'); assert.match(reply.error.message, /withheld by credential protection/); }
    const db = new Database(path.join(f.project.location, '.lab', 'imports.sqlite'), { readonly: true });
    const saved = JSON.parse((db.prepare('SELECT payload FROM imports').get() as { payload: string }).payload); db.close();
    assert.equal(saved.view.state, 'inventorying'); assert.ok(saved.view.revision > partial.revision);
    assert.equal(await readFile(path.join(f.source, 'class-one', 'one.txt'), 'utf8'), 'first document\n');
    deny = false; f.restart(); const recovered = (await f.list())[0];
    assert.equal(recovered.state, 'partial'); value(await f.request(action(recovered, 'retry')));
    assert.equal((await f.record(id)).state, 'complete'); assert.equal((await f.list()).length, 1);
  } finally { deny = false; await f.cleanup(); }
});

test('omitting the private import security port cannot silently admit or reuse metadata', async () => {
  const f = await fixture({ recording: undefined });
  try {
    const reply = await f.imports.handle({ kind: 'imports:start', projectId: f.project.projectId, operationId: randomUUID(),
      sourcePaths: [f.source], destinationName: 'safe-name', mode: 'copy' });
    assert.equal(reply.ok, false);
    if (!reply.ok) assert.match(reply.error.message, /withheld by credential protection/);
    await assert.rejects(stat(path.join(f.project.location, 'dataset')), { code: 'ENOENT' });
  } finally { await f.cleanup(); }
});

for (const stage of ['copied', 'before_unlink'] as const) test(`background ${stage} work stops when private metadata becomes quarantined`, async () => {
  const canary = 'BackgroundPrivateSource23', credentialId = randomUUID();
  let armed = false;
  const f = await fixture({ checkpoint: checkpoint => {
    if (armed && checkpoint === stage) { armed = false; f.matcher.register(credentialId, canary); }
  } });
  try {
    const source = path.join(f.root, canary); await rename(f.source, source);
    if (stage === 'copied') armed = true;
    const id = await f.start('move', 'safe-background', [source]);
    await f.imports.settled(id);
    if (stage === 'before_unlink') {
      const record = (await f.list())[0]; armed = true;
      await f.imports.confirmPreparation(f.project.projectId, id, record.revision, randomUUID());
      await f.imports.settled(id);
      assert.equal(await readFile(path.join(f.project.location, record.destination, 'class-two', 'two.txt'), 'utf8'), 'second document\n');
    }
    assert.equal((await f.imports.handle({ kind: 'imports:list', operationId: randomUUID(), projectId: f.project.projectId })).ok, false);
    assert.deepEqual(f.revoked, [credentialId]);
    assert.equal(await readFile(path.join(source, 'class-one', 'one.txt'), 'utf8'), 'first document\n');
    assert.equal(await readFile(path.join(source, 'class-two', 'two.txt'), 'utf8'), 'second document\n');
    f.restart(); f.matcher.forget(credentialId); await f.restartSecurity();
    assert.equal((await f.imports.handle({ kind: 'imports:list', operationId: randomUUID(), projectId: f.project.projectId })).ok, false);
    const state = await readFile(path.join(f.securityRoot, 'security-state.json'), 'utf8');
    assert.equal(state.includes(canary), false); assert.deepEqual(await readdir(f.securityRoot), ['security-state.json']);
  } finally { await f.cleanup(); }
});

test('rejects symlinks, source/project ancestry overlap, unsupported files and normalization collisions', async () => {
  const f = await fixture();
  try {
    await symlink(path.join(f.source, 'class-one', 'one.txt'), path.join(f.source, 'linked.txt'));
    let result = await f.record(await f.start('copy', 'symlink')); assert.match(result.problem!, /Symlink/);
    result = await f.record(await f.start('copy', 'overlap', [f.project.location])); assert.match(result.problem!, /overlap/);
    result = await f.record(await f.start('copy', 'parent', [f.root])); assert.match(result.problem!, /overlap/);
    const first = path.join(f.root, 'upper'); const second = path.join(f.root, 'lower'); await mkdir(first); await mkdir(second);
    const a = path.join(first, 'Data.txt'); const b = path.join(second, 'data.txt'); await writeFile(a, 'a'); await writeFile(b, 'b');
    result = await f.record(await f.start('copy', 'collision', [a, b])); assert.match(result.problem!, /collision/);
    const c = path.join(first, 'é.txt'); const d = path.join(second, 'e\u0301.txt'); await writeFile(c, 'c'); await writeFile(d, 'd');
    result = await f.record(await f.start('copy', 'unicode', [c, d])); assert.match(result.problem!, /collision/);
    const archive = path.join(f.root, 'archive.zip'); await writeFile(archive, 'unsupported');
    result = await f.record(await f.start('copy', 'archive', [archive])); assert.match(result.problem!, /Unsupported/);
    result = await f.record(await f.start('move', 'file-move', [a])); assert.match(result.problem!, /dedicated/);
  } finally { await f.cleanup(); }
});

test('space estimate and ENOSPC failure remain recoverable and preserve an earlier usable dataset', async () => {
  let space = Number.MAX_SAFE_INTEGER; let diskFull = false;
  const f = await fixture({ availableBytes: async () => space, checkpoint: stage => { if (stage === 'copied' && diskFull) throw Object.assign(new Error('raw unsafe diagnostic'), { code: 'ENOSPC' }); } });
  try {
    const first = await f.record(await f.start()); space = 0;
    const low = await f.record(await f.start('copy', 'low')); assert.match(low.problem!, /Insufficient/); assert.equal(low.bytesUsable, false);
    space = Number.MAX_SAFE_INTEGER; diskFull = true;
    const id = await f.start('copy', 'full'); let result = await f.record(id); assert.match(result.problem!, /Insufficient/); assert.ok(!result.problem!.includes('raw unsafe'));
    assert.equal((await f.list()).find(row => row.importId === first.importId)!.bytesUsable, true);
    diskFull = false; value(await f.request(action(result, 'retry'))); result = await f.record(id); assert.equal(result.state, 'complete');
  } finally { await f.cleanup(); }
});

test('publication failure retains staging; retry reconciles a copy published before registration', async () => {
  let failAt: ImportCheckpoint | null = 'reserved';
  const f = await fixture({ checkpoint: stage => { if (stage === failAt) { failAt = null; throw new Error('injected crash boundary'); } } });
  try {
    const id = await f.start(); let result = await f.record(id); assert.equal(result.state, 'partial');
    value(await f.request(action(result, 'retry'))); result = await f.record(id); assert.equal(result.state, 'complete');
    failAt = 'published'; const secondId = await f.start('move', 'published'); let second = await f.record(secondId);
    assert.equal(second.bytesUsable, false); assert.equal(second.state, 'partial');
    assert.equal((await f.request(action(second, 'discard'))).ok, false);
    f.restart(); second = (await f.list()).find(row => row.importId === secondId)!;
    value(await f.request(action(second, 'retry'))); second = await f.record(secondId); assert.equal(second.bytesUsable, true); assert.equal(second.state, 'cleanup_pending');
    assert.equal(await readFile(path.join(f.source, 'class-one', 'one.txt'), 'utf8'), 'first document\n');
  } finally { await f.cleanup(); }
});

test('move retains source until trusted confirmation; cleanup failure and new/changed files preserve the published copy', async () => {
  let deny = true;
  const f = await fixture({ checkpoint: stage => { if (stage === 'before_unlink' && deny) throw Object.assign(new Error('permission failure'), { code: 'EACCES' }); } });
  try {
    const id = await f.start('move'); let result = await f.record(id); assert.equal(result.state, 'cleanup_pending'); assert.equal(result.preparationRef, null);
    assert.equal((await f.request(action(result, 'retry_cleanup'))).ok, false);
    await f.imports.confirmPreparation(f.project.projectId, id, result.revision, randomUUID()); result = await f.record(id);
    assert.equal(result.state, 'cleanup_pending'); assert.equal(result.bytesUsable, true); assert.equal(result.remainingSourceFiles, 2); assert.match(result.problem!, /cleanup incomplete/);
    deny = false; await writeFile(path.join(f.source, 'new.txt'), 'new entry'); await writeFile(path.join(f.source, 'class-one', 'one.txt'), 'changed entry');
    value(await f.request(action(result, 'retry_cleanup'))); result = await f.record(id);
    assert.equal(result.remainingSourceFiles, 1); assert.equal(result.state, 'cleanup_pending');
    assert.equal(await readFile(path.join(f.source, 'new.txt'), 'utf8'), 'new entry'); assert.equal(await readFile(path.join(f.source, 'class-one', 'one.txt'), 'utf8'), 'changed entry');
    assert.equal(await readFile(path.join(f.project.location, result.destination, 'class-one', 'one.txt'), 'utf8'), 'first document\n');
    assert.deepEqual(await readdir(path.join(f.source, 'class-one')), ['one.txt']);
  } finally { await f.cleanup(); }
});

test('post-unlink failure reconciles deletion intent after the source root was removed and restart', async () => {
  let unlinked = 0;
  const f = await fixture({ checkpoint: stage => {
    if (stage === 'unlinked' && ++unlinked === 2) throw Object.assign(new Error('controlled post-unlink failure'), { code: 'EIO' });
  } });
  try {
    const id = await f.start('move'); let result = await f.record(id);
    await f.imports.confirmPreparation(f.project.projectId, id, result.revision, randomUUID());
    result = await f.record(id);
    assert.equal(result.state, 'cleanup_pending'); assert.equal(result.remainingSourceFiles, 1);
    await assert.rejects(stat(f.source), { code: 'ENOENT' });
    f.restart(); result = (await f.list()).find(row => row.importId === id)!;
    value(await f.request(action(result, 'retry_cleanup'))); result = await f.record(id);
    assert.equal(result.state, 'complete'); assert.equal(result.remainingSourceFiles, 0);
    assert.equal(await readFile(path.join(f.project.location, result.destination, 'class-one', 'one.txt'), 'utf8'), 'first document\n');
    assert.equal(await readFile(path.join(f.project.location, result.destination, 'class-two', 'two.txt'), 'utf8'), 'second document\n');
  } finally { await f.cleanup(); }
});

for (const replacement of ['symlink', 'new-file', 'changed-file'] as const) test(`deletion-intent recovery preserves ${replacement} source replacement`, async () => {
  let unlinked = 0;
  const f = await fixture({ checkpoint: stage => {
    if (stage === 'unlinked' && ++unlinked === 2) throw Object.assign(new Error('controlled post-unlink failure'), { code: 'EIO' });
  } });
  try {
    const id = await f.start('move'); let record = await f.record(id);
    await f.imports.confirmPreparation(f.project.projectId, id, record.revision, randomUUID()); await f.imports.settled(id);
    await assert.rejects(stat(f.source), { code: 'ENOENT' });
    const other = path.join(f.root, 'replacement'); await mkdir(other);
    if (replacement === 'symlink') await symlink(other, f.source);
    else await mkdir(f.source);
    const root = replacement === 'symlink' ? other : f.source;
    await mkdir(path.join(root, 'class-two'));
    const file = path.join(root, 'class-two', replacement === 'new-file' ? 'new.txt' : 'two.txt');
    await writeFile(file, 'preserve replacement');
    f.restart(); record = (await f.list())[0];
    value(await f.request(action(record, 'retry_cleanup'))); record = await f.record(id);
    assert.equal(record.state, 'cleanup_pending');
    assert.equal(await readFile(file, 'utf8'), 'preserve replacement');
    assert.equal(await readFile(path.join(f.project.location, record.destination, 'class-two', 'two.txt'), 'utf8'), 'second document\n');
  } finally { await f.cleanup(); }
});

test('source replacement while deletion-intent policy checking awaits is preserved', async () => {
  let source = ''; let changed = false;
  const f = await fixture({ recording: { recheck: async record => {
    const saved = record.body as unknown as { entries: { deletionIntent?: boolean; removed: boolean }[] };
    if (source && !changed && saved.entries?.some(entry => entry.deletionIntent && !entry.removed)) {
      changed = true; await writeFile(path.join(source, 'class-one', 'one.txt'), 'changed during private IPC');
    }
    return recording.recheck(record);
  } } }); const recording = f.recording; source = f.source;
  try {
    const id = await f.start('move'); let record = await f.record(id);
    await f.imports.confirmPreparation(f.project.projectId, id, record.revision, randomUUID()); record = await f.record(id);
    assert.equal(changed, true); assert.equal(record.state, 'cleanup_pending'); assert.equal(record.remainingSourceFiles, 1);
    assert.equal(await readFile(path.join(source, 'class-one', 'one.txt'), 'utf8'), 'changed during private IPC');
    assert.equal(await readFile(path.join(f.project.location, record.destination, 'class-one', 'one.txt'), 'utf8'), 'first document\n');
  } finally { await f.cleanup(); }
});

test('confirmed dedicated move removes only matching files and completes cleanup; duplicate start is idempotent', async () => {
  const f = await fixture();
  try {
    const id = await f.start('move'); let result = await f.record(id);
    const duplicate = value(await f.imports.handle({ kind: 'imports:start', operationId: result.operationId, projectId: f.project.projectId, sourcePaths: [f.source], destinationName: 'data', mode: 'move' }));
    assert.equal(duplicate.length, 1); assert.equal(duplicate[0].revision, result.revision);
    const conflict = await f.imports.handle({ kind: 'imports:start', operationId: result.operationId, projectId: f.project.projectId, sourcePaths: [f.source], destinationName: 'different', mode: 'move' }); assert.equal(conflict.ok, false);
    await f.imports.confirmPreparation(f.project.projectId, id, result.revision, randomUUID()); result = await f.record(id);
    assert.equal(result.state, 'complete'); assert.equal(result.remainingSourceFiles, 0); await assert.rejects(stat(f.source), { code: 'ENOENT' });
    assert.equal(await readFile(path.join(f.project.location, result.destination, 'class-two', 'two.txt'), 'utf8'), 'second document\n');
  } finally { await f.cleanup(); }
});

async function sourceAliases(f: Awaited<ReturnType<typeof fixture>>) {
  const first = path.join(f.source, 'class-one', 'one.txt'), second = path.join(f.source, 'class-two', 'two.txt');
  await rm(second); await link(first, second);
  assert.equal((await stat(first)).ino, (await stat(second)).ino);
  return { first, second };
}
async function independentAliasCopies(f: Awaited<ReturnType<typeof fixture>>, record: ImportRecord, sourceInode: number) {
  const first = path.join(f.project.location, record.destination, 'class-one', 'one.txt');
  const second = path.join(f.project.location, record.destination, 'class-two', 'two.txt');
  for (const file of [first, second]) {
    assert.equal(await readFile(file, 'utf8'), 'first document\n');
    assert.equal((await stat(file)).nlink, 1); assert.notEqual((await stat(file)).ino, sourceInode);
  }
  assert.notEqual((await stat(first)).ino, (await stat(second)).ino);
}

test('confirmed move of hard-linked source aliases cleans both names and keeps independent destination bytes', async () => {
  const f = await fixture();
  try {
    const { first } = await sourceAliases(f); const sourceInode = (await stat(first)).ino;
    const id = await f.start('move'); let record = await f.record(id);
    assert.equal(record.state, 'cleanup_pending');
    await independentAliasCopies(f, record, sourceInode);
    await f.imports.confirmPreparation(f.project.projectId, id, record.revision, randomUUID()); record = await f.record(id);
    assert.equal(record.state, 'complete'); assert.equal(record.remainingSourceFiles, 0);
    await assert.rejects(stat(f.source), { code: 'ENOENT' });
    await independentAliasCopies(f, record, sourceInode);
  } finally { await f.cleanup(); }
});

test('SIGKILL after the first hard-link unlink recovers alias cleanup after restart', async () => {
  const f = await fixture();
  try {
    const { first, second } = await sourceAliases(f); const sourceInode = (await stat(first)).ino;
    const operationId = randomUUID();
    const child = spawnSync(process.execPath, [path.resolve('.webpack/tests/import-crash-worker.cjs'), path.join(f.root, 'app'), f.project.projectId, f.source, operationId, 'unlinked', 'move'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 30000 });
    assert.equal(child.signal, 'SIGKILL', child.stderr);
    await assert.rejects(stat(first), { code: 'ENOENT' }); assert.equal(await readFile(second, 'utf8'), 'first document\n');
    f.restart(); let record = (await f.list()).find(row => row.operationId === operationId)!;
    assert.equal(record.state, 'cleanup_pending'); assert.ok(record.preparationRef);
    value(await f.request(action(record, 'retry_cleanup'))); record = await f.record(record.importId);
    assert.equal(record.state, 'complete'); assert.equal(record.remainingSourceFiles, 0);
    await assert.rejects(stat(f.source), { code: 'ENOENT' });
    await independentAliasCopies(f, record, sourceInode);
  } finally { await f.cleanup(); }
});

for (const timing of ['before confirmation', 'after unlink restart'] as const) {
  for (const mutation of ['changed bytes', 'same-byte replacement', 'symlink', 'ctime only'] as const) test(`hard-link cleanup preserves ${mutation} ${timing}`, async () => {
    const f = await fixture();
    try {
      const { first, second } = await sourceAliases(f); const sourceInode = (await stat(first)).ino;
      let record: ImportRecord;
      if (timing === 'before confirmation') record = await f.record(await f.start('move'));
      else {
        const operationId = randomUUID();
        const child = spawnSync(process.execPath, [path.resolve('.webpack/tests/import-crash-worker.cjs'), path.join(f.root, 'app'), f.project.projectId, f.source, operationId, 'unlinked', 'move'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 30000 });
        assert.equal(child.signal, 'SIGKILL', child.stderr); f.restart();
        record = (await f.list()).find(row => row.operationId === operationId)!;
      }
      const before = await stat(second); let expected = 'first document\n';
      if (mutation === 'changed bytes') { expected = 'externally changed bytes\n'; await writeFile(second, expected); }
      else if (mutation === 'same-byte replacement') { await rename(second, path.join(f.root, 'retained-original.txt')); await writeFile(second, expected); assert.notEqual((await stat(second)).ino, before.ino); }
      else if (mutation === 'symlink') { await rm(second); const target = path.join(f.root, 'external.txt'); await writeFile(target, expected); await symlink(target, second); }
      else { await chmod(second, 0o400); await chmod(second, before.mode & 0o777); assert.notEqual((await stat(second)).ctimeMs, before.ctimeMs); assert.equal((await stat(second)).mtimeMs, before.mtimeMs); }
      if (timing === 'before confirmation') await f.imports.confirmPreparation(f.project.projectId, record.importId, record.revision, randomUUID());
      else value(await f.request(action(record, 'retry_cleanup')));
      record = await f.record(record.importId);
      assert.equal(record.state, 'cleanup_pending'); assert.ok(record.remainingSourceFiles >= 1); assert.equal(record.bytesUsable, true);
      assert.equal(await readFile(second, 'utf8'), expected);
      await independentAliasCopies(f, record, sourceInode);
      f.restart(); record = (await f.list())[0]; value(await f.request(action(record, 'retry_cleanup'))); record = await f.record(record.importId);
      assert.equal(record.state, 'cleanup_pending'); assert.equal(await readFile(second, 'utf8'), expected);
    } finally { await f.cleanup(); }
  });
}

test('SIGKILL before the alias unlink receipt retains uncertain source authority on every retry', async () => {
  const f = await fixture();
  try {
    const { first, second } = await sourceAliases(f); const sourceInode = (await stat(first)).ino;
    const operationId = randomUUID();
    const child = spawnSync(process.execPath, [path.resolve('.webpack/tests/import-crash-worker.cjs'), path.join(f.root, 'app'), f.project.projectId, f.source, operationId, 'unlink_unrecorded', 'move'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 30000 });
    assert.equal(child.signal, 'SIGKILL', child.stderr); await assert.rejects(stat(first), { code: 'ENOENT' });
    for (let retry = 0; retry < 2; retry++) {
      f.restart(); let record = (await f.list()).find(row => row.operationId === operationId)!;
      value(await f.request(action(record, 'retry_cleanup'))); record = await f.record(record.importId);
      assert.equal(record.state, 'cleanup_pending'); assert.equal(record.remainingSourceFiles, 1);
      assert.equal(await readFile(second, 'utf8'), 'first document\n'); await independentAliasCopies(f, record, sourceInode);
    }
  } finally { await f.cleanup(); }
});

test('post-unlink failure retains the alias identity receipt and reconciles deletion intent after restart', async () => {
  let unlinked = 0;
  const f = await fixture({ checkpoint: stage => { if (stage === 'unlinked' && ++unlinked === 1) throw Object.assign(new Error('controlled unlink failure'), { code: 'EIO' }); } });
  try {
    const { first } = await sourceAliases(f); const sourceInode = (await stat(first)).ino;
    const id = await f.start('move'); let record = await f.record(id);
    await f.imports.confirmPreparation(f.project.projectId, id, record.revision, randomUUID()); record = await f.record(id);
    assert.equal(record.state, 'cleanup_pending'); assert.equal(record.remainingSourceFiles, 1); await assert.rejects(stat(f.source), { code: 'ENOENT' });
    f.restart(); record = (await f.list())[0]; value(await f.request(action(record, 'retry_cleanup'))); record = await f.record(id);
    assert.equal(record.state, 'complete'); assert.equal(record.remainingSourceFiles, 0); await independentAliasCopies(f, record, sourceInode);
  } finally { await f.cleanup(); }
});

test('hard-link cleanup rechecks the destination before removing a surviving alias', async () => {
  const f = await fixture();
  try {
    const { second } = await sourceAliases(f); const operationId = randomUUID();
    const child = spawnSync(process.execPath, [path.resolve('.webpack/tests/import-crash-worker.cjs'), path.join(f.root, 'app'), f.project.projectId, f.source, operationId, 'unlinked', 'move'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 30000 });
    assert.equal(child.signal, 'SIGKILL', child.stderr); f.restart();
    let record = (await f.list()).find(row => row.operationId === operationId)!;
    const target = path.join(f.project.location, record.destination, 'class-two', 'two.txt');
    await writeFile(target, 'corrupt destination');
    value(await f.request(action(record, 'retry_cleanup'))); record = await f.record(record.importId);
    assert.equal(record.state, 'cleanup_pending'); assert.equal(await readFile(second, 'utf8'), 'first document\n');
    assert.equal(await readFile(target, 'utf8'), 'corrupt destination');
    await writeFile(target, 'first document\n'); value(await f.request(action(record, 'retry_cleanup'))); record = await f.record(record.importId);
    assert.equal(record.state, 'complete'); await assert.rejects(stat(f.source), { code: 'ENOENT' });
  } finally { await f.cleanup(); }
});

test('hard-link identity refresh cannot adopt changes made while its policy receipt awaits', async () => {
  let second = ''; let changed = false;
  const f = await fixture({ recording: { recheck: async record => {
    const saved = record.body as unknown as { entries?: { cleanupIdentity?: string }[] };
    if (!changed && second && saved.entries?.some(entry => entry.cleanupIdentity)) {
      changed = true; const before = await stat(second); await chmod(second, 0o400); await chmod(second, before.mode & 0o777);
    }
    return f.recording.recheck(record);
  } } });
  try {
    ({ second } = await sourceAliases(f)); const sourceInode = (await stat(second)).ino;
    const id = await f.start('move'); let record = await f.record(id);
    await f.imports.confirmPreparation(f.project.projectId, id, record.revision, randomUUID()); record = await f.record(id);
    assert.equal(changed, true); assert.equal(record.state, 'cleanup_pending'); assert.equal(record.remainingSourceFiles, 1);
    assert.equal(await readFile(second, 'utf8'), 'first document\n'); await independentAliasCopies(f, record, sourceInode);
    f.restart(); record = (await f.list())[0]; value(await f.request(action(record, 'retry_cleanup'))); record = await f.record(id);
    assert.equal(record.state, 'cleanup_pending'); assert.equal(await readFile(second, 'utf8'), 'first document\n');
  } finally { await f.cleanup(); }
});

for (const stage of ['copied', 'reserved', 'publishing_file', 'published', 'unlinked'] as const) test(`SIGKILL at ${stage} reopens a named partial operation and recovers without duplicate publication or source loss`, async () => {
  const f = await fixture();
  try {
    const id = randomUUID();
    const child = spawnSync(process.execPath, [path.resolve('.webpack/tests/import-crash-worker.cjs'), path.join(f.root, 'app'), f.project.projectId, f.source, id, stage, stage === 'unlinked' ? 'move' : 'copy'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 30000 });
    assert.equal(child.signal, 'SIGKILL', child.stderr);
    let result = (await f.list()).find(row => row.operationId === id)!;
    const recoveredId = result.importId;
    assert.ok(result); assert.equal(result.state, stage === 'unlinked' ? 'cleanup_pending' : 'partial'); assert.match(result.problem!, /interrupted/);
    value(await f.request(action(result, stage === 'unlinked' ? 'retry_cleanup' : 'retry'))); result = await f.record(recoveredId);
    assert.equal(result.state, 'complete'); assert.equal(result.bytesUsable, true);
    assert.equal(await readFile(path.join(f.project.location, result.destination, 'class-one', 'one.txt'), 'utf8'), 'first document\n');
    if (stage !== 'unlinked') assert.equal(await readFile(path.join(f.source, 'class-two', 'two.txt'), 'utf8'), 'second document\n');
    else await assert.rejects(stat(f.source), { code: 'ENOENT' });
    assert.equal((await f.list()).length, 1);
  } finally { await f.cleanup(); }
});

test('unreadable source reports permission recovery and can retry after access is restored', async () => {
  const f = await fixture(); const file = path.join(f.source, 'class-one', 'one.txt');
  try {
    await chmod(file, 0); const id = await f.start(); const partial = await f.record(id);
    assert.equal(partial.state, 'partial'); assert.match(partial.problem!, /permission denied/); assert.equal(partial.bytesUsable, false);
    await chmod(file, 0o600); value(await f.request(action(partial, 'retry'))); assert.equal((await f.record(id)).state, 'complete');
  } finally { await chmod(file, 0o600); await f.cleanup(); }
});

test('source additions at final verification and late destination occupancy never publish mixed or overwritten data', async () => {
  let scenario = 'source';
  const f = await fixture({ checkpoint: async stage => {
    if (stage === 'verified' && scenario === 'source') await writeFile(path.join(f.source, 'added.txt'), 'new source entry');
    if (stage === 'reserved' && scenario === 'destination') await mkdir(path.join(f.project.location, 'dataset/late/files'));
  } });
  try {
    let result = await f.record(await f.start()); assert.equal(result.state, 'partial'); assert.match(result.problem!, /changed/);
    scenario = 'destination'; result = await f.record(await f.start('copy', 'late')); assert.equal(result.state, 'partial'); assert.match(result.problem!, /occupied/);
    assert.deepEqual(await readdir(path.join(f.project.location, 'dataset/late/files')), []);
    value(await f.request(action(result, 'discard'))); assert.equal((await f.list()).find(row => row.importId === result.importId)!.state, 'discarded');
    assert.deepEqual(await readdir(path.join(f.project.location, 'dataset/late/files')), []);
  } finally { await f.cleanup(); }
});

test('reusing a command key in another project cannot alias import identity or cross project data', async () => {
  const f = await fixture();
  try {
    const id = await f.start(); const first = await f.record(id); const requestId = randomUUID();
    const second = value(f.catalog.handle({ kind: 'create', operationId: requestId, input: { requestId, name: 'Second import project', folderName: 'second-import-project' } })) as ProjectRecord;
    const reply = value(await f.imports.handle({ kind: 'imports:start', operationId: first.operationId, projectId: second.projectId, sourcePaths: [f.source], destinationName: 'other', mode: 'copy' }));
    assert.equal(reply.length, 1); assert.notEqual(reply[0].importId, first.importId); assert.equal(reply[0].projectId, second.projectId);
    await f.imports.settled(reply[0].importId);
    assert.ok(!JSON.stringify(reply).includes(f.source)); assert.ok(!JSON.stringify(reply).includes('first document'));
    assert.equal((await f.list()).length, 1); assert.equal((await f.list())[0].projectId, f.project.projectId);
  } finally { await f.cleanup(); }
});

test('trusted metadata admission withholds a synthetic credential filename before inventory persistence', async () => {
  const secret = 'synthetic-import-name-credential';
  const f = await fixture({ admitNames: async names => names.every(name => !name.includes(secret)) });
  try {
    await writeFile(path.join(f.source, `${secret}.txt`), 'fixture bytes');
    const id = await f.start(); const result = await f.record(id); assert.equal(result.bytesUsable, false); assert.match(result.problem!, /credential protection/);
    const database = path.join(f.project.location, '.lab', 'imports.sqlite');
    for (const filename of [database, `${database}-wal`]) assert.equal((await readFile(filename)).includes(Buffer.from(secret)), false);
    assert.ok(!JSON.stringify(await f.list()).includes(secret));
  } finally { await f.cleanup(); }
});

test('simultaneous retry/discard commands cannot delete staging used by the resumed import', async () => {
  let failOnce = true;
  const f = await fixture({ checkpoint: stage => { if (stage === 'copied' && failOnce) { failOnce = false; throw new Error('synthetic interruption'); } } });
  try {
    const id = await f.start(); const partial = await f.record(id);
    const [retry, discard] = await Promise.all([f.request(action(partial, 'retry')), f.request(action(partial, 'discard'))]);
    assert.equal(retry.ok, true); assert.equal(discard.ok, false); assert.equal((await f.record(id)).state, 'complete');
    assert.equal(await readFile(path.join(f.project.location, 'dataset/data/files/class-one/one.txt'), 'utf8'), 'first document\n');
  } finally { await f.cleanup(); }
});

test('unsupported-entry diagnostics omit unadmitted filenames before persistence and display', async () => {
  const secret = 'synthetic-import-unsupported-credential';
  const f = await fixture({ admitNames: async names => names.every(name => !name.includes(secret)) });
  try {
    await writeFile(path.join(f.source, 'class-one', `${secret}.py`), 'unsupported fixture');
    const result = await f.record(await f.start());
    assert.equal(result.bytesUsable, false); assert.match(result.problem!, /Unsupported source entry/);
    const database = path.join(f.project.location, '.lab', 'imports.sqlite');
    for (const filename of [database, `${database}-wal`]) assert.equal((await readFile(filename)).includes(Buffer.from(secret)), false);
    assert.ok(!JSON.stringify(await f.list()).includes(secret));
    f.restart(); assert.ok(!JSON.stringify(await f.list()).includes(secret));
  } finally { await f.cleanup(); }
});
test('import publication rejects a stale final metadata approval before SQLite persistence', async () => {
  const canary = 'PendingMetadataApproval23'; let probes = 0;
  const f = await fixture({ recording: {
    recheck: record => f.recording.recheck(record),
    metadataRevision: meta => {
      const revision = f.recording.metadataRevision(meta);
      if (++probes === 2) f.matcher.register(randomUUID(), canary);
      return revision;
    },
  } });
  try {
    const source = path.join(f.root, canary); await rename(f.source, source);
    const requestId = randomUUID();
    await f.imports.handle({ kind: 'imports:start', operationId: requestId, projectId: f.project.projectId, sourcePaths: [source], destinationName: 'approved', mode: 'copy' });
    const db = new Database(path.join(f.project.location, '.lab', 'imports.sqlite'), { readonly: true });
    try {
      const rows = db.prepare('SELECT payload FROM imports').all() as {payload: string}[];
      assert.equal(rows.some(row => row.payload.includes(canary)), false, 'stale final approval must not persist a now-known credential path');
    } finally { db.close(); }
  } finally { await f.cleanup(); }
});

test('import publication without matching ownership fails closed before INSERT and preserves source bytes', async () => {
  for (const ownMetadata of [undefined, async () => { throw new Error('unsafe ownership diagnostic'); }]) {
    const f = await fixture({ ownMetadata });
    try {
      const result = await f.imports.handle({ kind: 'imports:start', operationId: randomUUID(), projectId: f.project.projectId, sourcePaths: [f.source], destinationName: 'unowned', mode: 'move' });
      assert.equal(result.ok, false); assert.equal(JSON.stringify(result).includes('unsafe ownership diagnostic'), false);
      assert.equal((await f.list()).length, 0);
      assert.equal(await readFile(path.join(f.source, 'class-one', 'one.txt'), 'utf8'), 'first document\n');
    } finally { await f.cleanup(); }
  }
});

function policyFixture(options: { dropRelease?: boolean; delayedGrant?: boolean; delayedAcquire?: boolean; throwGrant?: boolean; deny?: boolean } = {}) {
  const matcher = new Sanitizer(); const grants: ImportPolicyReply[] = []; const requests: ImportPolicyRequest[] = [];
  const timeouts: (() => void)[] = []; let acquireReady = () => {};
  const gate = new Promise<void>(resolve => { acquireReady = resolve; });
  const host = new ImportPolicyHost(async () => {
    if (options.delayedAcquire) await gate;
    if (options.deny) throw new Error('unavailable');
    return matcher.holdMatchingPolicy();
  }, reply => { if (options.delayedGrant) grants.push(reply); else client.receive(reply); if (options.throwGrant) throw new Error('uncertain grant delivery'); });
  const client = new ImportPolicyClient(message => {
    requests.push(message);
    if (message.kind !== 'release' || !options.dropRelease) host.receive(message);
  }, callback => { timeouts.push(callback); return () => {}; });
  const meta = storedMetadataEnvelope({ projectId: randomUUID(), recordId: randomUUID() }, 'file_name');
  return { matcher, host, client, meta, grants, requests, timeouts, acquireReady };
}
const policyTurn = () => new Promise<void>(resolve => setImmediate(resolve));

test('import matching ownership lasts through writer completion and ignores duplicate grant replies', async () => {
  const f = policyFixture();
  try {
    const release = await f.client.own(f.meta); let registered = false;
    const registration = f.matcher.registerWhenMutable(randomUUID(), 'QueuedImportPolicy23').then(() => { registered = true; });
    await policyTurn(); assert.equal(registered, false); assert.throws(() => f.matcher.register(randomUUID(), 'DirectPolicyMutation23'));
    f.client.receive({ channel: 'import_matching', id: f.requests[0].id, ok: true });
    await policyTurn(); assert.equal(registered, false);
    release(); release(); await registration; assert.equal(registered, true);
    assert.equal(f.requests.filter(request => request.kind === 'release').length, 1);
  } finally { f.host.close(); }
});

test('late import ownership grants cannot revive an expired writer or authorize persistence', async () => {
  const f = policyFixture({ delayedGrant: true, dropRelease: true });
  try {
    let commits = 0; const write = f.client.own(f.meta).then(release => { commits++; release(); });
    await policyTurn(); assert.equal(f.grants.length, 1);
    const denied = assert.rejects(write); f.timeouts[0](); await denied;
    let registered = false; const registration = f.matcher.registerWhenMutable(randomUUID(), 'LateImportGrant23').then(() => { registered = true; });
    await policyTurn(); assert.equal(registered, false);
    f.client.receive(f.grants[0]); await policyTurn(); assert.equal(commits, 0); assert.equal(registered, false);
    f.host.close(); await registration; assert.equal(registered, true);
  } finally { f.host.close(); }
});

test('import acquire cancellation before asynchronous initialization cannot leak or grant ownership', async () => {
  const f = policyFixture({ delayedAcquire: true });
  try {
    const denied = assert.rejects(f.client.own(f.meta)); f.timeouts[0](); await denied;
    f.acquireReady(); await policyTurn();
    await f.matcher.registerWhenMutable(randomUUID(), 'CancelledImportAcquire23');
    assert.equal(f.requests.filter(request => request.kind === 'release').length, 1);
  } finally { f.host.close(); }
});

test('a dropped import writer release retains matching ownership until confirmed utility exit', async () => {
  const f = policyFixture({ dropRelease: true });
  try {
    const release = await f.client.own(f.meta); let registered = false;
    const registration = f.matcher.registerWhenMutable(randomUUID(), 'DroppedImportRelease23').then(() => { registered = true; });
    release(); await policyTurn(); assert.equal(registered, false);
    f.host.close(); await registration; assert.equal(registered, true);
  } finally { f.host.close(); }
});

test('uncertain import grant delivery retains ownership until writer release and acquisition failures grant none', async () => {
  const f = policyFixture({ throwGrant: true });
  try {
    const release = await f.client.own(f.meta); assert.throws(() => f.matcher.register(randomUUID(), 'UncertainImportGrant23'));
    release(); await f.matcher.registerWhenMutable(randomUUID(), 'ReleasedImportGrant23');
  } finally { f.host.close(); }
  const denied = policyFixture({ deny: true });
  try { await assert.rejects(denied.client.own(denied.meta)); denied.matcher.register(randomUUID(), 'DeniedImportGrant23'); }
  finally { denied.host.close(); }
});

test('leased import policy checks complete while credential reload waits for the same writer', async () => {
  const f = await fixture(); let initialization = 0;
  const meta = storedMetadataEnvelope({ projectId: f.project.projectId, recordId: randomUUID() }, 'file_name');
  let reload: Promise<void> = Promise.resolve();
  const host = new ImportPolicyHost(async () => { initialization++; await reload; return f.matcher.holdMatchingPolicy(); }, reply => client.receive(reply), {
    recheck: record => f.recording.recheck(record), metadataRevision: meta => f.recording.metadataRevision(meta),
  });
  const client = new ImportPolicyClient(message => host.receive(message));
  try {
    const authority = await client.authority(meta); let registered = false;
    reload = f.matcher.registerWhenMutable(randomUUID(), 'QueuedPolicyReload23').then(() => { registered = true; });
    const revision = await authority.recording.metadataRevision(meta); assert.equal(typeof revision, 'string');
    const admitted = await f.recording.admit(meta, { name: 'safe' });
    assert.deepEqual(await authority.recording.recheck(admitted), admitted);
    assert.equal(initialization, 1); assert.equal(registered, false);
    authority.release(); await reload; assert.equal(registered, true);
    await assert.rejects(async () => authority.recording.metadataRevision(meta), 'settled lease cannot authorize a later operation');
  } finally { host.close(); await f.cleanup(); }
});
