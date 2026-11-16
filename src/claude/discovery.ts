import { CLAUDE_SDK_VERSION, ClaudeCatalog, ClaudeFailure, ClaudeModel, validModelId } from './contracts';

export async function readModels(key: string, signal: AbortSignal, request: typeof fetch = fetch): Promise<ClaudeModel[]> {
  const result: ClaudeModel[] = [];
  const seen = new Set<string>();
  let after: string | undefined;
  // Completeness must be bounded; no partial picker is published on any failure.
  for (let page = 0; page < 20; page++) {
    const url = new URL('https://api.anthropic.com/v1/models');
    url.searchParams.set('limit', '100');
    if (after) url.searchParams.set('after_id', after);
    let response: Response;
    try { response = await request(url, { method: 'GET', redirect: 'error', credentials: 'omit', signal,
      headers: { 'x-api-key': key, 'anthropic-version': '2026-10-21' } }); }
    catch { throw new ClaudeFailure('unavailable'); }
    if (response.status === 401) throw new ClaudeFailure('authentication_required');
    if (response.status === 403) throw new ClaudeFailure('unauthorized_model');
    if (!response.ok || response.redirected || !response.body) throw new ClaudeFailure('unavailable');
    // Do not let an untrusted provider response become an unbounded/raw diagnostic.
    const reader = response.body.getReader(); let bytes = 0; const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const next = await reader.read(); if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > 512_000) throw new Error();
        chunks.push(next.value);
      }
    } catch { await reader.cancel().catch(() => {}); throw new ClaudeFailure('unavailable'); }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ClaudeFailure('unavailable'); }
    if (!body || !Array.isArray(body.data) || body.data.length > 100 || typeof body.has_more !== 'boolean') throw new ClaudeFailure('unavailable');
    for (const model of body.data) {
      if (!model || !validModelId(model.id) || seen.has(model.id) || !['active', 'deprecated', 'retired'].includes(model.lifecycle)) throw new ClaudeFailure('unavailable');
      seen.add(model.id);
      if (model.lifecycle !== 'retired') result.push({ id: model.id, lifecycle: model.lifecycle });
    }
    if (!body.has_more) return result;
    if (!body.data.length || body.last_id !== body.data.at(-1).id || body.last_id === after) throw new ClaudeFailure('unavailable');
    after = body.last_id;
  }
  throw new ClaudeFailure('unavailable');
}

export function intersectModels(api: ClaudeModel[], sdk: unknown, credentialId: string, now = Date.now()): ClaudeCatalog {
  if (!Array.isArray(sdk) || sdk.length > 2000) throw new ClaudeFailure('unsupported_capability');
  const resolved = new Set<string>();
  for (const row of sdk) {
    // An unresolved alias never establishes support for a canonical ID.
    if (row && validModelId(row.resolvedModel)) resolved.add(row.resolvedModel);
  }
  return { credentialId, observedAt: new Date(now).toISOString(), complete: true,
    source: 'anthropic_models+sdk_supportedModels', sdkVersion: CLAUDE_SDK_VERSION,
    models: api.filter(row => resolved.has(row.id)).sort((a, b) => a.id.localeCompare(b.id)) };
}
