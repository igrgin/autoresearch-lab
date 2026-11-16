import path from 'node:path';
import { existsSync, lstatSync } from 'node:fs';
import { openStore } from '../catalog/storage';
import { assertId } from '../security/common';
import { ClaudeChoice, ClaudeFailure, ClaudeSelection, RunAgentSnapshot } from './contracts';
import { validateChoice } from './validation';

const sql = `CREATE TABLE agent_selection (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), revision INTEGER NOT NULL, body TEXT NOT NULL);
CREATE TABLE run_agent_inputs (snapshot_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, run_id TEXT NOT NULL UNIQUE, body TEXT NOT NULL)`;
export type SelectionCommand = { kind: 'get' } | { kind: 'save'; choice: ClaudeChoice; expectedRevision: number; observedAt: string } |
  { kind: 'runs'; projectId: string } | { kind: 'save_run'; snapshot: RunAgentSnapshot };
export type SelectionValue = ClaudeSelection | RunAgentSnapshot | RunAgentSnapshot[] | null;
// Constructed only in the utility coordinator, alongside the project catalog.
// A separate versioned store leaves the existing registry migration unchanged.
export class ClaudeSelectionStore {
  private readonly db;
  constructor(applicationData: string) {
    const filename = path.join(applicationData, 'agent-settings.sqlite');
    if (existsSync(filename) && (!lstatSync(filename).isFile() || lstatSync(filename).isSymbolicLink())) throw new ClaudeFailure('unavailable');
    this.db = openStore(filename, sql);
  }
  close() { this.db.close(); }
  handle(command: SelectionCommand): SelectionValue {
    switch (command.kind) {
      case 'get': {
        const row = this.db.prepare('SELECT body FROM agent_selection WHERE singleton = 1').get() as { body: string } | undefined;
        return row ? JSON.parse(row.body) as ClaudeSelection : null;
      }
      case 'save': return this.db.transaction(() => {
        const choice = validateChoice(command.choice);
        const previous = this.handle({ kind: 'get' }) as ClaudeSelection | null;
        if (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision !== (previous?.revision ?? 0)) throw new ClaudeFailure('conflict');
        if (!Number.isFinite(Date.parse(command.observedAt))) throw new ClaudeFailure('invalid_input');
        const record: ClaudeSelection = { ...choice, recordKind: 'agent_selection', schemaVersion: 1, owner: 'run_configuration',
          revision: command.expectedRevision + 1, observedAt: command.observedAt };
        this.db.prepare('INSERT INTO agent_selection VALUES (1, ?, ?) ON CONFLICT(singleton) DO UPDATE SET revision = excluded.revision, body = excluded.body').run(record.revision, JSON.stringify(record));
        return record;
      })();
      case 'runs': {
        assertId(command.projectId);
        return (this.db.prepare('SELECT body FROM run_agent_inputs WHERE project_id = ? ORDER BY rowid DESC').all(command.projectId) as { body: string }[]).map(row => JSON.parse(row.body));
      }
      case 'save_run': {
        const input = command.snapshot;
        const choice = validateChoice({ integration: input.integration, modelId: input.modelId, credentialId: input.credentialId });
        for (const id of [input.snapshotId, input.projectId, input.runId]) assertId(id);
        if (!Number.isFinite(Date.parse(input.catalogObservedAt)) || !Number.isFinite(Date.parse(input.createdAt))) throw new ClaudeFailure('invalid_input');
        const record: RunAgentSnapshot = { ...choice, recordKind: 'run_agent_configuration', schemaVersion: 1, owner: 'run_configuration',
          snapshotId: input.snapshotId, projectId: input.projectId, runId: input.runId, createdAt: input.createdAt, catalogObservedAt: input.catalogObservedAt };
        const old = this.db.prepare('SELECT body FROM run_agent_inputs WHERE snapshot_id = ? OR run_id = ?').get(input.snapshotId, input.runId) as { body: string } | undefined;
        if (old) {
          const prior = JSON.parse(old.body) as RunAgentSnapshot;
          if (['snapshotId', 'projectId', 'runId', 'integration', 'modelId', 'credentialId'].some(key => prior[key as keyof RunAgentSnapshot] !== record[key as keyof RunAgentSnapshot])) throw new ClaudeFailure('conflict');
          return prior;
        }
        this.db.prepare('INSERT INTO run_agent_inputs VALUES (?, ?, ?, ?)').run(record.snapshotId, record.projectId, record.runId, JSON.stringify(record));
        return record;
      }
    }
    throw new ClaudeFailure('invalid_input');
  }
}
