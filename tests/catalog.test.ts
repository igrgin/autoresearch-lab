import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { ProjectCatalog, type CreationCheckpoint } from '../src/catalog/catalog';
import type { CreateProject, ProjectRecord, ProjectReply, WorkspaceProjects } from '../src/projects';

function value<T>(reply: ProjectReply<T>): T {
  if (!reply.ok) assert.fail(reply.error.message);
  return reply.value;
}
function error<T>(reply: ProjectReply<T>, code?: string) {
  assert.equal(reply.ok, false);
  if (reply.ok) throw new Error('Expected failure');
  if (code) assert.equal(reply.error.code, code);
  return reply.error;
}
function input(name = 'Research one', folderName = 'research-one'): CreateProject { return { requestId: randomUUID(), name, folderName }; }
function create(catalog: ProjectCatalog, payload = input()) {
  return catalog.handle({ kind: 'create', operationId: payload.requestId, input: payload }) as ProjectReply<ProjectRecord>;
}
function list(catalog: ProjectCatalog) { return value(catalog.handle({ kind: 'list', operationId: randomUUID() })) as WorkspaceProjects; }
function open(catalog: ProjectCatalog, projectId: string) { return catalog.handle({ kind: 'open', operationId: randomUUID(), projectId }) as ProjectReply<ProjectRecord>; }
function recover(catalog: ProjectCatalog, projectId: string) { return catalog.handle({ kind: 'recover', operationId: randomUUID(), projectId }) as ProjectReply<ProjectRecord>; }
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'lab-projects-'));
  const catalog = new ProjectCatalog(root);
  return { root, catalog, cleanup: () => { catalog.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('two independent projects persist names, identities, files and Git bindings across restart', () => {
  const f = fixture();
  const first = value(create(f.catalog));
  const second = value(create(f.catalog, input('Research two', 'research-two')));
  assert.notEqual(first.projectId, second.projectId);
  assert.notEqual(first.location, second.location);
  for (const project of [first, second]) {
    assert.equal(lstatSync(project.repository).isDirectory(), true);
    assert.equal(execFileSync('/usr/bin/git', ['rev-parse', '--show-toplevel'], { cwd: project.location, encoding: 'utf8' }).trim(), project.location);
    assert.equal(execFileSync('/usr/bin/git', ['config', '--local', '--get', 'autoresearch.projectId'], { cwd: project.location, encoding: 'utf8' }).trim(), project.projectId);
  }
  writeFileSync(path.join(first.location, 'research.py'), '# existing research survives restart\n');
  assert.equal(list(f.catalog).projects.length, 2);
  f.catalog.close();
  const restarted = new ProjectCatalog(f.root);
  try {
    assert.deepEqual(value(open(restarted, first.projectId)), first);
    assert.deepEqual(value(open(restarted, second.projectId)), second);
    assert.equal(readFileSync(path.join(first.location, 'research.py'), 'utf8'), '# existing research survives restart\n');
    const db = new Database(path.join(f.root, 'registry.sqlite'), { readonly: true });
    assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
    assert.match((db.prepare('SELECT git_version FROM projects LIMIT 1').get() as { git_version: string }).git_version, /^git version /);
    db.close();
  } finally { restarted.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('inherited Git environment cannot redirect a project into another repository', () => {
  const f = fixture();
  const keys = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0'];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  try {
    const foreign = path.join(f.root, 'foreign');
    mkdirSync(foreign);
    execFileSync('/usr/bin/git', ['init', '--template=', foreign]);
    const config = path.join(foreign, '.git', 'config');
    const original = readFileSync(config, 'utf8');
    process.env.GIT_DIR = path.join(foreign, '.git');
    process.env.GIT_WORK_TREE = foreign;
    process.env.GIT_INDEX_FILE = path.join(foreign, 'foreign-index');
    process.env.GIT_CONFIG_COUNT = '1';
    process.env.GIT_CONFIG_KEY_0 = 'init.defaultBranch';
    process.env.GIT_CONFIG_VALUE_0 = 'redirected';
    const p = value(create(f.catalog));
    assert.equal(readFileSync(config, 'utf8'), original);
    assert.equal(existsSync(path.join(foreign, 'foreign-index')), false);
    assert.equal(readFileSync(path.join(p.repository, 'HEAD'), 'utf8').trim(), 'ref: refs/heads/main');
    assert.equal(value(open(f.catalog, p.projectId)).projectId, p.projectId);
  } finally {
    for (const key of keys) {
      const old = previous.get(key);
      if (old === undefined) delete process.env[key]; else process.env[key] = old;
    }
    f.cleanup();
  }
});

test('duplicate creation returns the same identity; altered payload and case aliases conflict', () => {
  const f = fixture();
  try {
    const payload = input();
    const first = value(create(f.catalog, payload));
    assert.deepEqual(value(create(f.catalog, payload)), first);
    error(create(f.catalog, { ...payload, name: 'Changed' }), 'idempotency_conflict');
    error(create(f.catalog, input('Alias', 'RESEARCH-ONE')), 'conflict');
    assert.equal(list(f.catalog).projects.length, 1);
  } finally { f.cleanup(); }
});

test('conflicting folders, files and symlinks remain untouched and are never registered', () => {
  const f = fixture();
  try {
    const target = path.join(f.catalog.projectsFolder, 'research-one');
    mkdirSync(target); writeFileSync(path.join(target, 'unrelated.txt'), 'leave me');
    error(create(f.catalog), 'conflict');
    assert.equal(readFileSync(path.join(target, 'unrelated.txt'), 'utf8'), 'leave me');
    rmSync(target, { recursive: true }); writeFileSync(target, 'unrelated file');
    error(create(f.catalog), 'conflict'); assert.equal(readFileSync(target, 'utf8'), 'unrelated file');
    rmSync(target); symlinkSync(path.join(f.root, 'nonexistent'), target);
    error(create(f.catalog), 'conflict'); assert.equal(lstatSync(target).isSymbolicLink(), true);
    assert.equal(existsSync(path.join(f.root, 'nonexistent')), false);
    assert.equal(list(f.catalog).projects.length, 0);
  } finally { f.cleanup(); }
});

test('invalid and traversal payloads cannot escape the projects folder', () => {
  const f = fixture();
  try {
    for (const folder of ['../escape', '/tmp/escape', '.', '-option', 'white space', 'folder/sub']) error(create(f.catalog, input('Name', folder)), 'invalid_input');
    error(create(f.catalog, input('  ')), 'invalid_input');
    error(f.catalog.handle(null as never), 'invalid_input');
    error(f.catalog.handle({ kind: 'create', operationId: randomUUID(), input: input() }), 'invalid_input');
    error(open(f.catalog, randomUUID()), 'not_found');
    assert.equal(list(f.catalog).projects.length, 0);
  } finally { f.cleanup(); }
});

test('unwritable creation returns an actionable error and leaves no usable registration', () => {
  const f = fixture();
  try {
    chmodSync(f.catalog.projectsFolder, 0o500);
    const failure = error(create(f.catalog), 'permission_denied');
    assert.match(failure.message, /permissions/);
    assert.equal(list(f.catalog).projects.filter((p) => p.availability === 'ready').length, 0);
    chmodSync(f.catalog.projectsFolder, 0o700);
    const [pending] = list(f.catalog).projects;
    assert.equal(pending.availability, 'incomplete');
    assert.equal(value(recover(f.catalog, pending.project.projectId)).projectId, pending.project.projectId);
  } finally { chmodSync(f.catalog.projectsFolder, 0o700); f.cleanup(); }
});

test('missing or replaced folders, identities, history and repositories cannot open and are never recreated', () => {
  const f = fixture();
  try {
    const p = value(create(f.catalog));
    renameSync(p.location, `${p.location}-saved`);
    error(open(f.catalog, p.projectId));
    assert.equal(existsSync(p.location), false);
    assert.equal(list(f.catalog).projects[0].availability, 'unavailable');
    mkdirSync(p.location); writeFileSync(path.join(p.location, 'foreign.txt'), 'untouched');
    error(open(f.catalog, p.projectId)); assert.equal(readFileSync(path.join(p.location, 'foreign.txt'), 'utf8'), 'untouched');
    rmSync(p.location, { recursive: true }); renameSync(`${p.location}-saved`, p.location);
    const marker = path.join(p.location, '.lab', 'project.json');
    const savedMarker = readFileSync(marker, 'utf8');
    writeFileSync(marker, savedMarker.replace(p.projectId, randomUUID()));
    error(open(f.catalog, p.projectId), 'conflict'); writeFileSync(marker, savedMarker);
    const history = path.join(p.location, '.lab', 'history.sqlite');
    renameSync(history, `${history}-saved`); error(open(f.catalog, p.projectId));
    assert.equal(existsSync(history), false); renameSync(`${history}-saved`, history);
    renameSync(p.repository, `${p.repository}-saved`); error(open(f.catalog, p.projectId));
    assert.equal(existsSync(p.repository), false); renameSync(`${p.repository}-saved`, p.repository);
    assert.equal(value(open(f.catalog, p.projectId)).projectId, p.projectId);
  } finally { f.cleanup(); }
});

for (const stage of ['intent', 'directory', 'identity', 'history', 'git_initialized', 'git', 'before_ready', 'ready'] as CreationCheckpoint[]) {
  test(`SIGKILL at ${stage} recovers the same intent without premature usable registration`, () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'lab-project-crash-'));
    const payload = input();
    const child = spawnSync(process.execPath, [path.join(__dirname, 'crash-worker.cjs'), root, stage, JSON.stringify(payload)], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' });
    assert.equal(child.signal, 'SIGKILL', child.stderr);
    const catalog = new ProjectCatalog(root);
    try {
      const [entry] = list(catalog).projects;
      assert.ok(entry);
      assert.equal(entry.availability, stage === 'ready' ? 'ready' : 'incomplete');
      if (stage !== 'ready') error(open(catalog, entry.project.projectId), 'unavailable');
      if (stage === 'directory') {
        error(recover(catalog, entry.project.projectId), 'conflict');
        // Ambiguous ownership requires user preservation/move, never auto-delete.
        writeFileSync(path.join(entry.project.location, 'external-file'), 'preserve');
        renameSync(entry.project.location, `${entry.project.location}-preserved`);
        assert.equal(readFileSync(path.join(`${entry.project.location}-preserved`, 'external-file'), 'utf8'), 'preserve');
      }
      if (stage === 'git_initialized') {
        error(recover(catalog, entry.project.projectId), 'conflict');
        renameSync(entry.project.repository, `${entry.project.repository}-preserved`);
      }
      const result = value(recover(catalog, entry.project.projectId));
      assert.equal(result.projectId, entry.project.projectId);
      assert.equal(list(catalog).projects[0].availability, 'ready');
      assert.equal(value(create(catalog, payload)).projectId, entry.project.projectId);
    } finally { catalog.close(); rmSync(root, { recursive: true, force: true }); }
  });
}

test('recovery never follows a substituted history symlink or rebinds an unrelated Git repository', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'lab-project-substitute-'));
  let interrupted = false;
  const catalog = new ProjectCatalog(root, (stage) => { if (stage === 'identity' && !interrupted) { interrupted = true; throw new Error('injected failure'); } });
  try {
    error(create(catalog));
    const [entry] = list(catalog).projects;
    const outside = path.join(root, 'foreign.sqlite');
    const history = path.join(entry.project.location, '.lab', 'history.sqlite');
    symlinkSync(outside, history);
    error(recover(catalog, entry.project.projectId));
    assert.equal(existsSync(outside), false); assert.equal(lstatSync(history).isSymbolicLink(), true);
    rmSync(history);
    execFileSync('/usr/bin/git', ['init', '--template=', entry.project.location]);
    execFileSync('/usr/bin/git', ['config', '--local', 'autoresearch.projectId', 'unrelated-repository'], { cwd: entry.project.location });
    error(recover(catalog, entry.project.projectId), 'conflict');
    assert.equal(execFileSync('/usr/bin/git', ['config', '--local', '--get', 'autoresearch.projectId'], { cwd: entry.project.location, encoding: 'utf8' }).trim(), 'unrelated-repository');
    assert.equal(list(catalog).projects[0].availability, 'incomplete');
  } finally { catalog.close(); rmSync(root, { recursive: true, force: true }); }
});

test('newer registry/history schema is rejected without resetting data', () => {
  const f = fixture();
  const p = value(create(f.catalog));
  const history = new Database(path.join(p.location, '.lab', 'history.sqlite'));
  history.prepare('INSERT INTO schema_migrations VALUES (3, ?)').run('future');
  history.close();
  error(open(f.catalog, p.projectId), 'incompatible_version');
  f.catalog.close();
  const db = new Database(path.join(f.root, 'registry.sqlite'));
  db.prepare('INSERT INTO schema_migrations VALUES (3, ?)').run('future'); db.close();
  try {
    assert.throws(() => new ProjectCatalog(f.root), /Unsupported database schema/);
    const preserved = new Database(path.join(f.root, 'registry.sqlite'), { readonly: true });
    assert.equal((preserved.prepare('SELECT COUNT(*) AS n FROM projects').get() as { n: number }).n, 1);
    assert.equal((preserved.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n, 3);
    preserved.close();
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
