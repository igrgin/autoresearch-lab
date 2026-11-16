import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ProjectCatalog } from '../catalog/catalog';
import { openStore } from '../catalog/storage';
import { CHOICE_KEYS, EMPTY_CHOICES, type ChoiceOverrides, type ConfigurationDraft, type ConfigurationError, type ConfigurationReply, type ConfigurationRequest, type ConfigurationSnapshot, type ConfigurationValue, type DefaultsRecord } from '../configuration';
import { validateOverrides } from './validation';

// Separate versioned stores leave the catalog/history v1 schemas unchanged. Only
// the utility coordinator opens these writable ports. Revisions and snapshots append.
const sql = `CREATE TABLE project_stores (project_id TEXT PRIMARY KEY);
CREATE TABLE binding (project_id TEXT PRIMARY KEY);
CREATE TABLE defaults_revisions (
 revision INTEGER PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, command TEXT NOT NULL, values_json TEXT NOT NULL
);
CREATE TABLE snapshots (
 snapshot_id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE, request_id TEXT NOT NULL UNIQUE,
 command TEXT NOT NULL, record_json TEXT NOT NULL
);
CREATE TRIGGER immutable_snapshot_update BEFORE UPDATE ON snapshots BEGIN SELECT RAISE(ABORT, 'Immutable snapshot'); END;
CREATE TRIGGER immutable_snapshot_delete BEFORE DELETE ON snapshots BEGIN SELECT RAISE(ABORT, 'Immutable snapshot'); END;
CREATE TRIGGER immutable_defaults_update BEFORE UPDATE ON defaults_revisions BEGIN SELECT RAISE(ABORT, 'Immutable defaults'); END;
CREATE TRIGGER immutable_defaults_delete BEFORE DELETE ON defaults_revisions BEGIN SELECT RAISE(ABORT, 'Immutable defaults'); END;`;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
class Failure extends Error {
  constructor(readonly code: ConfigurationError['code'], message: string) { super(message); }
}
function fail(code: ConfigurationError['code'], message: string): never { throw new Failure(code, message); }
function id(value: unknown): asserts value is string { if (typeof value !== 'string' || !uuid.test(value)) fail('invalid_input', 'Select a valid project or configuration request.'); }
function revision(value: unknown): asserts value is number { if (!Number.isSafeInteger(value) || (value as number) < 0) fail('invalid_input', 'Reload settings before saving.'); }
type DefaultsRow = { revision: number; request_id: string; command: string; values_json: string };

