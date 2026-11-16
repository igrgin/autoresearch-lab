import { newId } from '../security/common';
import type { CodexCode, CodexReply } from './contract';
const messages: Record<CodexCode, string> = {
  configuration_rejected: 'Codex inherited configuration cannot be safely isolated. Remove external system or managed Codex overrides before authenticating.',
  invalid_input: 'The model identifier or reasoning effort is invalid. Choose a returned catalog option.',
  model_unavailable: 'The selected model is unavailable in the current Codex catalog. Refresh and choose explicitly.',
  authentication_required: 'Codex authentication is required. Select an active OpenAI Platform key in settings.',
  permission_denied: 'Codex access was denied. Check the selected API key and its service permissions.',
  rate_limited: 'Codex reported a quota or rate limit. Check API billing and retry later.',
  unavailable: 'Codex could not finish the request. Retry authentication or refresh the catalog.',
  incompatible_version: 'The bundled Codex runtime or protocol is incompatible. Reinstall this app version.',
  capture_failed: 'Codex metadata could not be safely recorded. Check credential storage and retry.',
  conflict: 'These agent settings changed. Reload the saved selection before editing it.',
};
export class CodexFailure extends Error {
  constructor(readonly code: CodexCode, readonly operationId?: string) { super(messages[code]); }
}
export function codexFailure<T>(error: unknown, operationId = newId()): CodexReply<T> {
  const code = error instanceof CodexFailure ? error.code : 'unavailable';
  return { ok: false, error: { code, origin: 'codex_auth', operationId: error instanceof CodexFailure ? error.operationId ?? operationId : operationId, message: messages[code], effect: 'none',
    retry: ['invalid_input', 'incompatible_version'].includes(code) ? 'never' : 'after_reconcile' } };
}
// Interpret private diagnostics only in memory. Never return vendor text, data, or stack.
export function rpcFailure(input: unknown): CodexFailure {
  const value = input && typeof input === 'object' ? input as { code?: unknown; message?: unknown; data?: unknown } : {};
  const detail = `${typeof value.message === 'string' ? value.message : ''} ${JSON.stringify(value.data ?? null)}`.toLowerCase();
  if (/\b401\b|authentication|invalid.api.key|not.logged/.test(detail)) return new CodexFailure('authentication_required');
  if (/unauthorized|permission.denied|forbidden|\b403\b/.test(detail)) return new CodexFailure('permission_denied');
  if (/quota|rate.limit|\b429\b/.test(detail)) return new CodexFailure('rate_limited');
  if (/model.*(?:unavailable|not.found|does.not.exist)/.test(detail)) return new CodexFailure('model_unavailable');
  if (value.code === -32601) return new CodexFailure('incompatible_version');
  if (value.code === -32602) return new CodexFailure('invalid_input');
  return new CodexFailure('unavailable');
}
