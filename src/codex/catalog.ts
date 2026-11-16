import type { ConfigReadParams } from './generated/v2/ConfigReadParams';
import type { InitializeParams } from './generated/InitializeParams';
import type { LoginAccountParams } from './generated/v2/LoginAccountParams';
import type { GetAccountParams } from './generated/v2/GetAccountParams';
import type { ModelListParams } from './generated/v2/ModelListParams';
import { Sanitizer } from '../security/sanitizer';
import { CODEX_PROTOCOL, CODEX_VERSION, type ChooseAgent, type ModelCatalog, type ModelChoice } from './contract';
import { CodexFailure } from './errors';
export type AuthMethod = 'initialize' | 'config/read' | 'account/login/start' | 'account/read' | 'model/list';
export interface AuthRpc { request(method: AuthMethod, params: unknown): Promise<unknown>; notifyInitialized(): void; close(): Promise<void> }
function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CodexFailure('incompatible_version');
  return input as Record<string, unknown>;
}
export function safeMetadata(value: unknown, sanitizer: Sanitizer, maximum = 200): string {
  if (typeof value !== 'string' || !value || value.length > maximum || [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new CodexFailure('incompatible_version');
  try { const admitted = sanitizer.filter(value); if (admitted.redacted || admitted.body !== value) throw new Error(); }
  catch { throw new CodexFailure('capture_failed'); }
  return value;
}
function modelChoice(raw: unknown, sanitizer: Sanitizer): ModelChoice | null {
  const value = object(raw);
  if (typeof value.hidden !== 'boolean') throw new CodexFailure('incompatible_version');
  if (value.hidden) return null;
  if (!Array.isArray(value.supportedReasoningEfforts) || !value.supportedReasoningEfforts.length ||
      value.supportedReasoningEfforts.length > 32 || !Array.isArray(value.inputModalities) ||
      !value.inputModalities.length || value.inputModalities.length > 32) throw new CodexFailure('incompatible_version');
  const efforts = value.supportedReasoningEfforts.map(item => safeMetadata(object(item).reasoningEffort, sanitizer, 40));
  const defaultEffort = safeMetadata(value.defaultReasoningEffort, sanitizer, 40);
  if (!efforts.includes(defaultEffort) || new Set(efforts).size !== efforts.length) throw new CodexFailure('incompatible_version');
  return { model: safeMetadata(value.model, sanitizer), displayName: safeMetadata(value.displayName, sanitizer), efforts, defaultEffort,
    inputModalities: value.inputModalities.map(item => safeMetadata(item, sanitizer, 40)) };
}
export function validateRuntimeConfig(raw: unknown): void {
  const reply = object(raw); const config = object(reply.config);
  if (config.cli_auth_credentials_store !== 'ephemeral' || config.model_provider !== 'openai' || config.forced_login_method !== 'api' ||
      !Array.isArray(reply.layers)) throw new CodexFailure('configuration_rejected');
  // HOME isolation alone does not suppress system/MDM configuration. Reject every
  // nonempty inherited layer before passing a credential to the native process.
  for (const rawLayer of reply.layers) {
    const layer = object(rawLayer); const source = object(layer.name);
    if (typeof source.type !== 'string' || !(layer.disabledReason == null || typeof layer.disabledReason === 'string')) throw new CodexFailure('configuration_rejected');
    if (source.type !== 'sessionFlags' && typeof layer.disabledReason !== 'string' && Object.keys(object(layer.config)).length) {
      throw new CodexFailure('configuration_rejected');
    }
  }
}
export async function authenticateAndList(rpc: AuthRpc, key: string, sanitizer: Sanitizer): Promise<ModelCatalog> {
  await rpc.request('initialize', { clientInfo: { name: 'autoresearch_lab', title: 'Autoresearch Lab', version: '0.1.0' }, capabilities: { experimentalApi: false, requestAttestation: false } } satisfies InitializeParams);
  rpc.notifyInitialized();
  validateRuntimeConfig(await rpc.request('config/read', { includeLayers: true } satisfies ConfigReadParams));
  if (object(await rpc.request('account/login/start', { type: 'apiKey', apiKey: key } satisfies LoginAccountParams)).type !== 'apiKey') throw new CodexFailure('authentication_required');
  const state = object(await rpc.request('account/read', { refreshToken: false } satisfies GetAccountParams));
  if (!state.account || object(state.account).type !== 'apiKey') throw new CodexFailure('authentication_required');
  const models: ModelChoice[] = []; const cursors = new Set<string>(); const ids = new Set<string>();
  let cursor: string | null = null;
  for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
    const page = object(await rpc.request('model/list', { cursor, limit: 100, includeHidden: false, modelProvider: 'openai' } satisfies ModelListParams));
    if (!Array.isArray(page.data) || page.data.length > 1000 || !(page.nextCursor === null || typeof page.nextCursor === 'string')) throw new CodexFailure('incompatible_version');
    for (const raw of page.data) {
      const model = modelChoice(raw, sanitizer);
      if (!model) continue;
      if (ids.has(model.model)) throw new CodexFailure('incompatible_version');
      ids.add(model.model); models.push(model);
    }
    if (page.nextCursor === null) return { source: 'codex_app_server', observedAt: new Date().toISOString(), complete: true, models,
      runtimeVersion: CODEX_VERSION, protocolVersion: CODEX_PROTOCOL, entitlement: 'unverified' };
    cursor = safeMetadata(page.nextCursor, sanitizer, 4096);
    if (cursors.has(cursor)) throw new CodexFailure('incompatible_version');
    cursors.add(cursor);
  }
  throw new CodexFailure('unavailable'); // incomplete catalogs never become selectable
}
export function validateChoice(input: ChooseAgent, catalog: ModelCatalog): ModelChoice {
  if (!input || typeof input !== 'object' || Object.keys(input).length !== 2 || typeof input.model !== 'string' ||
      typeof input.effort !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(input.model)) throw new CodexFailure('invalid_input');
  const model = catalog.models.find(model => model.model === input.model);
  if (!model) throw new CodexFailure('model_unavailable');
  if (!model.efforts.includes(input.effort)) throw new CodexFailure('invalid_input');
  return model;
}
