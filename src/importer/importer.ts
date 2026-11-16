import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readdir, realpath, rm, rmdir, statfs, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { ImportRecord, ImportRequest } from '../imports';
import type { ProjectError, ProjectRecord, ProjectReply } from '../projects';
import { Sanitizer } from '../security/sanitizer';
import { openStore } from '../catalog/storage';

const sql = `CREATE TABLE imports (import_id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, payload TEXT NOT NULL)`;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const supported = new Set(['.jpg', '.jpeg', '.png', '.csv', '.jsonl', '.txt']);
const active = new Set<ImportRecord['state']>(['inventorying', 'copying', 'verifying', 'publishing', 'cleaning']);
interface Entry { relative: string; source: string; size: number; digest: string; identity: string; copied: boolean; removed: boolean; deletionIntent?: boolean }
interface Saved { view: ImportRecord; sources: string[]; entries: Entry[]; directories: string[]; directoryIds: Record<string, string>; inventoryComplete: boolean; sourceRoot: string | null; destinationOwned: boolean; publicationStarted?: boolean }
export type ImportCheckpoint = 'inventory' | 'copied' | 'verified' | 'reserved' | 'published' | 'publishing_file' | 'before_unlink' | 'unlinked' | 'removed';
interface Options {
  checkpoint?: (stage: ImportCheckpoint, importId: string) => void | Promise<void>;
  admitNames?: (names: string[]) => Promise<boolean>;
  availableBytes?: (folder: string) => Promise<number>;
}
class ImportFailure extends Error { constructor(message: string, readonly code: ProjectError['code'] = 'unavailable') { super(message); } }
function fail(message: string, code?: ProjectError['code']): never { throw new ImportFailure(message, code); }
async function exists(filename: string) {
  try { await lstat(filename); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
async function directory(folder: string) {
  const info = await lstat(folder);
  if (!info.isDirectory() || info.isSymbolicLink()) fail('A required folder is unavailable or is a symlink. Restore the original folder and retry.');
}
// All selected path components are checked, including ancestors of selected files.
async function noSymlinks(filename: string) {
  if (!path.isAbsolute(filename)) fail('Select an absolute local source using the file picker.');
  let cursor = path.parse(filename).root;
  for (const component of path.relative(cursor, filename).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, component);
    if ((await lstat(cursor)).isSymbolicLink()) fail('Symlink sources are unsupported. Select a self-contained regular-file directory.');
  }
}
function within(parent: string, child: string) { const relative = path.relative(parent, child); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); }
function normalized(name: string) { return name.normalize('NFD').toUpperCase().toLowerCase(); }
function identity(info: Awaited<ReturnType<typeof lstat>>) { return `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`; }
async function syncDirectory(folder: string) { const fd = await open(folder, 'r'); try { await fd.sync(); } finally { await fd.close(); } }
async function hashFile(filename: string, check: () => void = () => {}) {
  await noSymlinks(filename);
  const fd = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await fd.stat();
    if (!before.isFile()) fail('Only regular dataset files are supported.');
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(1024 * 1024);
    let position = 0;
    for (;;) {
      check();
      const { bytesRead } = await fd.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead)); position += bytesRead;
    }
    const after = await fd.stat();
    if (identity(before) !== identity(after) || identity(after) !== identity(await lstat(filename))) fail('Source changed during import. Restore a stable source and retry.');
    return { size: before.size, digest: hash.digest('hex'), identity: identity(before) };
  } finally { await fd.close(); }
}
function safeProblem(error: unknown) {
  if (error instanceof ImportFailure) return error.message;
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === 'ENOSPC' || code === 'EDQUOT') return 'Insufficient destination space. Free space, then retry or discard staging. The source was retained.';
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return 'Source or destination permission denied. Restore access, then retry or discard staging.';
  if (code === 'ENOENT') return 'The source or an import folder is unavailable. Restore the original files, then retry or discard staging.';
  if (code === 'EEXIST' || code === 'ENOTEMPTY') return 'The destination is occupied. Existing data was preserved. Choose another destination after discarding staging.';
  return 'Import could not finish. Check local storage and source access, then retry or discard staging.';
}

