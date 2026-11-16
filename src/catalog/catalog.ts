import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  realpathSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import type { CreateProject, ProjectEntry, ProjectError, ProjectRecord, ProjectReply, ProjectRequest, WorkspaceProjects } from '../projects';
import { findGit, git } from './git';
import { openStore } from './storage';
import { ComputeReservations, reservationHistorySql, reservationRegistrySql, type ReservationOptions } from '../compute/reservations';
import { ResearchStore } from '../research/store';
import type { ResearchAdmission } from '../research/security-port';

const registrySql = `CREATE TABLE projects (
  project_id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL, folder_name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('creating', 'ready')), git_version TEXT NOT NULL
)`;
const historySql = `CREATE TABLE project_identity (
  project_id TEXT PRIMARY KEY, record_kind TEXT NOT NULL CHECK(record_kind = 'project'),
  schema_version INTEGER NOT NULL CHECK(schema_version = 1),
  owner TEXT NOT NULL CHECK(owner = 'project_catalog'), revision INTEGER NOT NULL,
  created_at TEXT NOT NULL
)`;
const ignoreContents = '# Application data is not source history.\n.lab/\ndataset/\nruns/\n';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

type Row = { project_id: string; request_id: string; name: string; folder_name: string; created_at: string; state: 'creating' | 'ready'; git_version: string };
export type CreationCheckpoint = 'intent' | 'directory' | 'identity' | 'history' | 'git_initialized' | 'git' | 'before_ready' | 'ready';

class CatalogFailure extends Error {
  constructor(readonly code: ProjectError['code'], message: string) { super(message); }
}