export class ConfigurationStore {
  private readonly global: Database.Database;
  constructor(applicationData: string, private readonly catalog: ProjectCatalog) {
    const filename = path.join(applicationData, 'defaults.sqlite');
    const marker = path.join(applicationData, 'defaults.initialized');
    let marked = false;
    try {
      const info = lstatSync(marker);
      if (!info.isFile() || info.isSymbolicLink() || readFileSync(marker, 'utf8') !== 'configuration/1\n') throw new Error();
      marked = true;
      lstatSync(filename); // A missing established global store is never reset.
    } catch (error) { if (marked || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    this.global = this.open(filename, 'global', marked);
    if (!marked) {
      try {
        const fd = openSync(marker, 'wx', 0o600);
        try { writeFileSync(fd, 'configuration/1\n'); fsyncSync(fd); } finally { closeSync(fd); }
        const directory = openSync(applicationData, 'r');
        try { fsyncSync(directory); } finally { closeSync(directory); }
      } catch (error) { this.global.close(); throw error; }
    }
  }
  close() { this.global.close(); }
  private open(filename: string, binding: string, established = false) {
    try {
      const info = lstatSync(filename);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error();
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (established) {
      // Inspect before the initializing opener can write. A present but empty
      // replacement is lost storage, just like a missing established database.
      const existing = new Database(filename, { readonly: true, fileMustExist: true });
      try {
        const rows = existing.prepare('SELECT project_id FROM binding').all() as { project_id: string }[];
        if (rows.length !== 1 || rows[0].project_id !== binding) throw new Error();
      } finally { existing.close(); }
    }
    const db = openStore(filename, sql);
    try {
      const rows = db.prepare('SELECT project_id FROM binding').all() as { project_id: string }[];
      if (!rows.length) db.prepare('INSERT INTO binding VALUES (?)').run(binding);
      else if (rows.length !== 1 || rows[0].project_id !== binding) throw new Error();
      return db;
    } catch (error) { db.close(); throw error; }
  }
  private defaults(db: Database.Database, projectId: string | null): DefaultsRecord {
    const row = db.prepare('SELECT * FROM defaults_revisions ORDER BY revision DESC LIMIT 1').get() as DefaultsRow | undefined;
    return { recordKind: 'configuration_defaults', schemaVersion: 1, owner: 'run_configuration', scope: projectId ? 'project' : 'global', projectId,
      revision: row?.revision ?? 0, values: row ? validateOverrides(JSON.parse(row.values_json)) : projectId ? {} : { ...EMPTY_CHOICES } };
  }
  private draft(db: Database.Database, projectId: string, overrides: ChoiceOverrides = {}): ConfigurationDraft {
    const global = this.defaults(this.global, null);
    const project = this.defaults(db, projectId);
    const choices = { ...EMPTY_CHOICES, ...global.values, ...project.values, ...overrides };
    const origins = {} as ConfigurationDraft['origins'];
    for (const key of CHOICE_KEYS) origins[key] = Object.hasOwn(overrides, key) ? { level: 'run', revision: null }
      : Object.hasOwn(project.values, key) ? { level: 'project', revision: project.revision } : { level: 'global', revision: global.revision };
    return { projectId, choices, origins, globalRevision: global.revision, projectRevision: project.revision };
  }
  // The utility-process entrypoint must use this boundary under main's
  // ConfigurationClient matching-policy ownership through the terminal reply.
  // An async boolean alone is not a write lease. Matching values stay in main;
  // admit the resolved inherited values before the synchronous writer.
  // handle() rechecks both revisions after admission, so an intervening defaults
  // change cannot substitute different values for those that were approved.
  async handleAdmitted(request: ConfigurationRequest, admit: (value: unknown) => Promise<void>): Promise<ConfigurationReply<ConfigurationValue>> {
    try {
      await admit(request);
      if (request.kind === 'save') {
        // Preview the exact saved replay or proposed write. A retry must not
        // resolve unrelated newer defaults in place of its immutable snapshot.
        const prepared = this.handle(request, true);
        if (!prepared.ok) return prepared;
        await admit((prepared.value as ConfigurationSnapshot).choices);
      }
      return this.handle(request);
    } catch {
      return { ok: false, error: { code: 'unavailable', origin: 'run_configuration', operationId: request?.operationId ?? '',
        message: 'Configuration choices could not be safely admitted. Review inherited defaults and credential storage before retrying.', effect: 'none', retry: 'after_reconcile' } };
    }
  }
  handle(request: ConfigurationRequest, previewOnly = false): ConfigurationReply<ConfigurationValue> {
    let operationId = '';
    let db: Database.Database | undefined;
    let writing = false;
    try {
      id(request?.operationId); operationId = request.operationId;
      if (previewOnly && request.kind !== 'save') fail('invalid_input', 'Only a configuration save can be previewed.');
      if (request.kind === 'global:get') return { ok: true, value: this.defaults(this.global, null) };
      if (request.kind === 'global:recover') return { ok: true, value: this.recovery(this.global, null) };
      if (!['global:update', 'project:get', 'project:recover', 'project:update', 'prepare', 'save', 'snapshots', 'snapshot'].includes(request.kind)) fail('invalid_input', 'Unsupported configuration request.');
      const projectId = request.kind === 'global:update' ? null : request.kind === 'save' ? request.input?.projectId : request.projectId;
      if (projectId !== null) {
        id(projectId);
        const opened = this.catalog.handle({ kind: 'open', operationId, projectId });
        if (!opened.ok) fail(opened.error.code === 'not_found' ? 'not_found' : 'unavailable', 'The project is unavailable. Restore and reopen its original folder before changing configurations.');
        if (!('location' in opened.value)) throw new Error();
        const filename = path.join(opened.value.location, '.lab', 'configuration.sqlite');
        const established = !!this.global.prepare('SELECT 1 FROM project_stores WHERE project_id = ?').get(projectId);
        if (established) {
          // Once initialized, missing storage is a recovery failure, never a new
          // empty store that makes saved configurations silently disappear.
          lstatSync(filename);
        }
        db = this.open(filename, projectId, established);
        this.global.prepare('INSERT OR IGNORE INTO project_stores VALUES (?)').run(projectId);
      }
      const store = db ?? this.global;
      if (request.kind === 'global:update' || request.kind === 'project:update') {
        const input = request.input;
        id(input?.requestId); revision(input.expectedRevision);
        if (input.requestId !== operationId) fail('invalid_input', 'The settings request identity does not match.');
        let values: ChoiceOverrides;
        try { values = validateOverrides(input.values); } catch { fail('invalid_input', 'Enter valid settings without credentials: a supported agent, model ID, positive whole seconds and an optional objective.'); }
        if (projectId === null) values = { ...EMPTY_CHOICES, ...values };
        const command = JSON.stringify({ expectedRevision: input.expectedRevision, values });
        const prior = store.prepare('SELECT * FROM defaults_revisions WHERE request_id = ?').get(operationId) as DefaultsRow | undefined;
        if (prior) {
          if (prior.command !== command) fail('idempotency_conflict', 'This request already saved different settings. Reload before saving again.');
          return { ok: true, value: { ...this.defaults(store, projectId), revision: prior.revision, values: validateOverrides(JSON.parse(prior.values_json)) } };
        }
        if (this.defaults(store, projectId).revision !== input.expectedRevision) fail('conflict', 'Defaults changed since you opened this form. Reload settings and review your choices.');
        writing = true;
        store.prepare('INSERT INTO defaults_revisions VALUES (?, ?, ?, ?)').run(input.expectedRevision + 1, operationId, command, JSON.stringify(values));
        return { ok: true, value: this.defaults(store, projectId) };
      }
      if (!db || !projectId) throw new Error();
      switch (request.kind) {
        case 'project:get': return { ok: true, value: this.defaults(db, projectId) };
        case 'project:recover': return { ok: true, value: this.recovery(db, projectId) };
        case 'prepare': return { ok: true, value: this.draft(db, projectId) };
        case 'snapshots': return { ok: true, value: (db.prepare('SELECT record_json FROM snapshots ORDER BY rowid DESC').all() as { record_json: string }[]).map(row => this.snapshot(row.record_json, projectId)) };
        case 'snapshot': {
          id(request.snapshotId);
          const row = db.prepare('SELECT record_json FROM snapshots WHERE snapshot_id = ?').get(request.snapshotId) as { record_json: string } | undefined;
          if (!row) fail('not_found', 'This saved configuration is not in the selected project.');
          return { ok: true, value: this.snapshot(row.record_json, projectId) };
        }
        case 'save': {
          const input = request.input;
          id(input.requestId); revision(input.globalRevision); revision(input.projectRevision);
          if (input.requestId !== operationId) fail('invalid_input', 'The configuration request identity does not match.');
          let overrides: ChoiceOverrides;
          try { overrides = validateOverrides(input.overrides); } catch { fail('invalid_input', 'Enter valid configuration choices without credentials.'); }
          const command = JSON.stringify({ projectId, globalRevision: input.globalRevision, projectRevision: input.projectRevision, overrides });
          const prior = db.prepare('SELECT command, record_json FROM snapshots WHERE request_id = ?').get(operationId) as { command: string; record_json: string } | undefined;
          if (prior) {
            if (prior.command !== command) fail('idempotency_conflict', 'This request already saved a different configuration. Prepare a new configuration.');
            return { ok: true, value: this.snapshot(prior.record_json, projectId) };
          }
          const draft = this.draft(db, projectId, overrides);
          if (draft.globalRevision !== input.globalRevision || draft.projectRevision !== input.projectRevision) fail('conflict', 'Defaults changed while preparing this configuration. Prepare it again to review the new values.');
          const snapshot: ConfigurationSnapshot = { ...draft, recordKind: 'run_configuration', schemaVersion: 1, owner: 'run_configuration',
            snapshotId: randomUUID(), runId: randomUUID(), createdAt: new Date().toISOString(), preparation: 'unprepared' };
          if (previewOnly) return { ok: true, value: snapshot };
          writing = true;
          db.prepare('INSERT INTO snapshots VALUES (?, ?, ?, ?, ?)').run(snapshot.snapshotId, snapshot.runId, operationId, command, JSON.stringify(snapshot));
          return { ok: true, value: snapshot };
        }
      }
      throw new Error();
    } catch (error) {
      const code = error instanceof Failure ? error.code : 'unavailable';
      return { ok: false, error: { code, origin: 'run_configuration', operationId,
        message: error instanceof Failure ? error.message : 'Configuration storage is unavailable. Restore folder access, check free disk space and reopen with a compatible app. Saved records were preserved.',
        effect: writing ? 'unknown' : 'none', retry: code === 'invalid_input' || code === 'idempotency_conflict' ? 'never' : writing ? 'same_key' : 'after_reconcile' } };
    } finally { db?.close(); }
  }
  private recovery(db: Database.Database, projectId: string | null) {
    // Read only the opaque replacement identity, never decode withheld choices.
    const row = db.prepare('SELECT revision FROM defaults_revisions ORDER BY revision DESC LIMIT 1').get() as { revision: number } | undefined;
    const current = row?.revision ?? 0; revision(current);
    return { scope: projectId ? 'project' as const : 'global' as const, projectId, revision: current };
  }
  private snapshot(json: string, projectId: string): ConfigurationSnapshot {
    const snapshot = JSON.parse(json) as ConfigurationSnapshot;
    if (Object.keys(snapshot).sort().join(',') !== ['recordKind', 'schemaVersion', 'owner', 'snapshotId', 'runId', 'createdAt', 'preparation', 'projectId', 'globalRevision', 'projectRevision', 'choices', 'origins'].sort().join(',')) throw new Error();
    if (snapshot.recordKind !== 'run_configuration' || snapshot.schemaVersion !== 1 || snapshot.owner !== 'run_configuration' || snapshot.projectId !== projectId || snapshot.preparation !== 'unprepared') throw new Error();
    id(snapshot.snapshotId); id(snapshot.runId); revision(snapshot.globalRevision); revision(snapshot.projectRevision);
    if (typeof snapshot.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/.test(snapshot.createdAt) ||
        !snapshot.origins || Object.keys(snapshot.origins).sort().join(',') !== [...CHOICE_KEYS].sort().join(',')) throw new Error();
    for (const key of CHOICE_KEYS) {
      const origin = snapshot.origins[key];
      if (!origin || Object.keys(origin).sort().join(',') !== 'level,revision') throw new Error();
      if (origin.level === 'run') { if (origin.revision !== null) throw new Error(); }
      else if (origin.level === 'project') { if (origin.revision !== snapshot.projectRevision) throw new Error(); }
      else if (origin.level === 'global') { if (origin.revision !== snapshot.globalRevision) throw new Error(); }
      else throw new Error();
    }
    // Revalidate, but never resolve stored choices against current defaults.
    if (Object.keys(validateOverrides(snapshot.choices)).length !== CHOICE_KEYS.length) throw new Error();
    return snapshot;
  }
}
