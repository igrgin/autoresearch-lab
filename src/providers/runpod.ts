import { CredentialService, CredentialMetadata } from '../security/credentials';
import { assertId, newId, Scope, SecurityError } from '../security/common';
import { Sanitizer } from '../security/sanitizer';
import type { Discovery, Inspection, ProviderCapability, ProviderError, ProviderErrorCode, ProviderInstance } from './contract';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';

const ORIGIN = 'https://api.runpod.io';
const MAX_BYTES = 4 * 1024 * 1024;
const messages: Record<ProviderErrorCode, string> = {
  authentication_required: 'Runpod authentication failed. Unlock credential storage or replace the API key in Credential settings.',
  permission_denied: 'Runpod access denied. Check the selected key and its account:read and pods:read permissions.',
  not_found: 'This Pod was not found or is not accessible with the selected key. This does not confirm deletion.',
  rate_limited: 'Runpod rate limit reached. Retry after the indicated time.',
  unavailable: 'Runpod discovery is unavailable. Check connectivity and retry.',
  deadline_exceeded: 'Runpod did not reply in time. Retry discovery.',
  invalid_response: 'Runpod returned an incomplete or unsupported response. Retry discovery.',
  invalid_input: 'Select an active Runpod credential and a discovered Pod.',
  capture_failed: 'Runpod information could not be safely displayed. Check credential settings and retry.',
};
class ReadFailure extends Error {
  constructor(readonly code: ProviderErrorCode, readonly retryAt?: string) { super(messages[code]); }
}
// A dedicated HTTPS connection avoids global fetch dispatchers and inherited proxy
// configuration. No redirect handling, cookie jar, ambient headers or custom CA path.
const directRead: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.origin !== ORIGIN || url.username || url.password || init?.method !== 'GET') throw new ReadFailure('invalid_input');
  return new Promise((resolve, reject) => {
    const requestHeaders: Record<string, string> = {};
    new Headers(init.headers).forEach((value, name) => { requestHeaders[name] = value; });
    const request = httpsRequest(url, { method: 'GET', agent: false, rejectUnauthorized: true, signal: init.signal ?? undefined,
      headers: requestHeaders }, response => {
      try {
        const headers = new Headers();
        for (const name of ['content-type', 'retry-after', 'ratelimit']) {
          const value = response.headers[name];
          if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
        }
        const status = response.statusCode ?? 502;
        if ([204, 205, 304].includes(status)) { response.destroy(); resolve(new Response(null, { status, headers })); }
        else resolve(new Response(Readable.toWeb(response) as ReadableStream<Uint8Array>, { status, headers }));
      } catch { response.destroy(); reject(new ReadFailure('invalid_response')); }
    });
    request.on('error', () => reject(new ReadFailure('unavailable')));
    request.end();
  });
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ReadFailure('invalid_response');
  return value as Record<string, unknown>;
}
function text(value: unknown, id = false): string {
  if (typeof value !== 'string' || !value || value.length > (id ? 256 : 512) ||
      (id && !/^[a-zA-Z0-9_-]+$/.test(value)) || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw new ReadFailure('invalid_response');
  return value;
}
function optionalText(value: unknown): string | null { return value == null ? null : text(value); }
function optionalNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new ReadFailure('invalid_response');
  return value;
}
function capability(name: ProviderCapability['name'], availability: ProviderCapability['availability'],
  reason: ProviderCapability['reason'], observedAt: string): ProviderCapability {
  return { name, version: 1, availability, reason, observedAt, scope: name === 'discovery' ? 'account' : 'resource', integration: 'runpod-rest-v2' };
}
function project(value: unknown, accountId: string, detail: boolean): ProviderInstance {
  const pod = object(value), receivedAt = new Date().toISOString();
  if (!['PROVISIONING', 'STARTING', 'RUNNING', 'EXITED', 'ERROR', 'TERMINATED'].includes(text(pod.status))) throw new ReadFailure('invalid_response');
  let allocation: ProviderInstance['allocation'] = null;
  if (pod.gpu != null) {
    const gpu = object(pod.gpu);
    if (!Number.isSafeInteger(gpu.count) || (gpu.count as number) < 1) throw new ReadFailure('invalid_response');
    allocation = { gpuType: text(gpu.id), gpuCount: gpu.count as number,
      systemRamGb: optionalNumber(gpu.memory), vcpuCount: optionalNumber(gpu.vcpuCount) };
  }
  // Do not copy env, args, registry, command strings, IPs, endpoints or runtime blobs.
  const direct = detail && pod.ssh != null ? object(pod.ssh).direct : null;
  return { recordKind: 'provider_instance', schemaVersion: 1, owner: 'provider_adapter',
    identity: { provider: 'runpod', resourceId: text(pod.id, true) }, accountId,
    reportedState: text(pod.status), receivedAt, source: 'runpod-rest-v2', allocation,
    cudaVersion: optionalText(pod.cudaVersion), capabilities: [
      capability('direct_ssh', 'unknown', !detail ? 'not_inspected' : direct ? 'endpoint_reported_unverified' : 'endpoint_not_reported', receivedAt),
      capability('gpu_inventory', 'unknown', 'remote_preflight_required', receivedAt),
      capability('execution', 'unknown', 'remote_preflight_required', receivedAt),
    ] };
}