function fail(code: ProjectError['code'], message: string): never { throw new CatalogFailure(code, message); }
function plainDirectory(folder: string) {
  const info = lstatSync(folder);
  if (!info.isDirectory() || info.isSymbolicLink()) fail('conflict', `Expected a project folder at ${folder}. Restore the original folder before retrying.`);
}
function plainFile(filename: string) {
  const info = lstatSync(filename);
  if (!info.isFile() || info.isSymbolicLink()) fail('conflict', `Expected an application file at ${filename}. Restore the original file before retrying.`);
}
function present(filename: string): boolean {
  try { lstatSync(filename); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
function syncDirectory(folder: string) {
  const fd = openSync(folder, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function writeNew(filename: string, content: string) {
  const fd = openSync(filename, 'wx', 0o600);
  try { writeFileSync(fd, content); fsyncSync(fd); } finally { closeSync(fd); }
  syncDirectory(path.dirname(filename));
}

export class ProjectCatalog {
  private readonly researchStores = new Map<string, ResearchStore>();
  private readonly db: Database.Database;
  private readonly root: string;
  readonly projectsFolder: string;
  readonly reservations: ComputeReservations;
  constructor(applicationData: string, private readonly checkpoint: (stage: CreationCheckpoint) => void = () => {}, reservationOptions: ReservationOptions = {}) {
    mkdirSync(applicationData, { recursive: true });
    this.root = realpathSync(applicationData);
    for (const folder of [path.join(this.root, 'workspace'), path.join(this.root, 'workspace', 'projects')]) {
      if (!present(folder)) { mkdirSync(folder); syncDirectory(path.dirname(folder)); }
      plainDirectory(folder);
    }
    this.projectsFolder = path.join(this.root, 'workspace', 'projects');
    const registry = path.join(this.root, 'registry.sqlite');
    if (present(registry)) plainFile(registry);
    this.db = openStore(registry, registrySql, [reservationRegistrySql]);
    this.reservations = new ComputeReservations(this.db, (projectId, operation) => {
      const row = this.db.prepare("SELECT * FROM projects WHERE project_id = ? AND state = 'ready'").get(projectId) as Row | undefined;
      if (!row) throw new Error('Project is unavailable.');
      this.validateProject(row);
      const history = openStore(path.join(this.project(row).location, '.lab', 'history.sqlite'), historySql, [reservationHistorySql]);
      try { return operation(history); } finally { history.close(); }
    }, reservationOptions);
    syncDirectory(this.root);
  }

  get sqliteVersion(): string {
    return (this.db.prepare('SELECT sqlite_version() AS version').get() as { version: string }).version;
  }

  close() { for (const store of this.researchStores.values()) store.close(); this.db.close(); }

  research(projectId: string, admission: ResearchAdmission): ResearchStore {
    if (!uuid.test(projectId)) fail('invalid_input', 'Select a valid workspace project.');
    const row = this.db.prepare('SELECT * FROM projects WHERE project_id=?').get(projectId) as Row | undefined;
    if (!row || row.state !== 'ready') fail('not_found', 'Open a ready project before recording research.');
    this.validateProject(row);
    let store = this.researchStores.get(projectId);
    if (!store) {
      store = new ResearchStore(path.join(this.project(row).location, '.lab', 'research.sqlite'),projectId,admission);
      this.researchStores.set(projectId,store);
    }
    return store;
  }

  // This is a small host port, not a raw filesystem/SQL bridge. Validate runtime
  // inputs here as well as at main's trusted-frame admission boundary.
  handle(request: ProjectRequest): ProjectReply<WorkspaceProjects | ProjectRecord> {
    let operationId = '';
    let partial = false;
    try {
      if (!request || typeof request !== 'object' || typeof request.operationId !== 'string' || !uuid.test(request.operationId)) {
        fail('invalid_input', 'Invalid project request. Reload the workspace and retry.');
      }
      operationId = request.operationId;
      switch (request.kind) {
        case 'list': return { ok: true, value: this.list() };
        case 'create': {
          this.validateInput(request.input);
          if (request.input.requestId !== operationId) fail('invalid_input', 'The project request identity does not match. Reload the workspace and retry.');
          const previous = this.db.prepare('SELECT * FROM projects WHERE request_id = ?').get(operationId) as Row | undefined;
          if (previous && (previous.name !== request.input.name.trim() || previous.folder_name !== request.input.folderName)) {
            fail('idempotency_conflict', 'This request was already used with different project details. Start a new creation request.');
          }
          if (previous) { partial = previous.state !== 'ready'; return { ok: true, value: this.finish(previous) }; }
          const row = this.reserve(request.input);
          partial = true;
          this.checkpoint('intent');
          return { ok: true, value: this.finish(row) };
        }
        case 'recover':
        case 'open': {
          if (typeof request.projectId !== 'string' || !uuid.test(request.projectId)) fail('invalid_input', 'Select a valid workspace project.');
          const row = this.db.prepare('SELECT * FROM projects WHERE project_id = ?').get(request.projectId) as Row | undefined;
          if (!row) fail('not_found', 'This project is not in the workspace. Refresh the project list.');
          partial = row.state !== 'ready';
          if (request.kind === 'recover') return { ok: true, value: this.finish(row) };
          if (partial) fail('unavailable', 'Project creation is incomplete. Use Retry creation to reconcile its files first.');
          this.validateProject(row);
          return { ok: true, value: this.project(row) };
        }
        default: fail('invalid_input', 'Unsupported project request. Reload the workspace and retry.');
      }
    } catch (error) {
      const nodeCode = (error as NodeJS.ErrnoException)?.code;
      const code = error instanceof CatalogFailure ? error.code : nodeCode === 'EACCES' || nodeCode === 'EPERM' || nodeCode === 'EROFS' ? 'permission_denied' : nodeCode === 'EEXIST' ? 'conflict' : 'unavailable';
      const message = error instanceof CatalogFailure ? error.message : code === 'permission_denied'
        ? 'The project location is not writable or readable. Restore folder permissions and retry; existing files were preserved.'
        : code === 'conflict' ? 'The project path already exists. Choose a different folder name; existing files were preserved.'
          : 'Project files, Git, or storage are unavailable. Restore the original folder, check free disk space and Apple Command Line Tools, then retry. Existing files were preserved.';
      return { ok: false, error: { code, origin: 'project_catalog', operationId, message, effect: partial ? 'partial' : 'none', retry: code === 'invalid_input' || code === 'idempotency_conflict' ? 'never' : partial ? 'after_reconcile' : 'same_key' } };
    }
  }

  private validateInput(input: CreateProject) {
    if (!input || typeof input !== 'object' || typeof input.requestId !== 'string' || !uuid.test(input.requestId) ||
        typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 120 || Array.from(input.name).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
        typeof input.folderName !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(input.folderName)) {
      fail('invalid_input', 'Enter a project name (1–120 characters) and a folder name using 1–80 letters, digits, hyphens or underscores, starting with a letter or digit.');
    }
  }

  private reserve(input: CreateProject): Row {
    plainDirectory(this.projectsFolder);
    const location = path.join(this.projectsFolder, input.folderName);
    // lstat also rejects dangling symlinks; never adopt even an empty existing folder.
    try { lstatSync(location); fail('conflict', `A path already exists at ${location}. Choose a different folder name. No files were changed.`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (this.db.prepare('SELECT 1 FROM projects WHERE folder_name = ? COLLATE NOCASE').get(input.folderName)) {
      fail('conflict', 'That project folder is already registered. Open or retry the existing project, or choose another folder name.');
    }
    const gitInfo = findGit(); // Fail before any creation if installed Git is unavailable.
    const row: Row = { project_id: randomUUID(), request_id: input.requestId, name: input.name.trim(), folder_name: input.folderName, created_at: new Date().toISOString(), state: 'creating', git_version: gitInfo.version };
    this.db.prepare('INSERT INTO projects VALUES (@project_id, @request_id, @name, @folder_name, @created_at, @state, @git_version)').run(row);
    return row;
  }

  private project(row: Row): ProjectRecord {
    const location = path.join(this.projectsFolder, row.folder_name);
    return { recordKind: 'project', schemaVersion: 1, owner: 'project_catalog', revision: 1, projectId: row.project_id, name: row.name, location, repository: path.join(location, '.git'), taskRef: null, createdAt: row.created_at };
  }

  private marker(row: Row) {
    return JSON.stringify({ recordKind: 'project', schemaVersion: 1, owner: 'project_catalog', revision: 1, projectId: row.project_id, createdAt: row.created_at });
  }

  private verifyMarker(row: Row) {
    plainDirectory(this.projectsFolder);
    const { location } = this.project(row);
    plainDirectory(location);
    plainDirectory(path.join(location, '.lab'));
    const marker = path.join(location, '.lab', 'project.json');
    plainFile(marker);
    if (readFileSync(marker, 'utf8') !== this.marker(row)) {
      fail('conflict', 'The project folder has a different or damaged identity. Restore its original .lab/project.json file; no files were changed.');
    }
  }

  private finish(row: Row): ProjectRecord {
    if (row.state === 'ready') { this.validateProject(row); return this.project(row); }
    const project = this.project(row);
    plainDirectory(this.projectsFolder);
    if (!present(project.location)) {
      mkdirSync(project.location); // Exclusive: do not overwrite or adopt any existing path.
      syncDirectory(this.projectsFolder);
      this.checkpoint('directory');
      mkdirSync(path.join(project.location, '.lab'));
      writeNew(path.join(project.location, '.lab', 'project.json'), this.marker(row));
      syncDirectory(project.location);
    } else {
      // If the process died between mkdir and marker publication, ownership is
      // unproven. Leave the folder alone instead of guessing or deleting it.
      try { this.verifyMarker(row); } catch {
        fail('conflict', `Creation stopped before folder ownership could be verified at ${project.location}. Preserve or move that folder aside and retry creation. No files were changed.`);
      }
    }
    this.checkpoint('identity');
    const historyPath = path.join(project.location, '.lab', 'history.sqlite');
    if (present(historyPath)) plainFile(historyPath);
    const history = openStore(historyPath, historySql, [reservationHistorySql]);
    try {
      const identities = history.prepare('SELECT * FROM project_identity').all() as { project_id: string; created_at: string }[];
      if (!identities.length) history.prepare("INSERT INTO project_identity VALUES (?, 'project', 1, 'project_catalog', 1, ?)").run(row.project_id, row.created_at);
      else if (identities.length !== 1 || identities[0].project_id !== row.project_id || identities[0].created_at !== row.created_at) {
        fail('conflict', 'Project history belongs to a different identity. Restore the original history database before retrying.');
      }
    } finally { history.close(); }
    syncDirectory(path.dirname(historyPath));
    this.checkpoint('history');
    const { executable } = findGit();
    if (!present(project.repository)) {
      git(executable, ['init', '--initial-branch=main', '--template=', project.location]);
      this.checkpoint('git_initialized');
      git(executable, ['config', '--local', 'autoresearch.projectId', row.project_id], project.location);
      syncDirectory(project.repository);
      syncDirectory(project.location);
    }
    // Never reinitialize or rebind a repository found during recovery.
    this.verifyGit(row, executable);
    this.checkpoint('git');
    const ignore = path.join(project.location, '.gitignore');
    if (!present(ignore)) writeNew(ignore, ignoreContents);
    // A user edit after partial creation is retained; runtime exclusions must
    // still be present before this shell can be safely registered.
    plainFile(ignore);
    const rules = readFileSync(ignore, 'utf8').split(/\r?\n/);
    if (!['.lab/', 'dataset/', 'runs/'].every((rule) => rules.includes(rule))) fail('conflict', 'The project .gitignore must exclude .lab/, dataset/ and runs/. Restore those entries and retry.');
    this.validateProject(row);
    this.checkpoint('before_ready');
    this.db.prepare("UPDATE projects SET state = 'ready' WHERE project_id = ?").run(row.project_id);
    this.checkpoint('ready');
    return project;
  }

  private verifyGit(row: Row, executable: string) {
    const { location, repository } = this.project(row);
    plainDirectory(repository); // A linked external worktree or symlink is not this project's repository.
    try {
      if (git(executable, ['rev-parse', '--show-toplevel'], location).trim() === realpathSync(location) &&
          realpathSync(git(executable, ['rev-parse', '--absolute-git-dir'], location).trim()) === realpathSync(repository) &&
          git(executable, ['config', '--local', '--get', 'autoresearch.projectId'], location).trim() === row.project_id) return;
    } catch { /* Missing or damaged Git metadata is a binding failure, not permission to reinitialize. */ }
    fail('conflict', row.state === 'creating'
      ? 'The incomplete project repository cannot be verified. Preserve or move its .git folder aside and retry creation. No repository was overwritten.'
      : 'The project repository does not match its saved identity. Restore the original .git folder before retrying.');
  }

  private validateProject(row: Row) {
    this.verifyMarker(row);
    const historyPath = path.join(this.project(row).location, '.lab', 'history.sqlite');
    plainFile(historyPath);
    const history = new Database(historyPath, { readonly: true, fileMustExist: true });
    try {
      const identity = history.prepare('SELECT project_id, created_at FROM project_identity').all() as { project_id: string; created_at: string }[];
      if (identity.length !== 1 || identity[0].project_id !== row.project_id || identity[0].created_at !== row.created_at) {
        fail('conflict', 'The saved project and history identities do not match. Restore the original history database.');
      }
      // Reject unsupported future schemas on reopening as well as creation.
      const migrations = history.prepare('SELECT version, checksum FROM schema_migrations ORDER BY version').all() as { version: number; checksum: string }[];
      const scripts = [historySql, reservationHistorySql];
      if (!migrations.length || migrations.length > scripts.length || migrations.some((m, i) => m.version !== i + 1 || m.checksum !== createHash('sha256').update(scripts[i]).digest('hex'))) {
        fail('incompatible_version', 'This project history requires a compatible application version. Its files were left intact.');
      }
    } finally { history.close(); }
    this.verifyGit(row, findGit().executable);
  }

  private list(): WorkspaceProjects {
    const rows = this.db.prepare('SELECT * FROM projects ORDER BY created_at, project_id').all() as Row[];
    return { projectsFolder: this.projectsFolder, projects: rows.map((row): ProjectEntry => {
      if (row.state === 'creating') return { project: this.project(row), availability: 'incomplete', problem: 'Creation is incomplete. Retry creation to check and recover the saved files. Nothing will be opened until validation succeeds.' };
      try { this.validateProject(row); return { project: this.project(row), availability: 'ready' }; }
      catch { return { project: this.project(row), availability: 'unavailable', problem: 'The saved folder, identity, history or Git repository is unavailable. Restore the original files and retry Open; they will not be recreated.' }; }
    }) };
  }
}
