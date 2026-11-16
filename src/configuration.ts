// Renderer-safe, versioned configuration-owner contracts. No database or host types.
// Missing project keys inherit; an explicit null deliberately leaves a choice unset.
export interface RunChoices {
  agent: { integration: 'codex' | 'claude'; model: string | null } | null;
  trainingDurationSeconds: number | null;
  objective: string | null;
}
export type ChoiceOverrides = Partial<RunChoices>;
export const EMPTY_CHOICES: RunChoices = { agent: null, trainingDurationSeconds: null, objective: null };
export const CHOICE_KEYS = ['agent', 'trainingDurationSeconds', 'objective'] as const;
export interface DefaultsRecord {
  recordKind: 'configuration_defaults'; schemaVersion: 1; owner: 'run_configuration';
  scope: 'global' | 'project'; projectId: string | null; revision: number;
  values: ChoiceOverrides;
}
export interface DefaultsRecovery {
  scope: 'global' | 'project'; projectId: string | null; revision: number;
}
export interface ConfigurationDraft {
  projectId: string; globalRevision: number; projectRevision: number;
  choices: RunChoices;
  origins: Record<keyof RunChoices, { level: 'global' | 'project' | 'run'; revision: number | null }>;
}
export interface ConfigurationSnapshot extends ConfigurationDraft {
  recordKind: 'run_configuration'; schemaVersion: 1; owner: 'run_configuration';
  snapshotId: string; runId: string; createdAt: string;
  preparation: 'unprepared';
}
export interface SaveConfiguration {
  requestId: string; projectId: string; globalRevision: number; projectRevision: number;
  overrides: ChoiceOverrides;
}
export interface UpdateDefaults {
  requestId: string; expectedRevision: number; values: ChoiceOverrides;
}
export interface ConfigurationError {
  code: 'invalid_input' | 'conflict' | 'not_found' | 'unavailable' | 'idempotency_conflict';
  origin: 'run_configuration'; operationId: string; message: string;
  effect: 'none' | 'unknown'; retry: 'never' | 'same_key' | 'after_reconcile';
}
export type ConfigurationReply<T> = { ok: true; value: T } | { ok: false; error: ConfigurationError };
export type ConfigurationValue = DefaultsRecord | DefaultsRecovery | ConfigurationDraft | ConfigurationSnapshot | ConfigurationSnapshot[];
export type ConfigurationRequest =
  | { kind: 'global:get'; operationId: string }
  | { kind: 'global:recover'; operationId: string }
  | { kind: 'global:update'; operationId: string; input: UpdateDefaults }
  | { kind: 'project:get'; operationId: string; projectId: string }
  | { kind: 'project:recover'; operationId: string; projectId: string }
  | { kind: 'project:update'; operationId: string; projectId: string; input: UpdateDefaults }
  | { kind: 'prepare'; operationId: string; projectId: string }
  | { kind: 'save'; operationId: string; input: SaveConfiguration }
  | { kind: 'snapshots'; operationId: string; projectId: string }
  | { kind: 'snapshot'; operationId: string; projectId: string; snapshotId: string };