// Trusted host constructs this adapter. The renderer selects only a stored reference;
// it cannot supply a URL, account binding, operation scope, or authentication value.
export class RunpodAdapter {
  #retryAfter = 0;
  // Workspace-only access scopes use private ephemeral IDs, never run/history records.
  #workspaceScope = { projectId: newId(), runId: newId() };
  constructor(private readonly credentials: CredentialService, private readonly sanitizer: Sanitizer,
    private readonly request: typeof fetch = directRead) {}
  private error(error: unknown, operationId: string): ProviderError {
    const code = error instanceof ReadFailure ? error.code : error instanceof SecurityError ?
      (error.code === 'invalid_input' ? 'invalid_input' : error.code === 'permission_denied' ? 'permission_denied' : 'authentication_required') : 'unavailable';
    return { code, origin: 'runpod_adapter', operationId, message: messages[code], effect: 'none',
      retry: ['invalid_input', 'permission_denied', 'authentication_required', 'capture_failed'].includes(code) ? 'never' : 'same_key',
      ...(error instanceof ReadFailure && error.retryAt ? { retryAt: error.retryAt } : {}) };
  }
  private entry(id: string): CredentialMetadata {
    assertId(id);
    const entry = this.credentials.list().find(item => item.id === id && item.category === 'runpod');
    if (!entry) throw new ReadFailure('permission_denied');
    if (entry.status !== 'active') throw new ReadFailure('authentication_required');
    return entry;
  }
  private safe<T>(value: T): T {
    try {
      const filtered = this.sanitizer.filter(value);
      // Required identity/capability semantics cannot be silently redacted or altered.
      if (filtered.redacted) throw new Error();
      return filtered.body as T;
    } catch { throw new ReadFailure('capture_failed'); }
  }
  private async read(route: string, key: string, signal: AbortSignal): Promise<unknown> {
    // Complete route allowlist; no caller-chosen origin, redirects, cookies or proxy config.
    if (!/^\/v2\/(?:account|pods(?:\/[A-Za-z0-9_-]+)?)(?:\?cursor=[A-Za-z0-9%_.!~*'()-]+)?$/.test(route)) throw new ReadFailure('invalid_input');
    for (let attempt = 0; attempt < 2; attempt++) {
      if (Date.now() < this.#retryAfter) throw new ReadFailure('rate_limited', new Date(this.#retryAfter).toISOString());
      const timeout = AbortSignal.timeout(10_000);
      const combined = AbortSignal.any([signal, timeout]);
      let response: Response | undefined;
      try {
        response = await this.request(ORIGIN + route, { method: 'GET', redirect: 'error', credentials: 'omit',
          headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, signal: combined });
        if (response.redirected) throw new ReadFailure('unavailable');
        // REST v2 reports fixed-window quota on successful responses too. Respect
        // exhausted windows before fetching the next page, without retaining headers.
        for (const window of (response.headers.get('ratelimit') ?? '').split(',')) {
          if (!/(?:^|;)\s*r=0\s*(?:;|$)/.test(window)) continue;
          const seconds = window.match(/(?:^|;)\s*t=(\d+)\s*(?:;|$)/)?.[1];
          if (seconds && Number.isSafeInteger(Number(seconds))) this.#retryAfter = Math.max(this.#retryAfter, Date.now() + Math.min(Number(seconds), 365 * 86400) * 1000);
        }
        if (response.status === 429) {
          const retry = response.headers.get('retry-after') ?? '';
          const date = Date.parse(retry);
          const delay = /^\d+(?:\.\d+)?$/.test(retry) ? Number(retry) * 1000 : Number.isFinite(date) ? date - Date.now() : 1000;
          this.#retryAfter = Math.max(this.#retryAfter, Date.now() + Math.max(1000, Math.min(Number.isFinite(delay) ? delay : 1000, 365 * 86400_000)));
          throw new ReadFailure('rate_limited', new Date(this.#retryAfter).toISOString());
        }
        if (!response.ok) throw new ReadFailure(({ 401: 'authentication_required', 403: 'permission_denied', 404: 'not_found' } as Record<number, ProviderErrorCode>)[response.status] ?? 'unavailable');
        if (!response.body || !/^application\/json\b/i.test(response.headers.get('content-type') ?? '')) throw new ReadFailure('invalid_response');
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = []; let bytes = 0;
        try {
          while (true) {
            const chunk = await reader.read();
            if (combined.aborted) throw new ReadFailure('deadline_exceeded');
            if (chunk.done) break;
            bytes += chunk.value.length;
            if (bytes > MAX_BYTES) throw new ReadFailure('invalid_response');
            chunks.push(chunk.value);
          }
          try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
          catch { throw new ReadFailure('invalid_response'); }
        } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
      } catch (error) {
        if (signal.aborted) throw new ReadFailure(signal.reason?.name === 'TimeoutError' ? 'deadline_exceeded' : 'authentication_required');
        if (timeout.aborted) throw new ReadFailure('deadline_exceeded');
        const failure = error instanceof ReadFailure ? error : new ReadFailure('unavailable');
        if (failure.code !== 'unavailable' || attempt === 1) throw failure;
        // One bounded jittered retry for safe transient reads; no lifecycle retry path.
        await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 200));
      } finally { await response?.body?.cancel().catch(() => undefined); }
    }
    throw new ReadFailure('unavailable');
  }
  private async scoped<T>(id: string, operationId: string, purpose: 'discover' | 'inspect',
    handler: (key: string, signal: AbortSignal) => Promise<T>): Promise<T> {
    const entry = this.entry(id);
    const scope: Scope = { ...this.#workspaceScope, actionId: newId(), operationId };
    return this.credentials.bindAdapter({ component: 'runpod_adapter', accountId: entry.accountId,
      credentialId: entry.id, purpose, scope }, (key, signal) => handler(key,
      AbortSignal.any([signal, AbortSignal.timeout(60_000)]))).execute(scope);
  }
  async discover(id: string): Promise<Discovery> {
    const operationId = newId();
    const result: Discovery = { contractVersion: { major: 1, minor: 0 }, operationId, accountId: null,
      receivedAt: new Date().toISOString(), complete: false, pages: 0, items: [], capabilities: [] };
    try {
      return await this.scoped(id, operationId, 'discover', async (key, signal) => {
        try {
          const account = object(await this.read('/v2/account', key, signal));
          result.accountId = this.safe(text(account.id, true));
          const cursors = new Set<string>(), pods = new Map<string, ProviderInstance>();
          let cursor: string | null = null;
          do {
            const page = object(await this.read('/v2/pods' + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''), key, signal));
            if (!Array.isArray(page.pods)) throw new ReadFailure('invalid_response');
            const pagination = object(page.pagination);
            if (typeof pagination.hasNextPage !== 'boolean' ||
                (pagination.hasNextPage ? typeof pagination.nextCursor !== 'string' || !pagination.nextCursor || pagination.nextCursor.length > 4096 : pagination.nextCursor !== null)) throw new ReadFailure('invalid_response');
            const items = page.pods.map(pod => this.safe(project(pod, result.accountId!, false)));
            for (const item of items) {
              const previous = pods.get(item.identity.resourceId);
              // Cursor races cannot silently overwrite observations or fabricate completeness.
              if (previous) throw new ReadFailure('invalid_response');
              pods.set(item.identity.resourceId, item);
            }
            result.pages++;
            result.items = [...pods.values()].filter(pod => pod.reportedState === 'RUNNING' && pod.allocation !== null);
            if (pods.size > 100_000 || result.pages > 1000) throw new ReadFailure('invalid_response');
            cursor = pagination.hasNextPage ? pagination.nextCursor as string : null;
            if (cursor && cursors.has(cursor)) throw new ReadFailure('invalid_response');
            if (cursor) cursors.add(cursor);
          } while (cursor);
          result.complete = true;
          result.capabilities = [capability('discovery', 'available', 'read_verified', new Date().toISOString())];
        } catch (error) { result.error = this.error(error, operationId); }
        finally { result.receivedAt = new Date().toISOString(); }
        return result;
      });
    } catch (error) {
      // Revocation/rotation while a request was in flight invalidates the entire result.
      return { ...result, accountId: null, items: [], complete: false, capabilities: [], error: this.error(error, operationId) };
    }
  }
  async inspect(id: string, resourceId: string): Promise<Inspection> {
    const operationId = newId();
    try {
      text(resourceId, true);
      return await this.scoped(id, operationId, 'inspect', async (key, signal): Promise<Inspection> => {
        try {
          const account = object(await this.read('/v2/account', key, signal));
          const instance = this.safe(project(await this.read(`/v2/pods/${resourceId}`, key, signal), text(account.id, true), true));
          if (instance.identity.resourceId !== resourceId) throw new ReadFailure('invalid_response');
          return { ok: true, instance };
        } catch (error) { return { ok: false, error: this.error(error, operationId) }; }
      });
    } catch (error) { return { ok: false, error: this.error(error, operationId) }; }
  }
}
