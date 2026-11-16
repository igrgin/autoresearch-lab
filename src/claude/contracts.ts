// Secret-free owner/adapter boundary. Research actions are owned by #51.
export const CLAUDE_SDK_VERSION = '0.3.323';
export const CLAUDE_CODE_VERSION = '2.1.323';
export const CATALOG_MAX_AGE_MS = 15 * 60_000;
export const QUALIFICATION_LIMITS = { wallMs: 45_000, maxTurns: 3, maxBudgetUsd: 0.05 } as const;
export type ClaudeReason = 'invalid_model' | 'unavailable_model' | 'unauthorized_model' | 'stale_catalog' |
  'authentication_required' | 'unavailable' | 'unsupported_capability' | 'model_mismatch' | 'qualification_failed' | 'conflict' | 'idempotency_conflict' | 'capture_failed' | 'invalid_input';
const messages: Record<ClaudeReason, string> = {
  invalid_model: 'Choose a canonical model from the authenticated supported catalog. Aliases are not saved.',
  unavailable_model: 'This model is retired, missing, or unsupported by this Claude worker. Refresh models and choose explicitly.',
  unauthorized_model: 'Anthropic denied access. Check the API key and model permissions in credential settings.',
  stale_catalog: 'The model catalog is stale or belongs to another credential. Refresh models before saving or checking access.',
  authentication_required: 'Select an active Anthropic API key in credential settings. Host and subscription authentication are not used.',
  unavailable: 'Claude discovery is unavailable or incomplete. Check connectivity and retry; the saved choice was preserved.',
  unsupported_capability: 'The Claude worker could not establish the required isolated SDK capabilities. This route is unavailable.',
  model_mismatch: 'Claude reported a different model. The choice was not qualified and no fallback was accepted.',
  qualification_failed: 'The bounded Claude check did not return a validated successful result. Model listing alone does not prove inference access.',
  conflict: 'These settings changed or this configuration identity is already used. Reload before saving.',
  idempotency_conflict: 'This save identity already records different choices. Reload before starting a new save.',
  capture_failed: 'Claude metadata was withheld by credential protection. Review credential exposure and retained choices before retrying.',
  invalid_input: 'The Claude settings request is invalid.',
};
export class ClaudeFailure extends Error {
  constructor(readonly reason: ClaudeReason, readonly effect: 'none' | 'unknown' = 'none') { super(messages[reason]); }
}
export type ClaudeReply<T> = { ok: true; value: T } | { ok: false; error: {
  code: 'invalid_input' | 'authentication_required' | 'permission_denied' | 'unavailable' | 'unsupported_capability' | 'conflict' | 'idempotency_conflict' | 'capture_failed';
  origin: 'claude'; operationId: string; reason: ClaudeReason; message: string; effect: 'none' | 'unknown'; retry: 'never' | 'same_key';
} };
export function failureReply(reason: ClaudeReason, operationId: string, effect: 'none' | 'unknown' = 'none'): ClaudeReply<never> {
  const code = reason === 'unauthorized_model' ? 'permission_denied' : reason === 'invalid_model' ? 'invalid_input' :
    ['authentication_required', 'unsupported_capability', 'conflict', 'idempotency_conflict', 'capture_failed', 'invalid_input'].includes(reason) ? reason as 'authentication_required' | 'unsupported_capability' | 'conflict' | 'idempotency_conflict' | 'capture_failed' | 'invalid_input' : 'unavailable';
  return { ok: false, error: { code, origin: 'claude', operationId, reason,
    message: effect === 'unknown' ? reason === 'capture_failed' ? 'The Claude choice may have been saved, but its metadata was withheld by credential protection. Review the exposure and reconcile this configuration before starting another save.' : 'The Claude save outcome is unknown. Retry the same save to reconcile it before changing choices.' : messages[reason],
    effect, retry: code === 'invalid_input' || code === 'idempotency_conflict' ? 'never' : 'same_key' } };
}
export interface ClaudeChoice { integration: 'claude'; credentialId: string; modelId: string }
export interface ClaudeModel { id: string; lifecycle: 'active' | 'deprecated' }
export interface ClaudeCatalog {
  credentialId: string; observedAt: string; complete: true; source: 'anthropic_models+sdk_supportedModels';
  sdkVersion: typeof CLAUDE_SDK_VERSION; models: ClaudeModel[];
}
export interface ClaudeSelection extends ClaudeChoice {
  recordKind: 'agent_selection'; schemaVersion: 1; owner: 'run_configuration'; revision: number; observedAt: string;
}
export interface RunAgentSnapshot extends ClaudeChoice {
  recordKind: 'run_agent_configuration'; schemaVersion: 1; owner: 'run_configuration';
  snapshotId: string; projectId: string; runId: string; createdAt: string; catalogObservedAt: string;
}
export interface ClaudeSettings {
  credentials: { id: string; label: string; status: string }[];
  selection: ClaudeSelection | null;
}
export interface ClaudeRecovery {
  credentials: ClaudeSettings['credentials'];
  revision: number;
}
export interface ClaudeBridge {
  settings(): Promise<ClaudeReply<ClaudeSettings>>;
  recovery(): Promise<ClaudeReply<ClaudeRecovery>>;
  openCredentials(): Promise<void>;
  discover(credentialId: string): Promise<ClaudeReply<ClaudeCatalog>>;
  save(choice: ClaudeChoice, expectedRevision: number, requestId: string): Promise<ClaudeReply<ClaudeSelection>>;
  qualify(choice: ClaudeChoice): Promise<ClaudeReply<{ modelId: string; checkedAt: string; status: 'qualified' }>>;
  runInputs(projectId: string): Promise<ClaudeReply<RunAgentSnapshot[]>>;
  saveRunInput(input: { projectId: string; runId: string; snapshotId: string; choice: ClaudeChoice }): Promise<ClaudeReply<RunAgentSnapshot>>;
}
export const validModelId = (id: unknown): id is string => typeof id === 'string' && /^claude-[a-z0-9][a-z0-9.-]{1,119}$/.test(id) && !id.endsWith('-latest');
