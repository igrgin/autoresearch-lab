import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { VastAdapter } from '../src/providers/vast';
import { VastConnection } from '../src/providers/vast-connection';
import { CredentialService } from '../src/security/credentials';
import { SafeRecording } from '../src/security/recording';
import { PrivateFiles } from '../src/security/private-files';
import { Sanitizer } from '../src/security/sanitizer';
import { newId } from '../src/security/common';

const secret = 'synthetic-vast-account-secret-40';
const leaked = 'provider-injected-unrelated-secret';
const row = (id = 17) => ({ id, actual_status: 'running', intended_status: 'stopped', cur_state: 'loading', next_state: 'running',
  label: 'Fixture rental', num_gpus: 2, gpu_name: 'RTX 4090', cpu_cores_effective: 4, disk_space: 80,
  gpu_ram: 24576, cpu_ram: 128000, gpu_util: 89, jupyter_token: leaked, extra_env: { API_KEY: secret }, onstart: secret });
const page = (instances: unknown[], next_token: string | null = null) => ({ success: true, instances, next_token });
const response = (body: unknown, status = 200, headers?: Record<string, string>) => new Response(JSON.stringify(body), { status, headers });
const request = (handler: (url: URL, init: RequestInit) => Promise<Response>): typeof fetch =>
  ((input: string | URL | Request, init?: RequestInit) => handler(new URL(String(input)), init!)) as typeof fetch;
const run = (adapter: VastAdapter) => adapter.discover(secret, newId(), newId(), new AbortController().signal);
const noWait = async () => undefined;

test('complete discovery follows all v1 cursors, uses restricted GET columns, deduplicates and preserves canonical identity/states', async () => {
  const calls: URL[] = [];
  const adapter = new VastAdapter(request(async (url, init) => {
    calls.push(url); assert.equal(url.origin, 'https://console.vast.ai'); assert.equal(url.pathname, '/api/v1/instances/');
    assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit');
    assert.deepEqual(init.headers, { Authorization: `Bearer ${secret}`, Accept: 'application/json' });
    assert.equal(url.searchParams.get('limit'), '25');
    assert.deepEqual(JSON.parse(url.searchParams.get('order_by')!), [{ col: 'id', dir: 'asc' }]);
    assert.deepEqual(JSON.parse(url.searchParams.get('select_filters')!), { actual_status: { eq: 'running' } });
    const cols = JSON.parse(url.searchParams.get('select_cols')!);
    for (const forbidden of ['*', 'jupyter_token', 'extra_env', 'onstart', 'image_args', 'status_msg']) assert.ok(!cols.includes(forbidden));
    return calls.length === 1 ? response(page([row(17)], 'opaque+/cursor=')) : response(page([row(17), row(18)]));
  }));
  const result = await run(adapter); assert.ok(result.ok);
  assert.equal(calls[0].searchParams.has('after_token'), false); assert.equal(calls[1].searchParams.get('after_token'), 'opaque+/cursor=');
  assert.equal(result.value.complete, true); assert.deepEqual(result.value.instances.map(i => i.canonicalKey), ['vast:17', 'vast:18']);
  const instance = result.value.instances[0];
  assert.deepEqual(instance.actualState, { availability: 'available', value: 'running' });
  assert.deepEqual(instance.intendedState, { availability: 'available', value: 'stopped' });
  assert.deepEqual(instance.contractState, { availability: 'available', value: 'loading' });
  assert.deepEqual(instance.hardware.gpuCount, { availability: 'available', value: 2 });
  assert.deepEqual(instance.hardware.gpuMemory, { availability: 'unavailable', reason: 'unverified_units' });
  assert.equal(instance.capabilities.execution, 'unknown'); assert.equal(instance.sourceTime, null);
  const serialized = JSON.stringify(result); for (const unsafe of [secret, leaked, 'jupyter_token', 'extra_env', 'onstart', 'cpu_ram', 'gpu_util']) assert.ok(!serialized.includes(unsafe));
});

test('only actual running instances are choices; a complete empty scan is honest and missing/sentinel capabilities are unavailable', async () => {
  const result = await run(new VastAdapter(request(async () => response(page([
    { ...row(1), actual_status: 'stopped', intended_status: 'running' }, { ...row(2), actual_status: 'novel_state' },
    { ...row(3), num_gpus: null, gpu_name: null, cpu_cores_effective: -1, disk_space: -1 },
  ])))));
  assert.ok(result.ok); assert.equal(result.value.instances.length, 1);
  assert.deepEqual(result.value.instances[0].hardware.gpuCount, { availability: 'unavailable', reason: 'not_reported' });
  assert.deepEqual(result.value.instances[0].hardware.diskGb, { availability: 'unavailable', reason: 'invalid' });
  const empty = await run(new VastAdapter(request(async () => response(page([]))))); assert.ok(empty.ok); assert.deepEqual(empty.value.instances, []);
});

