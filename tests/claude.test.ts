import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { CredentialService } from '../src/security/credentials';
import { PrivateFiles } from '../src/security/private-files';
import { Sanitizer } from '../src/security/sanitizer';
import { SafeRecording } from '../src/security/recording';
import { newId } from '../src/security/common';
import { ClaudeHost, ClaudeWorker } from '../src/claude/host';
import { ClaudeSelectionStore } from '../src/claude/store';
import { CATALOG_MAX_AGE_MS, CLAUDE_CODE_VERSION, ClaudeChoice, ClaudeFailure } from '../src/claude/contracts';
import { intersectModels, readModels } from '../src/claude/discovery';
import { qualifyMessages } from '../src/claude/qualification';
import { sdkOptions, sandboxProfile } from '../src/claude/runtime';

const temporary: string[] = [];
after(async () => { for (const dir of temporary) await rm(dir, { recursive: true, force: true }); });
const modelId = 'claude-fixture-20261101';
const otherId = 'claude-fixture-20261001';
const secret = 'synthetic-anthropic-key-50-+/"Ω';
const row = (id = modelId) => ({ id, lifecycle: 'active' as const });
const sdk = [{ value: 'fixture', resolvedModel: modelId, displayName: secret }];
const response = (data: unknown[], has_more = false, last_id: string | null = null) => new Response(JSON.stringify({ data, has_more, last_id }));
function request(fn: (url: URL, options: RequestInit) => Promise<Response>): typeof fetch {
  return ((url: URL, options: RequestInit) => fn(url, options)) as typeof fetch;
}
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lab-claude-test-')); temporary.push(directory);
  const matcher = new Sanitizer(); const cipherKey = randomBytes(32);
  const credentials = new CredentialService(new PrivateFiles(path.join(directory, 'vault')), {
    available: async () => true,
    encrypt: async value => { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', cipherKey, iv);
      return Buffer.concat([iv, cipher.update(value), cipher.final(), cipher.getAuthTag()]); },
    decrypt: async value => { const decipher = createDecipheriv('aes-256-gcm', cipherKey, value.subarray(0, 12));
      decipher.setAuthTag(value.subarray(-16)); return Buffer.concat([decipher.update(value.subarray(12, -16)), decipher.final()]).toString(); },
  }, matcher);
  await credentials.initialize();
  const entry = await credentials.register('anthropic', newId(), 'Synthetic Claude', secret);
  const recording = new SafeRecording(new PrivateFiles(path.join(directory, 'records')), matcher, id => credentials.revoke(id)); await recording.initialize();
  let store = new ClaudeSelectionStore(directory); let now = Date.now();
  const projectId = newId(); let calls = 0;
  let worker: ClaudeWorker = async input => {
    calls++; assert.equal(input.key, secret);
    return input.kind === 'discover' ? { catalog: intersectModels([row(), row(otherId)], [...sdk, { value: otherId, resolvedModel: otherId }], entry.id, now) } : { qualified: true };
  };
  const buildHost = () => new ClaudeHost(credentials, recording, async () => {}, (input, signal) => worker(input, signal), async command => store.handle(command), async id => id === projectId, () => now);
  const host = buildHost();
  const choice: ClaudeChoice = { integration: 'claude', credentialId: entry.id, modelId };
  return { directory, credentials, recording, entry, choice, host, projectId, buildHost,
    restart: () => { store.close(); store = new ClaudeSelectionStore(directory); return buildHost(); },
    close: () => store.close(), advance: () => { now += CATALOG_MAX_AGE_MS + 1; }, setWorker: (next: ClaudeWorker) => { worker = next; }, calls: () => calls };
}

test('authenticated pagination follows fixed origin/cursor; intersection resolves aliases and drops unsupported, unresolved and retired rows', async () => {
  const calls: URL[] = [];
  const api = await readModels(secret, new AbortController().signal, request(async (url, options) => {
    calls.push(url); assert.equal(url.origin, 'https://api.anthropic.com'); assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit'); assert.equal((options.headers as Record<string, string>)['x-api-key'], secret);
    return calls.length === 1 ? response([row(otherId)], true, otherId) : response([row(), { id: 'claude-retired-1', lifecycle: 'retired' }]);
  }));
  assert.equal(calls[1].searchParams.get('after_id'), otherId);
  const catalog = intersectModels(api, [...sdk, { value: otherId }], newId());
  assert.deepEqual(catalog.models, [row()]); assert.ok(!JSON.stringify(catalog).includes(secret));
});

