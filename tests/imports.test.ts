import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, realpath, readdir, rm, symlink, writeFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { ProjectCatalog } from '../src/catalog/catalog';
import { DatasetImports, type ImportCheckpoint } from '../src/importer/importer';
import type { ImportRecord, ImportRequest } from '../src/imports';
import type { ProjectRecord, ProjectReply } from '../src/projects';

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
  let imports = new DatasetImports(resolveProject, options);
  const request = (request: Omit<Extract<ImportRequest, { kind: 'imports:action' }>, 'projectId' | 'operationId'>) => imports.handle({ ...request, projectId: project.projectId, operationId: randomUUID() });
  return { root, source, project, catalog, get imports() { return imports; }, request,
    async start(mode: 'copy' | 'move' = 'copy', destinationName = 'data', sourcePaths = [source]) {
      const id = randomUUID();
      const records = value(await imports.handle({ kind: 'imports:start', operationId: id, projectId: project.projectId, sourcePaths, destinationName, mode }));
      return records.find(record => record.operationId === id)!.importId;
    },
    async list() { return value(await imports.handle({ kind: 'imports:list', operationId: randomUUID(), projectId: project.projectId })); },
    async record(id: string) { await imports.settled(id); return (await this.list()).find(row => row.importId === id)!; },
    restart() { imports.close(); imports = new DatasetImports(resolveProject, options); },
    async cleanup() { for (const row of await this.list()) await imports.settled(row.importId); imports.close(); catalog.close(); await rm(root, { recursive: true, force: true }); },
  };
}
function action(record: ImportRecord, action: 'retry' | 'cancel' | 'discard' | 'retry_cleanup') { return { kind: 'imports:action' as const, importId: record.importId, expectedRevision: record.revision, action }; }

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