// Instantiated only by the utility coordinator (single physical writer). Each
// project has an independent v1 store; registry/history schemas are unchanged.
export class DatasetImports {
  private commandQueue: Promise<void> = Promise.resolve();
  private live = new Map<string, Saved>();
  private stores = new Map<string, Database.Database>();
  private running = new Map<string, { cancelled: boolean; done: Promise<void> }>();
  constructor(private readonly resolveProject: (id: string) => ProjectRecord, private readonly options: Options = {}) {}
  close() { for (const db of this.stores.values()) db.close(); this.stores.clear(); }
  private async store(project: ProjectRecord) {
    await directory(project.location); await directory(path.join(project.location, '.lab'));
    const filename = path.join(project.location, '.lab', 'imports.sqlite');
    if (await exists(filename)) { const info = await lstat(filename); if (!info.isFile() || info.isSymbolicLink()) fail('Import records are unavailable. Restore the original import store.'); }
    let db = this.stores.get(project.projectId);
    if (!db) { db = openStore(filename, sql); this.stores.set(project.projectId, db); await syncDirectory(path.dirname(filename)); }
    return db;
  }
  private save(db: Database.Database, saved: Saved) {
    saved.view.revision++;
    this.live.set(saved.view.importId, saved);
    db.prepare('UPDATE imports SET payload = ? WHERE import_id = ?').run(JSON.stringify(saved), saved.view.importId);
  }
  private rows(db: Database.Database) { return (db.prepare('SELECT payload FROM imports ORDER BY rowid').all() as { payload: string }[]).map(row => { const saved = JSON.parse(row.payload) as Saved; return this.live.get(saved.view.importId) || saved; }); }
  private async paths(project: ProjectRecord, saved: Saved) {
    await directory(project.location); await directory(path.join(project.location, '.lab'));
    const stagingRoot = path.join(project.location, '.lab', 'imports');
    const dataset = path.join(project.location, 'dataset');
    for (const folder of [stagingRoot, dataset]) {
      if (!await exists(folder)) { await mkdir(folder); await syncDirectory(path.dirname(folder)); }
      await directory(folder);
    }
    return { stage: path.join(stagingRoot, saved.view.importId), destination: path.join(project.location, saved.view.destination), dataset };
  }
  handle(request: ImportRequest): Promise<ProjectReply<ImportRecord[]>> {
    const reply = this.commandQueue.then(() => this.dispatch(request));
    this.commandQueue = reply.then(() => {}, () => {});
    return reply;
  }
  private async dispatch(request: ImportRequest): Promise<ProjectReply<ImportRecord[]>> {
    let partial = false;
    try {
      if (!request || typeof request.operationId !== 'string' || typeof request.projectId !== 'string' || !uuid.test(request.operationId) || !uuid.test(request.projectId)) fail('Invalid import request. Reopen the project and retry.', 'invalid_input');
      const project = this.resolveProject(request.projectId);
      const db = await this.store(project);
      const rows = this.rows(db);
      for (const saved of rows) if (active.has(saved.view.state) && !this.running.has(saved.view.importId)) {
        saved.view.state = saved.view.bytesUsable ? 'cleanup_pending' : 'partial';
        saved.view.problem = 'Import was interrupted. Retry to verify saved files, or discard staging. Published copies are retained.';
        this.save(db, saved);
      }
      if (request.kind === 'imports:start') {
        if (!Array.isArray(request.sourcePaths) || !request.sourcePaths.length || request.sourcePaths.length > 10000 || request.sourcePaths.some(p => typeof p !== 'string' || !path.isAbsolute(p)) ||
            typeof request.destinationName !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(request.destinationName) || !['copy', 'move'].includes(request.mode)) fail('Select local files or a directory, and a destination name using letters, numbers, hyphens or underscores.', 'invalid_input');
        if (this.options.admitNames && !await this.options.admitNames([...request.sourcePaths, request.destinationName])) fail('Source or destination metadata was withheld by credential protection. Rename or relocate the dataset before importing.');
        if (new Sanitizer().text(request.destinationName).changed) fail('Choose a destination name without credential-like text.');
        if (request.sourcePaths.some(source => new Sanitizer().text(source).changed)) fail('A source path contains credential-like text. Rename or relocate it before importing.');
        const previous = rows.find(row => row.view.operationId === request.operationId);
        if (previous) {
          if (JSON.stringify(previous.sources) !== JSON.stringify(request.sourcePaths) || previous.view.destination !== `dataset/${request.destinationName}/files` || previous.view.mode !== request.mode) fail('This request identity was used with different import details. Start a new import.', 'idempotency_conflict');
        } else {
          if (rows.some(row => row.view.state !== 'discarded' && normalized(row.view.destination) === normalized(`dataset/${request.destinationName}/files`))) fail('That destination is already reserved by an import. Retry its partial result or choose another name.', 'conflict');
          const saved: Saved = { view: { recordKind: 'dataset_import', schemaVersion: 1, owner: 'project_preparation', importId: randomUUID(), operationId: request.operationId, projectId: project.projectId, revision: 1, mode: request.mode, destination: `dataset/${request.destinationName}/files`, state: 'inventorying', totalBytes: 0, completedBytes: 0, totalFiles: 0, completedFiles: 0, failedFiles: 0, remainingSourceFiles: 0, bytesUsable: false, researchReadiness: 'not_prepared', preparationRef: null, problem: null }, sources: request.sourcePaths, entries: [], directories: [], directoryIds: {}, inventoryComplete: false, sourceRoot: null, destinationOwned: false };
          db.prepare('INSERT INTO imports VALUES (?, ?, ?)').run(saved.view.importId, request.operationId, JSON.stringify(saved));
          partial = true; this.launch(project, db, saved, false);
        }
      } else if (request.kind === 'imports:action') {
        const saved = rows.find(row => row.view.importId === request.importId);
        if (!saved) fail('This import is unavailable. Refresh the import list.');
        if (request.action === 'cancel') {
          const run = this.running.get(request.importId);
          if (run && !saved.view.bytesUsable) run.cancelled = true;
        } else {
          if (saved.view.revision !== request.expectedRevision) fail('Import changed. Refresh before trying this action again.', 'conflict');
          if (this.running.has(request.importId)) fail('Import is still working. Cancel it and wait for the partial result first.');
          if (request.action === 'retry' && saved.view.state === 'partial') this.launch(project, db, saved, false);
          else if (request.action === 'retry_cleanup' && saved.view.state === 'cleanup_pending' && saved.view.preparationRef) this.launch(project, db, saved, true);
          else if (request.action === 'discard' && saved.view.state === 'partial') {
            partial = true;
            const { stage, destination } = await this.paths(project, saved);
            // Never discard a published copy, including a crash before registration.
            let partialDestination = false;
            if (await exists(destination)) {
              try { await this.verifyCopy(destination, saved.entries, () => {}); }
              catch { partialDestination = true; }
              if (!partialDestination) fail('A published copy needs reconciliation. Retry before discarding.');
            }
            if (await exists(stage)) { await directory(stage); await rm(stage, { recursive: true }); await syncDirectory(path.dirname(stage)); }
            if (!partialDestination) await this.releaseEmptyDestination(saved, destination);
            saved.view.state = 'discarded'; saved.view.problem = partialDestination ? 'Staging discarded. Incomplete destination files were preserved; move them aside manually before reusing this destination name.' : null; this.save(db, saved);
          } else fail('That recovery action is unavailable for this import state.');
        }
      } else if (request.kind !== 'imports:list') fail('Unsupported import request.');
      return { ok: true, value: this.rows(db).map(row => row.view) };
    } catch (error) {
      return { ok: false, error: { code: error instanceof ImportFailure ? error.code : 'unavailable', origin: 'dataset_import', operationId: request?.operationId || '', message: safeProblem(error), effect: partial ? 'partial' : 'none', retry: error instanceof ImportFailure && ['invalid_input', 'idempotency_conflict'].includes(error.code) ? 'never' : 'after_reconcile' } };
    }
  }
  // Trusted preparation-owner handoff for #24/#25. Deliberately absent from IPC:
  // a renderer checkbox cannot assert layout/interpretation/split validation.
  confirmPreparation(projectId: string, importId: string, expectedRevision: number, preparationRef: string) {
    const result = this.commandQueue.then(() => this.confirm(projectId, importId, expectedRevision, preparationRef));
    this.commandQueue = result.then(() => {}, () => {});
    return result;
  }
  private async confirm(projectId: string, importId: string, expectedRevision: number, preparationRef: string) {
    if (!uuid.test(preparationRef)) fail('A persisted preparation identity is required.');
    const project = this.resolveProject(projectId); const db = await this.store(project);
    const saved = this.rows(db).find(row => row.view.importId === importId);
    if (!saved || !saved.view.bytesUsable || saved.view.revision !== expectedRevision || this.running.has(importId)) fail('Refresh the completed import before confirming preparation.');
    if (saved.view.preparationRef && saved.view.preparationRef !== preparationRef) fail('Preparation confirmation is immutable.');
    saved.view.preparationRef = preparationRef; this.save(db, saved);
    if (saved.view.mode === 'move') this.launch(project, db, saved, true);
  }
  async settled(importId: string) { await this.running.get(importId)?.done; }
  private launch(project: ProjectRecord, db: Database.Database, saved: Saved, cleanup: boolean) {
    saved.view.state = cleanup ? 'cleaning' : 'inventorying'; saved.view.problem = null; this.save(db, saved);
    const control = { cancelled: false, done: Promise.resolve() };
    this.running.set(saved.view.importId, control);
    control.done = this.run(project, db, saved, cleanup, () => { if (control.cancelled) fail('Import cancelled. Source retained. Retry to verify staging or discard staging.'); })
      .catch(error => {
        saved.view.state = saved.view.bytesUsable ? 'cleanup_pending' : 'partial';
        saved.view.problem = saved.view.bytesUsable ? `Import complete; source cleanup incomplete. ${safeProblem(error)}` : safeProblem(error);
        saved.view.failedFiles = Math.max(0, saved.view.totalFiles - saved.view.completedFiles);
        try { this.save(db, saved); } catch { saved.view.problem = 'Import interrupted and its latest progress could not be saved. Restore writable storage, then retry reconciliation. Source and any published copy are retained.'; }
      }).finally(() => { this.running.delete(saved.view.importId); });
  }
  private async inventory(project: ProjectRecord, saved: Saved, check: () => void) {
    const entries: Entry[] = []; const directories: string[] = []; const directoryIds: Record<string, string> = {}; const names = new Set<string>();
    const roots = saved.sources;
    for (const source of roots) {
      check(); await noSymlinks(source);
      const resolved = await realpath(source);
      if (within(project.location, resolved) || within(resolved, project.location)) fail('Source and project ancestry overlap. Select a dataset outside the project and its parent directories.');
    }
    const isDirectory = roots.length === 1 && (await lstat(roots[0])).isDirectory();
    if (saved.view.mode === 'move' && !isDirectory) fail('Move requires one dedicated dataset directory. Use copy for selected files.');
    async function walk(source: string, relative: string) {
      check();
      const info = await lstat(source);
      if (info.isSymbolicLink()) fail('Symlink sources are unsupported. Select a self-contained regular-file directory.');
      if (relative) {
        if (new Sanitizer().text(relative).changed) fail('A source filename contains credential-like text. Rename it before importing.');
        const key = normalized(relative);
        if (names.has(key)) fail('Filename collision under destination case/Unicode normalization. Rename conflicting source entries and retry.');
        names.add(key);
      }
      if (info.isDirectory()) {
        directories.push(source); directoryIds[source] = `${info.dev}:${info.ino}`;
        for (const child of (await readdir(source)).sort()) await walk(path.join(source, child), relative ? `${relative}/${child}` : child);
      } else if (info.isFile() && supported.has(path.extname(source).toLowerCase())) {
        entries.push({ relative, source, ...await hashFile(source, check), copied: false, removed: false });
      } else fail('Unsupported source entry. Use an extracted self-contained directory of JPEG/PNG, CSV/JSONL or UTF-8 text files; custom scripts, archives and other formats require conversion.');
    }
    if (isDirectory) await walk(roots[0], '');
    else for (const source of roots) { if (!(await lstat(source)).isFile()) fail('Select one directory or regular files.'); await walk(source, path.basename(source)); }
    if (this.options.admitNames) {
      const metadata = [...entries.map(entry => entry.source), ...directories];
      for (let i = 0; i < metadata.length; i += 1000) if (!await this.options.admitNames(metadata.slice(i, i + 1000))) fail('A source filename was withheld by credential protection. Rename it before importing.');
    }
    if (!entries.length) fail('No supported dataset files were found. Select a nonempty dataset.');
    return { entries, directories, directoryIds, sourceRoot: isDirectory ? roots[0] : null };
  }
  private async releaseEmptyDestination(saved: Saved, destination: string) {
    const holder = path.dirname(destination);
    if (!saved.destinationOwned || !await exists(holder)) return;
    await this.verifyHolder(saved, holder);
    const children = await readdir(holder);
    if (children.length !== 1 || children[0] !== '.import-owner') fail('Destination contains unexpected data. Preserve it and retry reconciliation.');
    await unlink(path.join(holder, '.import-owner')); await rmdir(holder); await syncDirectory(path.dirname(holder));
  }
  private async verifyHolder(saved: Saved, holder: string) {
    await directory(holder);
    const marker = path.join(holder, '.import-owner');
    const fd = await open(marker, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { if (await fd.readFile('utf8') !== saved.view.importId) fail('Destination ownership changed. Preserve its files and choose another destination.'); } finally { await fd.close(); }
  }
  private async verifyCopy(folder: string, entries: Entry[], check: () => void) {
    const expected = new Set(entries.map(entry => entry.relative));
    async function walk(root: string, prefix = ''): Promise<void> {
      await directory(root);
      for (const name of await readdir(root)) {
        const relative = prefix ? `${prefix}/${name}` : name; const file = path.join(root, name); const info = await lstat(file);
        if (info.isSymbolicLink()) fail('Staging integrity check failed. Discard staging and start a new import.');
        if (info.isDirectory()) await walk(file, relative);
        else if (!info.isFile() || !expected.has(relative)) fail('Import contains unexpected files. Preserve them and reconcile before retrying.');
      }
    }
    await walk(folder);
    for (const entry of entries) {
      const actual = await hashFile(path.join(folder, entry.relative), check);
      if (actual.size !== entry.size || actual.digest !== entry.digest) fail('Copied bytes failed verification. Retry from the stable original source or discard staging.');
    }
  }
  private async run(project: ProjectRecord, db: Database.Database, saved: Saved, cleanup: boolean, check: () => void) {
    const { stage, destination, dataset } = await this.paths(project, saved);
    if (cleanup) { await this.cleanup(project, db, saved, destination); return; }
    check();
    const holder = path.dirname(destination);
    if ((await readdir(dataset)).some(name => normalized(name) === normalized(path.basename(holder)) && name !== path.basename(holder))) fail('Destination conflicts under case/Unicode normalization. Choose another name.');
    if (await exists(holder)) {
      if (!saved.destinationOwned) {
        try { await this.verifyHolder(saved, holder); saved.destinationOwned = true; this.save(db, saved); }
        catch { fail('The destination is occupied or its ownership is unproven. Preserve or move it aside, discard staging and choose another name. Existing project data was preserved.'); }
      }
      await this.verifyHolder(saved, holder);
      if (await exists(destination)) {
        if (!saved.publicationStarted) fail('The destination is occupied. Existing project data was preserved.');
        if (!saved.inventoryComplete) fail('Published inventory is unavailable. Preserve the destination and restore import records.');
        try {
          await this.verifyCopy(destination, saved.entries, check);
          if (await exists(stage)) { await directory(stage); await rm(stage, { recursive: true }); await syncDirectory(path.dirname(stage)); }
          this.complete(db, saved); return; // Published before a crash; source never removed here.
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        // A partial exclusive publication is filled only from verified staging.
        // Existing bytes are checked, never overwritten.
      }
    }
    const current = await this.inventory(project, saved, check);
    if (saved.inventoryComplete && JSON.stringify(current.entries.map(({ source, relative, size, digest, identity }) => ({ source, relative, size, digest, identity }))) !==
        JSON.stringify(saved.entries.map(({ source, relative, size, digest, identity }) => ({ source, relative, size, digest, identity })))) fail('Source changed since this import began. Discard staging and start a new import from the stable source.');
    if (!saved.inventoryComplete) { Object.assign(saved, current); saved.inventoryComplete = true; }
    saved.view.state = 'copying';
    saved.view.totalFiles = saved.entries.length; saved.view.totalBytes = saved.entries.reduce((sum, entry) => sum + entry.size, 0);
    saved.view.remainingSourceFiles = saved.entries.length; this.save(db, saved);
    await this.options.checkpoint?.('inventory', saved.view.importId); check();
    const available = this.options.availableBytes ? await this.options.availableBytes(dataset) : await statfs(dataset).then(info => info.bavail * info.bsize);
    // Conservative initial estimate; staged files are independently rechecked below.
    if (available < saved.entries.filter(entry => !entry.copied).reduce((sum, entry) => sum + entry.size, 0)) fail('Insufficient destination space for the verified staged copy. Free space, then retry or discard staging.');
    if (!await exists(stage)) { await mkdir(stage); await syncDirectory(path.dirname(stage)); }
    await directory(stage);
    const files = path.join(stage, 'files');
    if (!await exists(files)) await mkdir(files);
    await directory(files);
    if (saved.sourceRoot) for (const folder of saved.directories) {
      const relative = path.relative(saved.sourceRoot, folder);
      if (relative) { const target = path.join(files, relative); await noSymlinks(path.dirname(target)); if (!await exists(target)) await mkdir(target); await directory(target); await syncDirectory(path.dirname(target)); }
    }
    // Probe actual destination filesystem name rules before copying. Unicode
    // folding above is conservative; exclusive creation also catches filesystem-
    // specific equivalences without ever replacing the earlier staged entry.
    const probe = path.join(stage, `names-${randomUUID()}`);
    await mkdir(probe, { mode: 0o700 });
    try {
      if (saved.sourceRoot) for (const folder of saved.directories) {
        const relative = path.relative(saved.sourceRoot, folder);
        if (relative) await mkdir(path.join(probe, relative));
      }
      for (const entry of saved.entries) {
        try { const file = await open(path.join(probe, entry.relative), 'wx', 0o600); await file.close(); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') fail('Filename collision under destination filesystem normalization. Rename source entries and start a new import.'); throw error; }
      }
    } finally { await rm(probe, { recursive: true, force: true }); }
    saved.view.completedBytes = 0; saved.view.completedFiles = 0; saved.view.failedFiles = 0; this.save(db, saved);
    for (const entry of saved.entries) {
      check(); const target = path.join(files, entry.relative);
      // Verify every saved stage file before reuse; bad/truncated copies are replaced
      // only inside this import's private staging area, never in a destination.
      let reuse = false;
      if (await exists(target)) {
        const info = await lstat(target); if (!info.isFile() || info.isSymbolicLink()) fail('Staging path was replaced. Discard staging and retry.');
        const actual = await hashFile(target, check); reuse = actual.digest === entry.digest && actual.size === entry.size;
        if (!reuse) await unlink(target);
      }
      if (!reuse) {
        const parent = path.dirname(target);
        await mkdir(parent, { recursive: true }); await noSymlinks(parent);
        await noSymlinks(entry.source);
        const source = await open(entry.source, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          if (identity(await source.stat()) !== entry.identity) fail('Source changed during import. Retry from a stable source.');
          const output = await open(target, 'wx', 0o600);
          try {
            const buffer = Buffer.alloc(1024 * 1024); let position = 0;
            for (;;) {
              check(); const { bytesRead } = await source.read(buffer, 0, buffer.length, position); if (!bytesRead) break;
              let written = 0;
              while (written < bytesRead) { const result = await output.write(buffer, written, bytesRead - written); if (!result.bytesWritten) fail('Storage stopped accepting dataset bytes.'); written += result.bytesWritten; }
              position += bytesRead; saved.view.completedBytes += bytesRead;
            }
            await output.sync();
          } finally { await output.close(); }
          if (identity(await source.stat()) !== entry.identity) fail('Source changed during import. Retry from a stable source.');
        } finally { await source.close(); }
        await syncDirectory(path.dirname(target));
      } else saved.view.completedBytes += entry.size;
      entry.copied = true; saved.view.completedFiles++; this.save(db, saved); await this.options.checkpoint?.('copied', saved.view.importId);
    }
    saved.view.state = 'verifying'; this.save(db, saved);
    await this.verifyCopy(files, saved.entries, check);
    await this.options.checkpoint?.('verified', saved.view.importId); check();
    const stable = await this.inventory(project, saved, check);
    if (JSON.stringify(stable.entries) !== JSON.stringify(saved.entries.map(entry => ({ ...entry, copied: false }))) || JSON.stringify(stable.directories) !== JSON.stringify(saved.directories) || JSON.stringify(stable.directoryIds) !== JSON.stringify(saved.directoryIds)) fail('Source changed during import. Discard staging and retry from a stable source.');
    this.resolveProject(project.projectId); // Revalidate the project binding before publication.
    saved.view.state = 'publishing'; this.save(db, saved);
    if (!await exists(holder)) {
      await mkdir(holder); await syncDirectory(dataset);
      const marker = await open(path.join(holder, '.import-owner'), 'wx', 0o600);
      try { await marker.writeFile(saved.view.importId); await marker.sync(); } finally { await marker.close(); }
      await syncDirectory(holder); saved.destinationOwned = true; this.save(db, saved);
    }
    await this.verifyHolder(saved, holder);
    await this.options.checkpoint?.('reserved', saved.view.importId); check();
    if (!saved.publicationStarted) {
      // Exclusive mkdir precedes the ownership flag. A crash in that narrow
      // gap leaves an unproven folder for manual preservation, never adoption.
      if (await exists(destination)) fail('The destination is occupied. Existing project data was preserved.');
      await mkdir(destination, { mode: 0o700 }); await syncDirectory(holder);
      saved.publicationStarted = true; this.save(db, saved);
    } else if (!await exists(destination)) {
      await mkdir(destination, { mode: 0o700 }); await syncDirectory(holder);
    }
    await directory(destination);
    if (saved.sourceRoot) for (const folder of saved.directories) {
      const relative = path.relative(saved.sourceRoot, folder);
      if (relative) { const target = path.join(destination, relative); await noSymlinks(path.dirname(target)); if (!await exists(target)) { await mkdir(target, { mode: 0o700 }); await syncDirectory(path.dirname(target)); } await directory(target); }
    }
    for (const entry of saved.entries) {
      check(); const target = path.join(destination, entry.relative);
      await noSymlinks(path.dirname(target));
      if (await exists(target)) {
        const current = await hashFile(target, check);
        if (current.digest !== entry.digest || current.size !== entry.size) fail('Destination bytes conflict with the verified inventory. Existing data was preserved. Reconcile the destination before retrying.');
      } else {
        // link() is an atomic exclusive insertion, unlike rename() which can
        // replace an occupied empty directory. These links are ONLY to private
        // verified staging, never to source data. Remove staging before completion.
        await link(path.join(files, entry.relative), target); await syncDirectory(path.dirname(target));
        await this.options.checkpoint?.('publishing_file', saved.view.importId);
      }
    }
    await this.verifyCopy(destination, saved.entries, check);
    await rm(stage, { recursive: true }); await syncDirectory(path.dirname(stage));
    await this.options.checkpoint?.('published', saved.view.importId);
    this.complete(db, saved);
  }
  private complete(db: Database.Database, saved: Saved) {
    saved.view.bytesUsable = true; saved.view.completedBytes = saved.view.totalBytes; saved.view.completedFiles = saved.view.totalFiles; saved.view.failedFiles = 0;
    saved.view.state = saved.view.mode === 'move' ? 'cleanup_pending' : 'complete';
    saved.view.problem = saved.view.mode === 'move' ? 'Import complete. Source retained until trusted preparation confirms layout, interpretation and splits.' : null;
    try { this.save(db, saved); } catch (error) { saved.view.bytesUsable = false; saved.view.state = 'partial'; throw error; }
  }
  private async cleanup(project: ProjectRecord, db: Database.Database, saved: Saved, destination: string) {
    this.resolveProject(project.projectId);
    if (!saved.view.preparationRef || !saved.sourceRoot) fail('Source cleanup requires confirmed preparation of a dedicated directory.');
    await this.verifyHolder(saved, path.dirname(destination));
    await this.verifyCopy(destination, saved.entries, () => {});
    let remaining = 0;
    for (const entry of saved.entries) {
      if (entry.removed) continue;
      try {
        await noSymlinks(saved.sourceRoot);
        if (entry.deletionIntent && !await exists(entry.source)) { entry.removed = true; saved.view.remainingSourceFiles--; this.save(db, saved); continue; }
        const current = await hashFile(entry.source);
        if (current.identity !== entry.identity || current.digest !== entry.digest || current.size !== entry.size) { remaining++; continue; }
        await this.options.checkpoint?.('before_unlink', saved.view.importId);
        if (identity(await lstat(entry.source)) !== entry.identity) { remaining++; continue; }
        entry.deletionIntent = true; this.save(db, saved);
        await unlink(entry.source); await this.options.checkpoint?.('unlinked', saved.view.importId); await syncDirectory(path.dirname(entry.source));
        entry.removed = true; saved.view.remainingSourceFiles--; this.save(db, saved);
        await this.options.checkpoint?.('removed', saved.view.importId);
      } catch { remaining++; }
    }
    // rmdir is intentionally non-recursive: new/changed entries survive.
    for (const folder of [...saved.directories].reverse()) {
      try { await noSymlinks(folder); const info = await lstat(folder); if (saved.directoryIds[folder] !== `${info.dev}:${info.ino}`) continue; await rmdir(folder); await syncDirectory(path.dirname(folder)); } catch { /* Report retained entries below. */ }
    }
    const rootRemains = await exists(saved.sourceRoot);
    saved.view.remainingSourceFiles = saved.entries.filter(entry => !entry.removed).length;
    saved.view.state = remaining || rootRemains ? 'cleanup_pending' : 'complete';
    saved.view.problem = saved.view.state === 'complete' ? null : 'Import complete; source cleanup incomplete. Changed, new, unavailable or inaccessible source entries were preserved. Retry cleanup only removes matching original entries.';
    this.save(db, saved);
  }
}