test('incomplete/malformed/repeating/oversized pages never publish a successful empty or partial scan', async () => {
  for (const bad of [{ instances: [] }, { instances: {}, next_token: null }, page([{ ...row(), id: '17' }]),
    page([{ ...row(), id: Number.MAX_SAFE_INTEGER + 1 }]), page([{ ...row(), actual_status: null }]), page(Array.from({ length: 26 }, () => row())),
    { instances: [], next_token: 123 }, { success: false, instances: [], next_token: null }]) {
    const result = await run(new VastAdapter(request(async () => response(bad)))); assert.equal(result.ok, false); assert.ok(!('value' in result));
  }
  let calls = 0;
  const failedSecond = await run(new VastAdapter(request(async () => ++calls === 1 ? response(page([row()], 'cursor')) : response({ message: secret }, 503)), noWait));
  assert.equal(calls, 4); assert.equal(failedSecond.ok, false); assert.ok(!JSON.stringify(failedSecond).includes(secret));
  const repeat = await run(new VastAdapter(request(async () => response(page([], 'same')))));
  assert.ok(!repeat.ok); assert.equal(repeat.error.reason, 'invalid_response');
  const limit = await run(new VastAdapter(request(async () => response(page([row()], newId()))), noWait, { pages: 2, deadlineMs: 1000, requestMs: 1000 }));
  assert.ok(!limit.ok); assert.equal(limit.error.reason, 'invalid_response');
  const huge = await run(new VastAdapter(request(async () => response({ text: 'x'.repeat(1024 * 1024) }))));
  assert.ok(!huge.ok); assert.equal(huge.error.reason, 'invalid_response');
});

test('bad key, scope, service 2FA, session expiry and failure responses have distinct safe structured errors', async () => {
  for (const [status, body, expected] of [
    [401, { message: secret }, 'invalid_credentials'], [403, { message: secret }, 'insufficient_scope'],
    [401, { error: '2fa_required', secret, challenge_url: secret }, 'two_factor_required'],
    [403, { error: 'tfa_required' }, 'two_factor_required'], [401, { error: 'session_expired' }, 'session_expired'],
    [401, { msg: `This endpoint requires Two Factor Authentication. ${secret}` }, 'two_factor_required'],
    [404, { msg: 'Session expired. Please log in again.' }, 'session_expired'],
    [401, { msg: 'Invalid user key' }, 'invalid_credentials'],
    [200, { success: false, error: '2fa_required' }, 'two_factor_required'], [404, {}, 'unavailable'],
  ] as const) {
    const result = await run(new VastAdapter(request(async () => response(body, status))));
    assert.ok(!result.ok); assert.equal(result.error.reason, expected); assert.equal(result.error.effect, 'none');
    assert.ok(!JSON.stringify(result).includes(secret)); assert.equal(result.error.origin, 'vast_adapter');
  }
  const malformedError = await run(new VastAdapter(request(async () => new Response(secret, { status: 401 }))));
  assert.ok(!malformedError.ok); assert.equal(malformedError.error.reason, 'invalid_credentials');
});

test('finite retry honors Retry-After, reports long limits immediately, handles transport errors and deadlines', async () => {
  let calls = 0; const waits: number[] = [];
  const adapter = new VastAdapter(request(async () => ++calls === 1 ? response({}, 429, { 'Retry-After': '2' }) : response(page([]))), async ms => { waits.push(ms); });
  assert.equal((await run(adapter)).ok, true); assert.equal(calls, 2); assert.deepEqual(waits, [2000]);
  calls = 0;
  const limited = await run(new VastAdapter(request(async () => { calls++; return response({}, 429, { 'Retry-After': '60' }); }), noWait));
  assert.ok(!limited.ok); assert.equal(limited.error.reason, 'rate_limited'); assert.equal(calls, 1);
  calls = 0;
  const network = await run(new VastAdapter(request(async () => { calls++; throw new Error(secret); }), noWait));
  assert.ok(!network.ok); assert.equal(network.error.reason, 'unavailable'); assert.equal(calls, 3); assert.ok(!JSON.stringify(network).includes(secret));
  const timeout = await run(new VastAdapter(request(async (_url, init) => new Promise((_resolve, reject) => {
    init.signal!.addEventListener('abort', () => reject(new Error(secret)), { once: true });
    // Keep the event loop alive for AbortSignal.timeout's unreferenced timer.
    const timer = setTimeout(() => reject(new Error('fixture exceeded timeout')), 100);
    init.signal!.addEventListener('abort', () => clearTimeout(timer), { once: true });
  })), noWait, { pages: 2, deadlineMs: 10, requestMs: 10 }));
  assert.ok(!timeout.ok); assert.equal(timeout.error.reason, 'deadline_exceeded');
});

