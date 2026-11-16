import Database from 'better-sqlite3';
import path from 'node:path';
import { openStore } from '../catalog/storage';
import { assertId, newId } from '../security/common';
import { CODEX_PROTOCOL, CODEX_VERSION, type CodexDiagnostic, type AgentChoice, type AgentSnapshot, type CodexSettings, type CodexStoreCommand, type CodexStoreValue } from './contract';
import { CodexFailure } from './errors';
const schema = `CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK(id=1), credential_ref TEXT, default_agent TEXT);
CREATE TABLE diagnostics (operation_id TEXT PRIMARY KEY, observed_at TEXT NOT NULL, code TEXT NOT NULL);
CREATE TABLE agent_selections (snapshot_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, revision INTEGER NOT NULL,
  created_at TEXT NOT NULL, agent TEXT NOT NULL, UNIQUE(project_id, revision));`;
// Physically hosted only by the utility coordinator. No change to registry/history schemas.
export class CodexStore {
  private readonly db: Database.Database;
  constructor(applicationData: string) { this.db = openStore(path.join(applicationData, 'codex-settings.sqlite'), schema); }
  close(): void { this.db.close(); }
  private settings(): CodexSettings {
    const row = this.db.prepare('SELECT credential_ref, default_agent FROM settings WHERE id=1').get() as { credential_ref: string | null; default_agent: string | null } | undefined;
    return row ? { credentialRef: row.credential_ref, defaultAgent: row.default_agent ? this.agent(JSON.parse(row.default_agent)) : null } : { credentialRef: null, defaultAgent: null };
  }
  private agent(input: AgentChoice): AgentChoice {
    assertId(input?.credentialRef);
    if (Object.keys(input).length !== 11 || input.integration !== 'codex' || input.provider !== 'openai' || input.authMode !== 'apiKey' ||
      input.protocolVersion !== CODEX_PROTOCOL || input.runtimeVersion !== CODEX_VERSION || input.entitlement !== 'unverified' ||
      typeof input.model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(input.model) ||
      typeof input.effort !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(input.effort) ||
      !Array.isArray(input.inputModalities) || !input.inputModalities.length || input.inputModalities.length > 32 ||
      input.inputModalities.some(value => typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(value)) ||
      typeof input.catalogObservedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/.test(input.catalogObservedAt)) throw new CodexFailure('invalid_input');
    return structuredClone(input);
  }
  private latest(projectId: string): AgentSnapshot | null {
    assertId(projectId);
    const row = this.db.prepare('SELECT * FROM agent_selections WHERE project_id=? ORDER BY revision DESC LIMIT 1').get(projectId) as {
      snapshot_id: string; project_id: string; revision: number; created_at: string; agent: string;
    } | undefined;
    return row ? { recordKind: 'agent_selection', schemaVersion: 1, owner: 'run_configuration', snapshotId: row.snapshot_id,
      projectId: row.project_id, revision: row.revision, createdAt: row.created_at, agent: this.agent(JSON.parse(row.agent)) } : null;
  }
  handle(command: CodexStoreCommand): CodexStoreValue {
    switch (command.kind) {
      case 'settings': return this.settings();
      case 'diagnostics': return (this.db.prepare('SELECT * FROM diagnostics ORDER BY rowid DESC LIMIT 20').all() as { operation_id: string; observed_at: string; code: CodexDiagnostic['code'] }[]).map(row => ({ operationId: row.operation_id, observedAt: row.observed_at, code: row.code, detail: 'auth_bodies_and_native_diagnostics_excluded' }));
      case 'diagnostic': {
        const value = command.diagnostic; assertId(value.operationId);
        if (Object.keys(value).length !== 4 || value.detail !== 'auth_bodies_and_native_diagnostics_excluded' ||
          !['configuration_rejected', 'authenticated', 'invalid_input', 'model_unavailable', 'authentication_required', 'permission_denied', 'rate_limited', 'unavailable', 'incompatible_version', 'capture_failed', 'conflict'].includes(value.code) ||
          !/^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/.test(value.observedAt)) throw new CodexFailure('invalid_input');
        this.db.transaction(() => {
          this.db.prepare('INSERT INTO diagnostics VALUES (?, ?, ?)').run(value.operationId, value.observedAt, value.code);
          this.db.exec('DELETE FROM diagnostics WHERE rowid NOT IN (SELECT rowid FROM diagnostics ORDER BY rowid DESC LIMIT 100)');
        })(); return null;
      }
      case 'authenticate': {
        assertId(command.credentialRef);
        // Preserve a previous choice; changed auth must never silently pick or replace a model.
        this.db.prepare('INSERT INTO settings VALUES (1, ?, NULL) ON CONFLICT(id) DO UPDATE SET credential_ref=excluded.credential_ref').run(command.credentialRef);
        return this.settings();
      }
      case 'default': {
        const agent = this.agent(command.agent);
        if (this.settings().credentialRef !== agent.credentialRef) throw new CodexFailure('conflict');
        this.db.prepare('UPDATE settings SET default_agent=? WHERE id=1').run(JSON.stringify(agent)); return agent;
      }
      case 'run_get': return this.latest(command.projectId);
      case 'run_save': return this.db.transaction(() => {
        const previous = this.latest(command.projectId);
        if (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision !== (previous?.revision ?? 0)) throw new CodexFailure('conflict');
        const agent = this.agent(command.agent);
        if (this.settings().credentialRef !== agent.credentialRef) throw new CodexFailure('conflict');
        const snapshotId = newId(); const createdAt = new Date().toISOString(); const revision = command.expectedRevision + 1;
        this.db.prepare('INSERT INTO agent_selections VALUES (?, ?, ?, ?, ?)').run(snapshotId, command.projectId, revision, createdAt, JSON.stringify(agent));
        return this.latest(command.projectId);
      })();
      default: throw new CodexFailure('invalid_input');
    }
  }
}
