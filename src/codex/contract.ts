// Renderer-safe projections. Raw App Server objects and authentication bodies stay private.
export const CODEX_VERSION = '0.169.0';
export const CODEX_PROTOCOL = 'codex-auth/1';
export interface ModelChoice {
  model: string; displayName: string; efforts: string[]; defaultEffort: string; inputModalities: string[];
}
export interface ModelCatalog {
  source: 'codex_app_server'; observedAt: string; complete: true; models: ModelChoice[];
  runtimeVersion: string; protocolVersion: typeof CODEX_PROTOCOL; entitlement: 'unverified';
}
export interface AgentChoice {
  integration: 'codex'; provider: 'openai'; authMode: 'apiKey'; credentialRef: string;
  model: string; effort: string; inputModalities: string[]; catalogObservedAt: string;
  runtimeVersion: string; protocolVersion: typeof CODEX_PROTOCOL; entitlement: 'unverified';
}
export interface AgentSnapshot {
  recordKind: 'agent_selection'; schemaVersion: 1; owner: 'run_configuration';
  snapshotId: string; projectId: string; revision: number; createdAt: string; agent: AgentChoice;
}
export interface CodexSettings {
  credentialRef: string | null; defaultAgent: AgentChoice | null;
}
export type CodexCode = 'configuration_rejected' | 'invalid_input' | 'model_unavailable' | 'authentication_required' | 'permission_denied' |
  'rate_limited' | 'unavailable' | 'incompatible_version' | 'capture_failed' | 'conflict';
export interface CodexError {
  code: CodexCode; origin: 'codex_auth'; operationId: string; message: string;
  effect: 'none'; retry: 'never' | 'after_reconcile';
}
export type CodexReply<T> = { ok: true; value: T } | { ok: false; error: CodexError };
export interface CodexDiagnostic { operationId: string; observedAt: string; code: CodexCode | 'authenticated'; detail: 'auth_bodies_and_native_diagnostics_excluded' }
export interface CodexView {
  diagnostics: CodexDiagnostic[];
  settings: CodexSettings; credentials: { id: string; label: string; status: string }[];
}
export interface ChooseAgent { model: string; effort: string }
export interface CodexBridge {
  settings(): Promise<CodexReply<CodexView>>;
  credentials(): Promise<void>;
  authenticate(credentialRef: string): Promise<CodexReply<ModelCatalog>>;
  models(): Promise<CodexReply<ModelCatalog>>;
  saveDefault(choice: ChooseAgent): Promise<CodexReply<AgentChoice>>;
  runSelection(projectId: string): Promise<CodexReply<AgentSnapshot | null>>;
  saveRunSelection(projectId: string, expectedRevision: number, choice: ChooseAgent): Promise<CodexReply<AgentSnapshot>>;
}
export type CodexStoreCommand =
  | { kind: 'settings' }
  | { kind: 'diagnostics' }
  | { kind: 'diagnostic'; diagnostic: CodexDiagnostic }
  | { kind: 'authenticate'; credentialRef: string }
  | { kind: 'default'; agent: AgentChoice }
  | { kind: 'run_get'; projectId: string }
  | { kind: 'run_save'; projectId: string; expectedRevision: number; agent: AgentChoice };
export type CodexStoreValue = CodexSettings | AgentChoice | AgentSnapshot | CodexDiagnostic[] | null;