test('detail validates v0 object independently, preserves non-running states, rejects list shape and wrong IDs', async () => {
  for (const [body, expected] of [
    [{ instances: { ...row(), actual_status: 'stopped', ports: [22], image_args: [secret] } }, true],
    [{ instances: [row()] }, false], [{ instances: row(18) }, false], [{ instances: null }, false],
  ] as const) {
    const adapter = new VastAdapter(request(async (url, init) => {
      assert.equal(url.pathname, '/api/v0/instances/17/'); assert.equal(url.searchParams.has('select_filters'), false); assert.equal(init.method, 'GET');
      return response(body);
    }));
    const result = await adapter.inspect(secret, newId(), '17', newId(), new AbortController().signal);
    assert.equal(result.ok, expected); assert.ok(!JSON.stringify(result).includes(secret));
    if (result.ok) assert.deepEqual(result.value.actualState, { availability: 'available', value: 'stopped' });
  }
  const adapter = new VastAdapter(request(async () => { throw new Error('Must not send an invalid ID'); }));
  assert.equal((await adapter.inspect(secret, newId(), '../17', newId(), new AbortController().signal)).ok, false);
});

async function fixture(adapter: VastAdapter) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lab-vast-40-')); const sanitizer = new Sanitizer(); const key = randomBytes(32);
  const vault = new PrivateFiles(path.join(directory, 'vault')); const records = new PrivateFiles(path.join(directory, 'records'));
  const encryption = { available: async () => true,
    encrypt: async (text: string) => { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv);
      return Buffer.concat([iv, cipher.update(text), cipher.final(), cipher.getAuthTag()]); },
    decrypt: async (bytes: Buffer) => { const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      cipher.setAuthTag(bytes.subarray(-16)); return Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()]).toString(); } };
  const credentials = new CredentialService(vault, encryption, sanitizer); await credentials.initialize();
  const recording = new SafeRecording(records, sanitizer, id => credentials.revoke(id)); await recording.initialize();
  const entry = await credentials.register('vast', newId(), 'Fixture account', secret);
  return { directory, credentials, recording, entry, sanitizer, vault, encryption, connection: new VastConnection(credentials, recording, adapter) };
}