test('auth, permission, malformed, oversized, incomplete, duplicate and failed page errors publish no partial catalog or vendor error', async () => {
  for (const [status, reason] of [[401, 'authentication_required'], [403, 'unauthorized_model'], [429, 'unavailable'], [500, 'unavailable']] as const) {
    await assert.rejects(readModels(secret, new AbortController().signal, request(async () => new Response(secret, { status }))), { reason });
  }
  for (const make of [() => response([row()], true, 'invalid-cursor'), () => response([row(), row()]),
    () => new Response(secret), () => new Response('x'.repeat(512_001)), () => response([{ id: secret }])]) {
    await assert.rejects(readModels(secret, new AbortController().signal, request(async () => make())), error => error instanceof ClaudeFailure && !String(error).includes(secret));
  }
  let pages = 0;
  await assert.rejects(readModels(secret, new AbortController().signal, request(async () => ++pages === 1 ? response([row()], true, modelId) : new Response(secret, { status: 503 }))), { reason: 'unavailable' });
  assert.equal(pages, 2);
});

test('settings and immutable run agent input restore after store/host restart, contain references only and ignore later default changes', async () => {
  const f = await fixture();
  try {
    await f.host.discover(f.entry.id); const saved = await f.host.save(f.choice, 0);
    const input = { projectId: f.projectId, runId: newId(), snapshotId: newId(), choice: f.choice };
    const snapshot = await f.host.saveRun(input);
    assert.equal(snapshot.owner, 'run_configuration');
    assert.deepEqual(await f.host.saveRun(input), snapshot);
    await assert.rejects(f.host.saveRun({ ...input, choice: { ...f.choice, modelId: otherId } }), { reason: 'conflict' });
    await f.host.save({ ...f.choice, modelId: otherId }, saved.revision);
    const restarted = f.restart();
    assert.equal((await restarted.settings()).selection?.modelId, otherId);
    assert.deepEqual(await restarted.runs(f.projectId), [snapshot]);
    await assert.rejects(restarted.save(f.choice, 2), { reason: 'stale_catalog' });
    assert.equal(f.calls(), 1);
    for (const name of await readdir(f.directory)) {
      if (name.startsWith('agent-settings.sqlite')) assert.ok(!(await readFile(path.join(f.directory, name))).includes(Buffer.from(secret)));
    }
    for (const name of await readdir(path.join(f.directory, 'records'))) {
      const bytes = await readFile(path.join(f.directory, 'records', name), 'utf8');
      for (const variant of [secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret)]) assert.ok(!bytes.includes(variant));
    }
  } finally { f.close(); }
});

test('invalid, unavailable, expired, conflicting and rotated selections fail specifically without fallback or overwriting settings', async () => {
  const f = await fixture();
  try {
    await f.host.discover(f.entry.id); const saved = await f.host.save(f.choice, 0);
    await assert.rejects(f.host.save({ ...f.choice, modelId: 'sonnet' }, 1), { reason: 'invalid_model' });
    await assert.rejects(f.host.save({ ...f.choice, modelId: 'claude-missing-1' }, 1), { reason: 'unavailable_model' });
    await assert.rejects(f.host.save(f.choice, 0), { reason: 'conflict' });
    await assert.rejects(f.host.saveRun({ projectId: newId(), runId: newId(), snapshotId: newId(), choice: f.choice }), { reason: 'invalid_input' });
    f.advance(); await assert.rejects(f.host.qualify(f.choice), { reason: 'stale_catalog' });
    await f.host.discover(f.entry.id);
    await f.credentials.replace(f.entry.id, 'synthetic-replaced-key-50');
    await assert.rejects(f.host.qualify(f.choice), { reason: 'authentication_required' });
    assert.deepEqual((await f.host.settings()).selection, saved);
  } finally { f.close(); }
});

test('failed refresh invalidates cached entitlement; safe diagnostics preserve denied reason and exclude raw worker errors', async () => {
  const f = await fixture();
  try {
    await f.host.discover(f.entry.id); await f.host.save(f.choice, 0);
    f.setWorker(async () => ({ reason: 'unauthorized_model' }));
    const reply = await f.host.reply(() => f.host.discover(f.entry.id));
    assert.equal(reply.ok, false); if (!reply.ok) { assert.equal(reply.error.code, 'permission_denied'); assert.equal(reply.error.reason, 'unauthorized_model'); }
    await assert.rejects(f.host.save(f.choice, 1), { reason: 'stale_catalog' });
    f.setWorker(async () => { throw new Error(secret); });
    assert.ok(!JSON.stringify(await f.host.reply(() => f.host.discover(f.entry.id))).includes(secret));
  } finally { f.close(); }
});

