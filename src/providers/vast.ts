import { setTimeout as delay } from 'node:timers/promises';
import type { Reported, VastDiscovery, VastFailure, VastInstance, VastReply } from './vast-contract';

const columns = ['id', 'actual_status', 'intended_status', 'cur_state', 'next_state', 'label', 'num_gpus', 'gpu_name', 'cpu_cores_effective', 'disk_space'];
const messages: Record<VastFailure, string> = {
  invalid_credentials: 'Vast.ai rejected this API key. Replace it in Credential settings.',
  insufficient_scope: 'Vast.ai denied instance discovery. Use a key with instance_read permission.',
  two_factor_required: 'Vast.ai requires two-factor authentication. Complete provider login, then enter its session credential in Credential settings.',
  session_expired: 'The Vast.ai session expired. Complete provider login again and enter a new session credential in Credential settings.',
  authentication_required: 'Unlock Credential settings and select an active Vast.ai credential.',
  unavailable: 'Vast.ai discovery failed. Check your connection and retry.',
  rate_limited: 'Vast.ai is limiting requests. Retry later.',
  deadline_exceeded: 'Vast.ai discovery timed out. Retry when the service is reachable.',
  invalid_response: 'Vast.ai returned an incomplete or unsupported response. Retry discovery; no empty result was established.',
  unsafe_response: 'Vast.ai response details could not be safely displayed. No new instance list was published.',
  not_found: 'This instance is not visible to the selected credential. This does not confirm deletion.',
};
export function vastFailure<T>(reason: VastFailure, operationId: string): VastReply<T> {
  const code = reason === 'insufficient_scope' ? 'permission_denied' :
    ['invalid_credentials', 'two_factor_required', 'session_expired', 'authentication_required'].includes(reason) ? 'authentication_required' :
      reason === 'rate_limited' || reason === 'deadline_exceeded' || reason === 'not_found' ? reason : 'unavailable';
  return { ok: false, error: { code, reason, origin: 'vast_adapter', operationId, message: messages[reason], effect: 'none',
    retry: ['unavailable', 'rate_limited', 'deadline_exceeded', 'invalid_response'].includes(reason) ? 'same_key' : 'never' } };
}
class ReadFailure extends Error { constructor(readonly reason: VastFailure) { super('Vast read failed.'); } }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function text(value: unknown): Reported<string> {
  if (value === undefined || value === null || value === '') return { availability: 'unavailable', reason: 'not_reported' };
  return typeof value === 'string' && value.length <= 200 && ![...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ?
    { availability: 'available', value } : { availability: 'unavailable', reason: 'invalid' };
}
function number(value: unknown, integer = false): Reported<number> {
  if (value === undefined || value === null) return { availability: 'unavailable', reason: 'not_reported' };
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && (!integer || Number.isSafeInteger(value)) ?
    { availability: 'available', value } : { availability: 'unavailable', reason: 'invalid' };
}
function project(raw: unknown, accountId: string, source: VastInstance['source']): VastInstance {
  if (!object(raw) || !Number.isSafeInteger(raw.id) || (raw.id as number) <= 0) throw new ReadFailure('invalid_response');
  const resourceId = String(raw.id);
  return { provider: 'vast', resourceId, canonicalKey: `vast:${resourceId}`, accountId,
    actualState: text(raw.actual_status), intendedState: text(raw.intended_status), contractState: text(raw.cur_state),
    nextContractState: text(raw.next_state), label: text(raw.label),
    hardware: { gpuCount: number(raw.num_gpus, true), gpuModel: text(raw.gpu_name),
      gpuMemory: { availability: 'unavailable', reason: 'unverified_units' },
      effectiveCpuCores: number(raw.cpu_cores_effective), diskGb: number(raw.disk_space) },
    capabilities: { discovery: 'available', remoteAccess: 'unknown', gpuInventory: 'unknown', execution: 'unknown' },
    source, receivedAt: new Date().toISOString(), sourceTime: null };
}

// Only this adapter constructs URLs. No caller-supplied routes, cookies, proxies, redirects or lifecycle methods.
export class VastAdapter {
  constructor(private readonly request: typeof fetch = (...args) => fetch(...args),
    private readonly wait: (ms: number, signal: AbortSignal) => Promise<unknown> = (ms, signal) => delay(ms, undefined, { signal }),
    private readonly limits = { pages: 100, deadlineMs: 45_000, requestMs: 10_000 }) {}

