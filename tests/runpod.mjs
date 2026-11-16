import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
const { Response, AbortSignal, setTimeout, clearTimeout } = globalThis;

// Controlled REST-v2 fixtures; no account, key, Pod or GPU is accessed.
export function runpodTests({ require, build, fixture, newId, secret }) {
  const { RunpodAdapter } = require(path.join(build, 'src/providers/runpod.js'));
  const pod = (id = 'pod_1', fields = {}) => ({ id, name: 'Unretained name', status: 'RUNNING', gpu: {
    id: 'NVIDIA GeForce RTX 4090', count: 2, memory: 64, vcpuCount: 16 }, cudaVersion: null,
    env: { RUNPOD_API_KEY: secret }, args: secret, registry: { password: secret }, ...fields });
  const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
  const page = (pods, cursor = null) => ({ pods, pagination: { nextCursor: cursor, hasNextPage: cursor !== null } });
  const setup = async handler => {
    const f = await fixture(); const calls = [];
    const adapter = new RunpodAdapter(f.credentials, f.sanitizer, async (url, options) => {
      calls.push({ url, options });
      assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
      assert.ok(url.startsWith('https://api.runpod.io/v2/'));
      return handler(url, options, calls.length);
    });
    return { ...f, adapter, calls };
  };
  test('Runpod connects through scoped credentials, reads every cursor page, filters RUNNING GPU Pods, and projects safe capabilities', async () => {
    const f = await setup(url => url.endsWith('/account') ? json({ id: 'acct_1', email: secret }) :
      url.includes('?cursor=') ? json(page([pod('pod_2')])) : json(page([pod(), pod('cpu', { gpu: undefined }), pod('stopped', { status: 'EXITED' })], 'next+/=&')));
    const result = JSON.parse(JSON.stringify(await f.adapter.discover(f.entry.id)));
    assert.equal(result.complete, true); assert.equal(result.pages, 2); assert.equal(result.accountId, 'acct_1');
    assert.deepEqual(result.items.map(item => item.identity), [{ provider: 'runpod', resourceId: 'pod_1' }, { provider: 'runpod', resourceId: 'pod_2' }]);
    assert.equal(f.calls[0].options.headers.Authorization, `Bearer ${secret}`);
    assert.equal(f.calls[2].url, 'https://api.runpod.io/v2/pods?cursor=next%2B%2F%3D%26');
    const item = result.items[0];
    assert.deepEqual(item.allocation, { gpuType: 'NVIDIA GeForce RTX 4090', gpuCount: 2, systemRamGb: 64, vcpuCount: 16 });
    assert.equal(item.cudaVersion, null); assert.ok(item.capabilities.every(cap => cap.availability === 'unknown'));
    assert.equal(item.capabilities[0].reason, 'not_inspected');
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes(secret));
    for (const field of ['env', 'registry', 'args', 'email', 'name', 'ssh', 'runtime']) assert.ok(!Object.hasOwn(item, field));
  });
  test('Runpod Pod identity survives credential aliases, replacement and service restart', async () => {
    const f = await setup(url => json(url.endsWith('/account') ? { id: 'account_alias' } : page([pod()])));
    const first = await f.adapter.discover(f.entry.id);
    const alias = await f.credentials.register('runpod', newId(), 'Other account label', 'synthetic-alias-key');
    const second = await f.adapter.discover(alias.id);
    const replaced = await f.credentials.replace(alias.id, 'synthetic-replacement-key');
    await f.credentials.initialize();
    const third = await f.adapter.discover(replaced.id);
    assert.deepEqual(first.items[0].identity, second.items[0].identity);
    assert.deepEqual(first.items[0].identity, third.items[0].identity);
    assert.equal((await f.adapter.discover(alias.id)).error.code, 'authentication_required');
  });
  test('Runpod complete empty is distinct from partial failure, cursor loops, malformed and duplicate pages', async () => {
    const empty = await setup(url => json(url.endsWith('/account') ? { id: 'acct' } : page([])));
    const result = await empty.adapter.discover(empty.entry.id);
    assert.equal(result.complete, true); assert.deepEqual(result.items, []); assert.equal(result.error, undefined);
    for (const next of [() => new Response(secret, { status: 403 }), () => json(page([pod()], 'loop')),
      () => json({ pods: [], pagination: { hasNextPage: true, nextCursor: null } }), () => json(page([pod()]))]) {
      const f = await setup(url => url.endsWith('/account') ? json({ id: 'acct' }) : url.includes('?') ? next() : json(page([pod()], 'loop')));
      const partial = await f.adapter.discover(f.entry.id);
      assert.equal(partial.complete, false); assert.equal(partial.items.length, 1); assert.ok(partial.error);
      assert.ok(!JSON.stringify(partial).includes(secret));
    }
  });
  test('Runpod reads expose specific safe HTTP failures without vendor bodies, retrying only transient reads', async () => {
    for (const [status, code, calls] of [[401, 'authentication_required', 1], [403, 'permission_denied', 1],
      [404, 'not_found', 1], [429, 'rate_limited', 1], [503, 'unavailable', 2], [302, 'unavailable', 2]]) {
      const f = await setup(() => new Response(secret, { status, headers: { 'retry-after': '60' } }));
      const result = await f.adapter.discover(f.entry.id);
      assert.equal(result.error.code, code); assert.equal(result.complete, false); assert.equal(result.pages, 0);
      assert.equal(f.calls.length, calls); assert.equal(result.error.effect, 'none');
      assert.ok(!JSON.stringify(result).includes(secret));
      if (status === 429) {
        assert.ok(Date.parse(result.error.retryAt) > Date.now() + 50_000);
        await f.adapter.discover(f.entry.id); assert.equal(f.calls.length, 1);
      }
    }
    let attempt = 0;
    const recovered = await setup(url => ++attempt === 1 ? new Response('', { status: 503 }) : json(url.endsWith('/account') ? { id: 'acct' } : page([])));
    assert.equal((await recovered.adapter.discover(recovered.entry.id)).complete, true);
    const exhausted = await setup(() => new Response(JSON.stringify({ id: 'acct' }), {
      headers: { 'content-type': 'application/json', ratelimit: '"minute";r=0;t=12, "hour";r=9;t=1800' } }));
    const quota = await exhausted.adapter.discover(exhausted.entry.id);
    assert.equal(quota.error.code, 'rate_limited'); assert.equal(exhausted.calls.length, 1);
    assert.ok(Date.parse(quota.error.retryAt) > Date.now() + 10_000);
  });
  test('Runpod denies wrong/unknown/revoked credentials and in-flight revocation before publication', async () => {
    const f = await setup(() => { throw new Error('Must not call provider'); });
    const other = await f.credentials.register('openai', newId(), 'Other provider', 'synthetic-openai-key');
    for (const id of [newId(), other.id, '../../etc/passwd']) assert.equal((await f.adapter.discover(id)).complete, false);
    await f.credentials.revoke(f.entry.id);
    assert.equal((await f.adapter.discover(f.entry.id)).error.code, 'authentication_required'); assert.equal(f.calls.length, 0);
    let release, entered;
    const started = new Promise(resolve => { entered = resolve; });
    const pending = new Promise(resolve => { release = resolve; });
    const g = await setup(async () => { entered(); await pending; return json({ id: 'acct' }); });
    const discovery = g.adapter.discover(g.entry.id); await started;
    await g.credentials.revoke(g.entry.id); release();
    const revoked = await discovery;
    assert.equal(revoked.complete, false); assert.deepEqual(revoked.items, []); assert.equal(revoked.accountId, null);
  });
  test('Runpod excludes unsafe semantic fields, malformed schemas, oversized bodies and network errors', async () => {
    for (const response of [() => json(page([pod(secret)])), () => json(page([pod('pod', { gpu: { id: secret, count: 1 } })])),
      () => json(page([pod('pod', { gpu: { id: 'GPU', count: -1 } })])), () => json({ pods: [] }),
      () => new Response('invalid ' + secret, { headers: { 'content-type': 'application/json' } }),
      () => json('x'.repeat(4 * 1024 * 1024 + 1)), () => { throw new Error(secret); }]) {
      const f = await setup(url => url.endsWith('/account') ? json({ id: 'acct' }) : response());
      const result = await f.adapter.discover(f.entry.id);
      assert.equal(result.complete, false); assert.ok(result.error); assert.ok(!JSON.stringify(result).includes(secret));
    }
  });
  test('Runpod detail revalidates account/Pod and keeps endpoint metadata separate from actual readiness', async () => {
    const f = await setup(url => json(url.endsWith('/account') ? { id: 'acct' } : pod('pod_1', {
      status: 'EXITED', ssh: { direct: { host: secret, command: secret } }, runtime: { gpus: [{ util: 50 }] } })));
    const detail = await f.adapter.inspect(f.entry.id, 'pod_1');
    assert.equal(detail.ok, true); assert.equal(detail.instance.reportedState, 'EXITED');
    assert.equal(detail.instance.capabilities[0].reason, 'endpoint_reported_unverified');
    assert.ok(detail.instance.capabilities.every(cap => cap.availability === 'unknown'));
    assert.ok(!JSON.stringify(detail).includes(secret));
    const before = f.calls.length;
    assert.equal((await f.adapter.inspect(f.entry.id, '../start')).ok, false); assert.equal(f.calls.length, before);
    const mismatch = await setup(url => json(url.endsWith('/account') ? { id: 'acct' } : pod('wrong')));
    assert.equal((await mismatch.adapter.inspect(mismatch.entry.id, 'pod_1')).error.code, 'invalid_response');
  });
  test('Runpod deadlines and failed sanitizer never publish unsafe projections', async () => {
    const originalTimeout = AbortSignal.timeout;
    AbortSignal.timeout = () => originalTimeout(5);
    try {
      const f = await setup((_url, options) => new Promise((_resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(secret)), 1000);
        options.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error(secret)); }, { once: true });
      }));
      assert.equal((await f.adapter.discover(f.entry.id)).error.code, 'deadline_exceeded');
    } finally { AbortSignal.timeout = originalTimeout; }
    const f = await setup(() => json({ id: 'acct' }));
    f.sanitizer.filter = () => { throw new Error(secret); };
    const result = await f.adapter.discover(f.entry.id);
    assert.equal(result.complete, false); assert.equal(result.error.code, 'capture_failed');
    assert.deepEqual(result.items, []); assert.ok(!JSON.stringify(result).includes(secret));
  });
}
