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
  effect: 'none' | 'unknown'; retry: 'never' | 'after_reconcile' | 'same_key';
}
export type CodexReply<T> = { ok: true; value: T } | { ok: false; error: CodexError };
export interface CodexDiagnostic { operationId: string; observedAt: string; code: CodexCode | 'authenticated'; detail: 'auth_bodies_and_native_diagnostics_excluded' }
export interface CodexView {
  diagnostics: CodexDiagnostic[];
  settings: CodexSettings; credentials: { id: string; label: string; status: string }[];
}
// Independently admitted identities for replacing withheld metadata. Never an
// agent choice, launch input or permission to read the quarantined record.
export interface CodexRecovery {
  credentialRef: string | null; credentials: CodexView['credentials'];
  selection: { snapshotId: string; projectId: string; revision: number } | null;
}
export interface ChooseAgent { model: string; effort: string }
export type CodexReconciliation = { requestId: string; state: 'absent' } | { requestId: string; state: 'committed'; result: AgentChoice | AgentSnapshot } |
  { requestId: string; state: 'withheld'; selection: CodexRecovery['selection'] };
export interface CodexBridge {
  reconcileSave(requestId: string): Promise<CodexReply<CodexReconciliation>>;
  settings(): Promise<CodexReply<CodexView>>;
  recovery(projectId?: string): Promise<CodexReply<CodexRecovery>>;
  credentials(): Promise<void>;
  authenticate(credentialRef: string): Promise<CodexReply<ModelCatalog>>;
  models(): Promise<CodexReply<ModelCatalog>>;
  saveDefault(choice: ChooseAgent, requestId: string): Promise<CodexReply<AgentChoice>>;
  runSelection(projectId: string): Promise<CodexReply<AgentSnapshot | null>>;
  saveRunSelection(projectId: string, expectedRevision: number, choice: ChooseAgent, requestId: string): Promise<CodexReply<AgentSnapshot>>;
}
export type CodexMutation = { kind: 'default'; choice: ChooseAgent } | { kind: 'run_save'; projectId: string; expectedRevision: number; choice: ChooseAgent };
export type CodexStoreCommand =
  | { kind: 'barrier' }
  | { kind: 'mutation_receipt'; requestId: string }
  | { kind: 'mutation_get'; requestId: string; input: CodexMutation }
  | { kind: 'settings' }
  | { kind: 'diagnostics' }
  | { kind: 'diagnostic'; diagnostic: CodexDiagnostic }
  | { kind: 'authenticate'; credentialRef: string }
  | { kind: 'default'; requestId: string; choice: ChooseAgent; agent: AgentChoice }
  | { kind: 'run_get'; projectId: string }
  | { kind: 'run_save'; requestId: string; projectId: string; expectedRevision: number; choice: ChooseAgent; agent: AgentChoice };
export type CodexStoreValue = CodexSettings | AgentChoice | AgentSnapshot | CodexDiagnostic[] | null;