test('shared credential service connects and rotation/restart preserves account and canonical identity; wrong category/revocation cannot dispatch', async () => {
  let calls = 0;
  const f = await fixture(new VastAdapter(request(async () => { calls++; return response(page([row()])); })));
  try {
    assert.deepEqual(JSON.parse(JSON.stringify(f.connection.choices())), [{ id: f.entry.id, label: 'Fixture account' }]);
    const first = await f.connection.discover(f.entry.id); assert.ok(first.ok);
    const replacement = await f.credentials.replace(f.entry.id, 'synthetic-rotated-vast-secret');
    const second = await f.connection.discover(replacement.id); assert.ok(second.ok);
    assert.equal(second.value.accountId, first.value.accountId); assert.equal(second.value.instances[0].canonicalKey, first.value.instances[0].canonicalKey);
    const other = await f.credentials.register('runpod', newId(), 'Other', 'synthetic-runpod-key');
    assert.equal((await f.connection.discover(other.id)).ok, false); assert.equal((await f.connection.discover(f.entry.id)).ok, false); assert.equal(calls, 2);
    const restarted = new CredentialService(f.vault, f.encryption, new Sanitizer()); await restarted.initialize();
    assert.equal(restarted.list().find(e => e.id === replacement.id)!.accountId, f.entry.accountId);
    await f.credentials.revoke(replacement.id); assert.equal((await f.connection.discover(replacement.id)).ok, false); assert.equal(calls, 2);
    const bytes = await readFile(path.join(f.directory, 'vault/credentials.vault')); assert.ok(!bytes.includes(Buffer.from(secret)));
    assert.deepEqual(await readdir(path.join(f.directory, 'records')), []); // No raw response or invented research history.
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('provider-projection admission withholds secret-bearing allowlisted fields and broken admission without raw fallback', async () => {
  const f = await fixture(new VastAdapter(request(async () => response(page([{ ...row(), label: secret }])))));
  try {
    const reply = await f.connection.discover(f.entry.id); assert.ok(!reply.ok); assert.equal(reply.error.reason, 'unsafe_response'); assert.ok(!JSON.stringify(reply).includes(secret));
    f.sanitizer.filter = () => { throw new Error(secret); };
    const broken = await f.connection.discover(f.entry.id); assert.ok(!broken.ok); assert.equal(broken.error.reason, 'unsafe_response');
    assert.throws(() => f.connection.choices());
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('session credential stays in memory, handles expiry separately, clears on parent revocation and is absent after restart', async () => {
  const used: string[] = []; let expired = false;
  const f = await fixture(new VastAdapter(request(async (_url, init) => {
    used.push((init.headers as Record<string, string>).Authorization);
    return expired ? response({}, 401) : response(page([]));
  })));
  try {
    await f.connection.setSession(f.entry.id, 'synthetic-vast-issued-session');
    assert.equal((await f.connection.discover(f.entry.id)).ok, true); assert.equal(used[0], 'Bearer synthetic-vast-issued-session');
    expired = true; const result = await f.connection.discover(f.entry.id);
    assert.ok(!result.ok); assert.equal(result.error.reason, 'session_expired');
    expired = false; await f.connection.discover(f.entry.id); assert.equal(used.at(-1), `Bearer ${secret}`);
    await f.connection.setSession(f.entry.id, 'synthetic-second-session');
    await f.connection.clearSession(f.entry.id); await f.credentials.revoke(f.entry.id);
    assert.equal((await f.connection.discover(f.entry.id)).ok, false);
    const vault = await f.encryption.decrypt(await readFile(path.join(f.directory, 'vault/credentials.vault')));
    assert.ok(!vault.includes('synthetic-vast-issued-session')); assert.ok(!vault.includes('synthetic-second-session'));
    const restarted = new CredentialService(f.vault, f.encryption, new Sanitizer()); await restarted.initialize();
    assert.ok(restarted.list().every(e => e.category !== 'vast_session'));
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('concurrent scans are bounded and revocation aborts in-flight authenticated discovery', async () => {
  let started!: () => void; const start = new Promise<void>(resolve => { started = resolve; });
  const f = await fixture(new VastAdapter(request(async (_url, init) => {
    started(); return new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new Error(secret)), { once: true }));
  }), noWait));
  try {
    const pending = f.connection.discover(f.entry.id); await start;
    assert.equal((await f.connection.discover(f.entry.id)).ok, false);
    await f.credentials.revoke(f.entry.id); const result = await pending;
    assert.ok(!result.ok); assert.equal(result.error.reason, 'authentication_required');
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('session discovery is synchronously fenced by parent revocation, exposure containment and rotation', async () => {
  for (const mode of ['revoke', 'incident', 'replace'] as const) {
    let started!: () => void, release!: () => void, signal: AbortSignal | undefined, calls = 0;
    const start = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const f = await fixture(new VastAdapter(request(async (_url, init) => {
      calls++; signal = init.signal!; started(); await gate;
      return response(page([row()], 'another-page'));
    }), noWait));
    try {
      await f.connection.setSession(f.entry.id, 'controlled-dependent-session40');
      const pending = f.connection.discover(f.entry.id); await start;
      const change = mode === 'revoke' ? f.credentials.revoke(f.entry.id) : mode === 'replace' ? f.credentials.replace(f.entry.id, 'controlled-replacement40') :
        f.recording.incident({ projectId: newId(), runId: newId(), actionId: newId(), operationId: newId() },
          { recordIds: [], sessionIds: [], credentialId: f.entry.id, reach: 'exposed', destinations: ['application'], reason: 'credential_exposure' });
      // Revocation propagates before asynchronous journal/vault writes finish.
      assert.equal(signal!.aborted, true);
      await change; release(); const reply = await pending;
      assert.ok(!reply.ok); assert.equal(reply.error.reason, 'authentication_required'); assert.equal(calls, 1);
      assert.equal((await f.connection.discover(f.entry.id)).ok, false);
      await assert.rejects(f.connection.setSession(f.entry.id, 'rejected-session40'));
    } finally { release(); await rm(f.directory, { recursive: true, force: true }); }
  }
});

test('revocation during the authenticated-result handoff withholds an already completed scan', async () => {
  const f = await fixture(new VastAdapter(request(async () => response(page([])))));
  try {
    await f.connection.setSession(f.entry.id, 'controlled-handoff-session40');
    const bind = f.credentials.bindAdapter.bind(f.credentials);
    f.credentials.bindAdapter = (binding, handler) => {
      const port = bind(binding, handler);
      return { execute: async scope => {
        const result = await port.execute(scope);
        await f.credentials.revoke(f.entry.id);
        return result;
      } };
    };
    const reply = await f.connection.discover(f.entry.id);
    assert.ok(!reply.ok); assert.equal(reply.error.reason, 'authentication_required');
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});
