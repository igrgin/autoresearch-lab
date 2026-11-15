import { AdapterBinding, CredentialService } from './credentials';
import { sameScope, Scope, SecurityError, validateScope } from './common';
import { Envelope, SafeRecording } from './recording';
import { Sanitizer } from './sanitizer';

// Bootstrap binds the real component, account and action before model/tool input is accepted.
// The returned handle exposes no plaintext and filters even successful tool returns pre-model.
export function bindRecordedOperation<T>(credentials: CredentialService, recording: SafeRecording, binding: AdapterBinding,
  meta: Envelope, handler: (value: string, signal: AbortSignal) => Promise<T>) {
  if (!sameScope(validateScope(binding.scope), validateScope(meta))) throw new SecurityError('permission_denied');
  const boundMeta = structuredClone(meta);
  const port = credentials.bindAdapter(binding, handler);
  return Object.freeze({ execute: async (scope: Scope) => {
    recording.assertCanAct(scope);
    const result = await port.execute(scope);
    try {
      const record = await recording.capture(boundMeta, result);
      if (record.coverage === 'omitted') throw new Error();
      return record.body;
    } catch { throw new SecurityError('capture_failed', 'unknown'); }
  } });
}

// Ingress rejects embedded authentication rather than executing a redacted command.
export function requireCredentialFreeCommand(sanitizer: Sanitizer, command: unknown): void {
  try {
    const safe = sanitizer.filter(command);
    if (safe.redacted) throw new Error();
  } catch { throw new SecurityError('permission_denied'); }
}

// Trusted adapters may use these reads; no lifecycle operation, redirect, arbitrary URL,
// proxy override, cookie inheritance, or bearer-bearing command is supported.
export async function providerRead(provider: 'runpod' | 'vast', route: string, credential: string, signal: AbortSignal,
  request: typeof fetch = fetch): Promise<Response> {
  const permitted = provider === 'runpod' ? /^\/v2\/(?:account|pods(?:\/[A-Za-z0-9_-]+)?)$/ : /^\/api\/(?:v1\/instances\/|v0\/instances\/[0-9]+\/)$/;
  if (!permitted.test(route)) throw new SecurityError('permission_denied');
  const origin = provider === 'runpod' ? 'https://api.runpod.io' : 'https://console.vast.ai';
  try {
    const response = await request(origin + route, { method: 'GET', redirect: 'error', credentials: 'omit',
      headers: { Authorization: `Bearer ${credential}` }, signal });
    if (!response.ok || response.redirected) throw new Error();
    return response; // trusted adapter must project vendor data before safe admission
  } catch { throw new SecurityError('authentication_required'); }
}

export function childEnvironment(kind: 'candidate' | 'codex' | 'claude', paths: { home: string; temporary: string; executablePath: string }, ownKey?: string): Record<string, string> {
  const env: Record<string, string> = { HOME: paths.home, TMPDIR: paths.temporary, PATH: paths.executablePath, LANG: 'en_US.UTF-8' };
  if (kind === 'claude' && ownKey) env.ANTHROPIC_API_KEY = ownKey;
  // Codex authentication travels through private ephemeral auth RPC, never environment.
  return env;
}