test('revocation aborts in-flight credential-bearing worker and cannot publish its late catalog', async () => {
  const f = await fixture();
  try {
    let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; }); let aborted = false;
    f.setWorker(async (_input, signal) => new Promise(resolve => { started(); signal.addEventListener('abort', () => { aborted = true; resolve({ qualified: true }); }); }));
    const running = f.host.reply(() => f.host.discover(f.entry.id)); await ready;
    await f.credentials.revoke(f.entry.id); const reply = await running;
    assert.equal(aborted, true); assert.equal(reply.ok, false);
  } finally { f.close(); }
});

test('a late older refresh cannot republish access evidence after a newer failed refresh', async () => {
  const f = await fixture();
  try {
    let release!: () => void; let started!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }); const ready = new Promise<void>(resolve => { started = resolve; });
    let call = 0;
    f.setWorker(async () => {
      if (++call === 2) return { reason: 'unavailable' };
      started(); await gate;
      return { catalog: intersectModels([row()], sdk, f.entry.id) };
    });
    const earlier = f.host.reply(() => f.host.discover(f.entry.id)); await ready;
    await assert.rejects(f.host.discover(f.entry.id), { reason: 'unavailable' });
    release(); assert.equal((await earlier).ok, false);
    await assert.rejects(f.host.save(f.choice, 0), { reason: 'stale_catalog' });
  } finally { f.close(); }
});

const init = () => ({ type: 'system', subtype: 'init', model: modelId, tools: ['StructuredOutput'], apiKeySource: 'ANTHROPIC_API_KEY',
  claude_code_version: CLAUDE_CODE_VERSION, permissionMode: 'dontAsk', mcp_servers: [], skills: [], plugins: [], agents: [] });
const success = () => ({ type: 'result', subtype: 'success', is_error: false, structured_output: { status: 'ok' }, modelUsage: { [modelId]: {} } });
async function* messages(items: unknown[]) { yield* items; }
test('bounded qualification requires pinned initialization, exact observed model, successful schema result and no unexpected tools', async () => {
  await qualifyMessages(messages([init(), success()]), modelId);
  for (const items of [[], [success()], [init()], [init(), { ...success(), subtype: 'error_max_budget_usd' }],
    [init(), { ...success(), structured_output: { status: 'ok', extra: secret } }], [init(), { ...success(), is_error: true }]]) {
    await assert.rejects(qualifyMessages(messages(items), modelId), { reason: 'qualification_failed' });
  }
  for (const items of [[{ ...init(), model: otherId }, success()], [init(), { ...success(), modelUsage: { [otherId]: {} } }],
    [init(), { type: 'assistant', message: { model: otherId } }, success()]]) {
    await assert.rejects(qualifyMessages(messages(items), modelId), { reason: 'model_mismatch' });
  }
  for (const patch of [{ tools: ['Bash'] }, { apiKeySource: 'none' }, { plugins: [{ name: 'host' }] }, { skills: ['host'] },
    { mcp_servers: [{ name: 'host' }] }, { agents: ['host'] }, { permissionMode: 'bypassPermissions' }, { claude_code_version: 'other' }]) {
    await assert.rejects(qualifyMessages(messages([{ ...init(), ...patch }, success()]), modelId), { reason: 'unsupported_capability' });
  }
  for (const [error, reason] of [['authentication_failed', 'authentication_required'], ['model_not_found', 'unavailable_model'], ['billing_error', 'unauthorized_model']]) {
    await assert.rejects(qualifyMessages(messages([init(), { type: 'assistant', error }, success()]), modelId), { reason });
  }
});

test('SDK options disable native persistence, host configuration, tools and fallback; environment and sandbox exclude host access', () => {
  const options = sdkOptions('/private/fixture', '/app/claude', secret, new AbortController(), modelId, () => {});
  assert.equal(options.model, modelId); assert.equal(options.fallbackModel, undefined); assert.equal(options.persistSession, false);
  assert.deepEqual(options.tools, []); assert.deepEqual(options.settingSources, []); assert.equal(options.strictMcpConfig, true);
  assert.equal(options.permissionMode, 'dontAsk'); assert.equal(options.env?.ANTHROPIC_API_KEY, secret);
  for (const key of ['CLAUDE_CODE_OAUTH_TOKEN', 'OPENAI_API_KEY', 'AWS_ACCESS_KEY_ID', 'SSH_AUTH_SOCK', 'HTTP_PROXY', 'NODE_OPTIONS']) assert.equal(options.env?.[key], undefined);
  assert.ok(Number.isFinite(options.maxTurns)); assert.ok(Number.isFinite(options.maxBudgetUsd));
  const profile = sandboxProfile('/private/fixture', '/app/claude');
  assert.ok(profile.includes('(deny default)')); assert.ok(!profile.includes('(allow process-exec)')); assert.ok(!profile.includes('/Users/'));
});
