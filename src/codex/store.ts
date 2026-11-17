import Database from 'better-sqlite3';
import path from 'node:path';
import { openStore } from '../catalog/storage';
import { assertId, newId } from '../security/common';
import { CODEX_PROTOCOL, CODEX_VERSION, type CodexMutation, type CodexDiagnostic, type AgentChoice, type AgentSnapshot, type CodexSettings, type CodexStoreCommand, type CodexStoreValue } from './contract';
import { CodexFailure } from './errors';
export const CODEX_SCHEMA_V1 = `CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK(id=1), credential_ref TEXT, default_agent TEXT);
CREATE TABLE diagnostics (operation_id TEXT PRIMARY KEY, observed_at TEXT NOT NULL, code TEXT NOT NULL);
CREATE TABLE agent_selections (snapshot_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, revision INTEGER NOT NULL,
  created_at TEXT NOT NULL, agent TEXT NOT NULL, UNIQUE(project_id, revision));`;
const receipts = `CREATE TABLE codex_mutations (request_id TEXT PRIMARY KEY, input TEXT NOT NULL, result TEXT NOT NULL);`;
// Physically hosted only by the utility coordinator. No change to registry/history schemas.
export class CodexStore {
  private readonly db: Database.Database;
  constructor(applicationData: string) { this.db = openStore(path.join(applicationData, 'codex-settings.sqlite'), CODEX_SCHEMA_V1, [receipts]); }
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
  private input(input: CodexMutation): string {
    const choice = input?.choice;
    if (!choice || Object.keys(choice).length !== 2 || typeof choice.model !== 'string' ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(choice.model) || typeof choice.effort !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,40}$/.test(choice.effort)) throw new CodexFailure('invalid_input');
    if (input.kind === 'default') return JSON.stringify({ kind: input.kind, model: choice.model, effort: choice.effort });
    if (input.kind !== 'run_save') throw new CodexFailure('invalid_input');
    assertId(input.projectId);
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new CodexFailure('invalid_input');
    return JSON.stringify({ kind: input.kind, projectId: input.projectId, expectedRevision: input.expectedRevision, model: choice.model, effort: choice.effort });
  }
  private saved(requestId: string, input: CodexMutation): AgentChoice | AgentSnapshot | null {
    assertId(requestId); const canonical = this.input(input);
    const row = this.db.prepare('SELECT input, result FROM codex_mutations WHERE request_id=?').get(requestId) as { input: string; result: string } | undefined;
    if (!row) return null;
    if (row.input !== canonical) throw new CodexFailure('conflict', requestId);
    const result = JSON.parse(row.result) as AgentChoice | AgentSnapshot;
    if (input.kind === 'default') return this.agent(result as AgentChoice);
    const snapshot = result as AgentSnapshot;
    assertId(snapshot.snapshotId);
    if (Object.keys(snapshot).length !== 8 || snapshot.recordKind !== 'agent_selection' || snapshot.schemaVersion !== 1 || snapshot.owner !== 'run_configuration' || snapshot.projectId !== input.projectId || snapshot.revision !== input.expectedRevision + 1) throw new CodexFailure('capture_failed');
    // Recover the immutable record, never the newest project selection.
    const stored = this.db.prepare('SELECT agent, created_at FROM agent_selections WHERE snapshot_id=? AND project_id=? AND revision=?')
      .get(snapshot.snapshotId, snapshot.projectId, snapshot.revision) as { agent: string; created_at: string } | undefined;
    if (!stored || stored.created_at !== snapshot.createdAt || JSON.stringify(this.agent(JSON.parse(stored.agent))) !== JSON.stringify(snapshot.agent)) throw new CodexFailure('capture_failed');
    return snapshot;
  }
  private mutate(command: Extract<CodexStoreCommand, { kind: 'default' | 'run_save' }>): AgentChoice | AgentSnapshot {
    return this.db.transaction(() => {
      const saved = this.saved(command.requestId, command); if (saved) return saved;
      const agent = this.agent(command.agent);
      if (agent.model !== command.choice.model || agent.effort !== command.choice.effort) throw new CodexFailure('invalid_input');
      if (this.settings().credentialRef !== agent.credentialRef) throw new CodexFailure('conflict');
      let result: AgentChoice | AgentSnapshot = agent;
      if (command.kind === 'default') this.db.prepare('UPDATE settings SET default_agent=? WHERE id=1').run(JSON.stringify(agent));
      else {
        const previous = this.latest(command.projectId);
        if (command.expectedRevision !== (previous?.revision ?? 0)) throw new CodexFailure('conflict');
        const snapshotId = newId(); const createdAt = new Date().toISOString(); const revision = command.expectedRevision + 1;
        this.db.prepare('INSERT INTO agent_selections VALUES (?, ?, ?, ?, ?)').run(snapshotId, command.projectId, revision, createdAt, JSON.stringify(agent));
        result = this.latest(command.projectId)!;
      }
      this.db.prepare('INSERT INTO codex_mutations VALUES (?, ?, ?)').run(command.requestId, this.input(command), JSON.stringify(result));
      return result;
    }).immediate();
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
      case 'default': case 'run_save': return this.mutate(command);
      case 'run_get': return this.latest(command.projectId);
      case 'mutation_receipt': {
        assertId(command.requestId);
        const row = this.db.prepare('SELECT input FROM codex_mutations WHERE request_id=?').get(command.requestId) as { input: string } | undefined;
        if (!row) return null;
        const input = JSON.parse(row.input);
        return this.saved(command.requestId, { ...input, choice: { model: input.model, effort: input.effort } });
      }
      case 'mutation_get': return this.saved(command.requestId, command.input);
      case 'barrier': return null;
      default: throw new CodexFailure('invalid_input');
    }
  }
}