  private async json(url: URL, key: string, signal: AbortSignal, session: boolean): Promise<unknown> {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (signal.aborted) throw new ReadFailure('deadline_exceeded');
      let response: Response;
      const timeout = AbortSignal.timeout(this.limits.requestMs);
      try {
        response = await this.request(url, { method: 'GET', redirect: 'error', credentials: 'omit',
          headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, signal: AbortSignal.any([signal, timeout]) });
      } catch {
        if (signal.aborted || timeout.aborted) throw new ReadFailure('deadline_exceeded');
        if (attempt === 2) throw new ReadFailure('unavailable');
        await this.wait(200 * 2 ** attempt, signal); continue;
      }
      if (response.redirected || response.status >= 300 && response.status < 400) throw new ReadFailure('unavailable');
      if (response.status === 429 || response.status >= 500) {
        const retryAfter = response.headers.get('retry-after');
        const seconds = retryAfter === null ? NaN : Number(retryAfter);
        const milliseconds = retryAfter === null ? 200 * 2 ** attempt :
          Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
        await response.body?.cancel();
        // Do not retry earlier than a server-requested long delay; return an actionable bounded failure.
        if (attempt === 2 || !Number.isFinite(milliseconds) || milliseconds > 5000) throw new ReadFailure(response.status === 429 ? 'rate_limited' : 'unavailable');
        await this.wait(Math.max(0, milliseconds), signal); continue;
      }
      // Read a bounded complete body before parsing; never log or expose a raw prefix.
      let bytes = 0; const chunks: Uint8Array[] = [];
      const reader = response.body?.getReader();
      if (!reader) throw new ReadFailure('invalid_response');
      try {
        while (true) {
          const part = await reader.read(); if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > 1024 * 1024) { await reader.cancel(); throw new ReadFailure('invalid_response'); }
          chunks.push(part.value);
        }
      } catch (error) { if (error instanceof ReadFailure) throw error; throw new ReadFailure(signal.aborted || timeout.aborted ? 'deadline_exceeded' : 'unavailable'); }
      let data: unknown;
      try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
      catch { if (response.ok) throw new ReadFailure('invalid_response'); }
      if (!response.ok || object(data) && data.success === false) {
        // Normalize known machine codes and the published CLI's legacy msg signals.
        // Vendor prose, challenge material and URLs are never returned or recorded.
        const code = object(data) ? data.error : undefined;
        const message = object(data) && typeof data.msg === 'string' ? data.msg : '';
        if (['2fa_required', 'tfa_required', 'two_factor_required', '2fa_expired'].includes(code as string) ||
            response.status === 401 && message.includes('Two Factor Authentication')) throw new ReadFailure('two_factor_required');
        if (['session_expired', 'tfa_session_expired'].includes(code as string) ||
            response.status === 404 && message === 'Session expired. Please log in again.') throw new ReadFailure('session_expired');
        if (response.status === 401) throw new ReadFailure(session ? 'session_expired' : 'invalid_credentials');
        if (response.status === 403) throw new ReadFailure('insufficient_scope');
        if (response.status === 404 && url.pathname.startsWith('/api/v0/instances/')) throw new ReadFailure('not_found');
        throw new ReadFailure('unavailable');
      }
      return data;
    }
    throw new ReadFailure('unavailable');
  }

  async discover(key: string, accountId: string, operationId: string, signal: AbortSignal, session = false): Promise<VastReply<VastDiscovery>> {
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(this.limits.deadlineMs)]);
    const instances = new Map<string, VastInstance>(); const cursors = new Set<string>();
    let cursor: string | undefined;
    try {
      for (let page = 0; page < this.limits.pages; page++) {
        const url = new URL('https://console.vast.ai/api/v1/instances/');
        url.searchParams.set('limit', '25'); url.searchParams.set('order_by', JSON.stringify([{ col: 'id', dir: 'asc' }]));
        url.searchParams.set('select_cols', JSON.stringify(columns));
        url.searchParams.set('select_filters', JSON.stringify({ actual_status: { eq: 'running' } }));
        if (cursor) url.searchParams.set('after_token', cursor);
        const data = await this.json(url, key, bounded, session);
        if (!object(data) || !Array.isArray(data.instances) || data.instances.length > 25 ||
            !Object.hasOwn(data, 'next_token') || !(data.next_token === null || typeof data.next_token === 'string' && data.next_token.length <= 4096)) throw new ReadFailure('invalid_response');
        for (const raw of data.instances) {
          const instance = project(raw, accountId, 'vast_rest_v1');
          if (instance.actualState.availability !== 'available') throw new ReadFailure('invalid_response');
          // Check locally as well as requesting the provider filter. Unknown/stopped is never a running choice.
          if (instance.actualState.availability === 'available' && instance.actualState.value === 'running') instances.set(instance.resourceId, instance);
          else instances.delete(instance.resourceId);
        }
        const next = data.next_token;
        if (!next) return { ok: true, value: { contractVersion: { major: 1, minor: 0 }, operationId, accountId, complete: true,
          instances: [...instances.values()].sort((a, b) => Number(a.resourceId) - Number(b.resourceId)), receivedAt: new Date().toISOString() } };
        if (cursors.has(next)) throw new ReadFailure('invalid_response');
        cursors.add(next); cursor = next;
      }
      throw new ReadFailure('invalid_response');
    } catch (error) { return vastFailure(error instanceof ReadFailure ? error.reason : bounded.aborted ? 'deadline_exceeded' : 'unavailable', operationId); }
  }

  async inspect(key: string, accountId: string, resourceId: string, operationId: string, signal: AbortSignal, session = false): Promise<VastReply<VastInstance>> {
    if (!/^[1-9][0-9]*$/.test(resourceId) || !Number.isSafeInteger(Number(resourceId))) return vastFailure('invalid_response', operationId);
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(this.limits.deadlineMs)]);
    try {
      const data = await this.json(new URL(`https://console.vast.ai/api/v0/instances/${resourceId}/`), key,
        bounded, session);
      if (!object(data)) throw new ReadFailure('invalid_response');
      if (data.instances === null) return vastFailure('not_found', operationId);
      const instance = project(data.instances, accountId, 'vast_rest_v0');
      if (instance.resourceId !== resourceId) throw new ReadFailure('invalid_response');
      return { ok: true, value: instance };
    } catch (error) { return vastFailure(error instanceof ReadFailure ? error.reason : bounded.aborted ? 'deadline_exceeded' : 'unavailable', operationId); }
  }
}
