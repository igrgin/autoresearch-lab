import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { spawn } from 'node:child_process';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { CredentialService } from '../src/security/credentials';
import { PrivateFiles } from '../src/security/private-files';
import { Sanitizer } from '../src/security/sanitizer';
import { newId } from '../src/security/common';
import { CodexHost } from '../src/codex/host';
import { CodexStore } from '../src/codex/store';
import { StdioAuthRpc } from '../src/codex/stdio';
import { CodexFailure } from '../src/codex/errors';
import { authenticateAndList, validateRuntimeConfig } from '../src/codex/catalog';
import { CODEX_VERSION, type AgentChoice, type CodexReply } from '../src/codex/contract';
const temporary: string[] = [];
after(async () => { for (const folder of temporary) await rm(folder, { recursive: true, force: true }); });
const secret = 'synthetic-codex-credential-45-+/Ω';
function unwrap<T>(reply: CodexReply<T>): T { assert.equal(reply.ok, true, JSON.stringify(reply)); if (!reply.ok) throw new Error(); return reply.value; }
async function fixture(mode = '') {
  let currentMode = mode;
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lab-codex-')); temporary.push(directory);
  const sanitizer = new Sanitizer(); const cryptKey = randomBytes(32);
  const encryption = { available: async () => true,
    encrypt: async (text: string) => { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', cryptKey, iv); const value = Buffer.concat([cipher.update(text), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), value]); },
    decrypt: async (bytes: Buffer) => { const cipher = createDecipheriv('aes-256-gcm', cryptKey, bytes.subarray(0, 12)); cipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString(); } };
  const credentials = new CredentialService(new PrivateFiles(path.join(directory, 'vault')), encryption, sanitizer);
  await credentials.initialize();
  const entry = await credentials.register('openai', newId(), 'Controlled OpenAI key', secret);
  let store = new CodexStore(directory); let starts = 0; let closes = 0;
  const processes: ReturnType<typeof spawn>[] = [];
  const host = new CodexHost({ credentials, matcher: sanitizer, initialize: () => credentials.initialize() }, async command => store.handle(command), async signal => {
    starts++;
    const child = spawn(process.execPath, [path.resolve('.webpack/tests/codex-fixture.cjs')], {
      env: { ELECTRON_RUN_AS_NODE: '1', CODEX_FIXTURE_MODE: currentMode }, stdio: 'pipe', detached: true,
    }); processes.push(child);
    const rpc = new StdioAuthRpc(child, signal);
    const close = rpc.close.bind(rpc); rpc.close = async () => { await close(); closes++; };
    return rpc;
  });
  return { mode: (mode: string) => { currentMode = mode; }, host, credentials, entry, sanitizer, directory, processes, get starts() { return starts; }, get closes() { return closes; },
    close: () => store.close(), restart: () => { store.close(); store = new CodexStore(directory); }, store: () => store };
}
test('authenticate via private RPC, paginate, save default and immutable run agent snapshots, restore without raw credentials', async () => {
  const f = await fixture();
  try {
    const catalog = unwrap(await f.host.execute(() => f.host.catalog(f.entry.id)));
    assert.deepEqual(catalog.models.map(model => model.model), ['fixture-first', 'fixture-second']);
    assert.equal(catalog.complete, true); assert.equal(catalog.entitlement, 'unverified'); assert.equal(catalog.runtimeVersion, CODEX_VERSION);
    const agent = unwrap(await f.host.execute(() => f.host.saveDefault({ model: 'fixture-second', effort: 'deep' })));
    const projectId = newId();
    const saved = unwrap(await f.host.execute(() => f.host.saveRunSelection(projectId, 0, { model: 'fixture-second', effort: 'deep' })));
    assert.equal(saved.agent.credentialRef, f.entry.id); assert.equal(saved.owner, 'run_configuration'); assert.equal(saved.projectId, projectId);
    f.restart();
    const restored = unwrap(await f.host.execute(() => f.host.runSelection(projectId))); assert.deepEqual(restored, saved);
    unwrap(await f.host.execute(() => f.host.saveDefault({ model: 'fixture-first', effort: 'brief' })));
    assert.deepEqual(unwrap(await f.host.execute(() => f.host.runSelection(projectId))), saved);
    const stale = await f.host.execute(() => f.host.saveRunSelection(projectId, 0, { model: 'fixture-first', effort: 'brief' }));
    assert.equal(stale.ok, false); if (!stale.ok) assert.equal(stale.error.code, 'conflict');
    const view = unwrap(await f.host.execute(() => f.host.settings()));
    assert.equal(view.settings.defaultAgent?.model, 'fixture-first'); assert.equal(view.diagnostics[0].code, 'authenticated');
    assert.ok(!JSON.stringify({ view, catalog, agent, saved, restored }).includes(secret));
    for (const name of ['codex-settings.sqlite', 'codex-settings.sqlite-wal', 'codex-settings.sqlite-shm']) {
      const bytes = await readFile(path.join(f.directory, name)).catch(error => { if (error.code === 'ENOENT') return Buffer.alloc(0); throw error; });
      assert.ok(!bytes.includes(Buffer.from(secret)));
    }
    assert.equal(f.starts, f.closes); assert.ok(f.processes.every(child => child.signalCode === 'SIGKILL' || child.exitCode !== null));
  } finally { f.close(); }
  for (const name of await readdir(f.directory)) {
    const filename = path.join(f.directory, name);
    if (name.endsWith('.sqlite') || name.endsWith('-wal') || name.endsWith('-shm')) assert.ok(!(await readFile(filename)).includes(Buffer.from(secret)));
  }
});
test('invalid identifiers, unavailable model and unsupported effort have specific failures without replacing the saved model', async () => {
  const f = await fixture();
  try {
    unwrap(await f.host.execute(() => f.host.catalog(f.entry.id)));
    const saved = unwrap(await f.host.execute(() => f.host.saveDefault({ model: 'fixture-first', effort: 'brief' })));
    for (const [choice, code] of [[{ model: 'not in catalog?', effort: 'brief' }, 'invalid_input'], [{ model: 'missing-model', effort: 'brief' }, 'model_unavailable'], [{ model: 'fixture-first', effort: 'unsupported' }, 'invalid_input']] as const) {
      const reply = await f.host.execute(() => f.host.saveDefault(choice)); assert.equal(reply.ok, false); if (!reply.ok) assert.equal(reply.error.code, code);
    }
    assert.deepEqual(unwrap(await f.host.execute(() => f.host.settings())).settings.defaultAgent, saved);
  } finally { f.close(); }
});
for (const [mode, code] of [['unauthorized', 'permission_denied'], ['quota', 'rate_limited'], ['logged-out', 'authentication_required'],
  ['malformed', 'incompatible_version'], ['oversized', 'incompatible_version'], ['secret-model', 'capture_failed'], ['cursor-loop', 'incompatible_version'], ['unsafe-storage', 'configuration_rejected'], ['inherited-config', 'configuration_rejected']] as const) {
  test(`private ${mode} failure is explicit, bounded, leaves no partial catalog or synthetic secret in diagnostics`, async () => {
    const f = await fixture(mode);
    try {
      const reply = await f.host.execute(() => f.host.catalog(f.entry.id)); assert.equal(reply.ok, false); if (!reply.ok) assert.equal(reply.error.code, code);
      const view = unwrap(await f.host.execute(() => f.host.settings()));
      assert.equal(view.settings.credentialRef, null); assert.equal(view.diagnostics[0].code, code);
      if (!reply.ok) assert.equal(view.diagnostics[0].operationId, reply.error.operationId);
      assert.ok(!JSON.stringify({ reply, view }).includes(secret)); assert.equal(f.starts, f.closes);
    } finally { f.close(); }
  });
}
test('revoked, wrong category and unknown references cannot launch authentication; no host credential fallback', async () => {
  const f = await fixture();
  try {
    const other = await f.credentials.register('runpod', newId(), 'Synthetic provider', 'synthetic-provider-value');
    for (const reference of [other.id, newId()]) assert.equal((await f.host.execute(() => f.host.catalog(reference))).ok, false);
    await f.credentials.revoke(f.entry.id);
    const reply = await f.host.execute(() => f.host.catalog(f.entry.id)); assert.equal(reply.ok, false);
    assert.equal(f.starts, 0);
  } finally { f.close(); }
});
test('revocation terminates an in-flight authenticated process and refuses the result', async () => {
  const f = await fixture('hung');
  try {
    const running = f.host.execute(() => f.host.catalog(f.entry.id));
    // Wait for fixture bootstrap rather than relying on timing or a real service.
    while (!f.processes.length) await new Promise<void>(resolve => setImmediate(resolve));
    await f.credentials.revoke(f.entry.id);
    const reply = await running; assert.equal(reply.ok, false); if (!reply.ok) assert.equal(reply.error.code, 'authentication_required');
    assert.equal(f.starts, f.closes);
  } finally { f.close(); }
});
test('catalog refresh after auth change preserves previous explicit choices and run snapshots', async () => {
  const f = await fixture();
  try {
    unwrap(await f.host.execute(() => f.host.catalog(f.entry.id)));
    const saved = unwrap(await f.host.execute(() => f.host.saveDefault({ model: 'fixture-first', effort: 'brief' })));
    const replacement = await f.credentials.replace(f.entry.id, 'synthetic-replacement-key-45');
    unwrap(await f.host.execute(() => f.host.catalog(replacement.id)));
    const view = unwrap(await f.host.execute(() => f.host.settings()));
    assert.equal(view.settings.credentialRef, replacement.id); assert.deepEqual(view.settings.defaultAgent, saved);
  } finally { f.close(); }
});
test('bundled official runtime hash/protocol qualifies in isolated state without authentication or inference', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lab-codex-real-')); temporary.push(directory);
  const executable = path.resolve('node_modules/@openai/codex-runtime/vendor/aarch64-apple-darwin/bin/codex');
  const rpc = await StdioAuthRpc.start(executable, directory, new AbortController().signal);
  try {
    await rpc.request('initialize', { clientInfo: { name: 'autoresearch_lab', version: '0.1.0' } }); rpc.notifyInitialized();
    validateRuntimeConfig(await rpc.request('config/read', { includeLayers: true }));
    const account = await rpc.request('account/read', { refreshToken: false }) as { account: unknown };
    assert.equal(account.account, null);
    await assert.rejects(rpc.request('turn/start' as 'model/list', {}), CodexFailure);
  } finally { await rpc.close(); }
  assert.ok(!(await readdir(path.join(directory, 'state'))).includes('auth.json'));
  await assert.rejects(StdioAuthRpc.start(process.execPath, directory, new AbortController().signal), { code: 'incompatible_version' });
});
test('no account confirmation means authentication_required, not entitled access', async () => {
  const sanitizer = new Sanitizer();
  const rpc = { request: async (method: string) => method === 'config/read' ? { config: { cli_auth_credentials_store: 'ephemeral', model_provider: 'openai', forced_login_method: 'api' }, layers: [] } : method === 'account/login/start' ? { type: 'apiKey' } : method === 'account/read' ? { account: null } : {}, notifyInitialized() {}, async close() {} };
  await assert.rejects(authenticateAndList(rpc, secret, sanitizer), { code: 'authentication_required' });
});
test('store refuses credential values and unknown payload fields in selection records', async () => {
  const f = await fixture();
  try {
    unwrap(await f.host.execute(() => f.host.catalog(f.entry.id)));
    const agent = unwrap(await f.host.execute(() => f.host.saveDefault({ model: 'fixture-first', effort: 'brief' })));
    assert.throws(() => f.store().handle({ kind: 'default', agent: { ...agent, apiKey: secret } as AgentChoice }), { code: 'invalid_input' });
  } finally { f.close(); }
});

test('restored semantic metadata is rechecked against newly known credentials before UI disclosure', async () => {
  const f = await fixture();
  try {
    unwrap(await f.host.execute(() => f.host.catalog(f.entry.id)));
    unwrap(await f.host.execute(() => f.host.saveDefault({ model: 'fixture-first', effort: 'brief' })));
    const projectId = newId();
    unwrap(await f.host.execute(() => f.host.saveRunSelection(projectId, 0, { model: 'fixture-first', effort: 'brief' })));
    await f.credentials.register('openai', newId(), 'Later discovered credential', 'fixture-first');
    for (const reply of [await f.host.execute(() => f.host.settings()), await f.host.execute(() => f.host.runSelection(projectId))]) {
      assert.equal(reply.ok, false); if (!reply.ok) assert.equal(reply.error.code, 'capture_failed');
      assert.ok(!JSON.stringify(reply).includes('fixture-first'));
    }
  } finally { f.close(); }
});

test('a previously selected model removed from refreshed catalog fails specifically and keeps the saved choice', async () => {
  const f = await fixture();
  try {
    unwrap(await f.host.execute(() => f.host.catalog(f.entry.id)));
    const saved = unwrap(await f.host.execute(() => f.host.saveDefault({ model: 'fixture-second', effort: 'deep' })));
    f.mode('removed');
    const reply = await f.host.execute(() => f.host.saveDefault({ model: 'fixture-second', effort: 'deep' }));
    assert.equal(reply.ok, false); if (!reply.ok) assert.equal(reply.error.code, 'model_unavailable');
    assert.deepEqual(unwrap(await f.host.execute(() => f.host.settings())).settings.defaultAgent, saved);
  } finally { f.close(); }
});

test('metadata uses full shared admission including unsupported encoding and unavailable filters', async () => {
  const { safeMetadata } = await import('../src/codex/catalog');
  const matcher = new Sanitizer();
  assert.throws(() => safeMetadata('broken-\ud800', matcher), { code: 'capture_failed' });
  matcher.filter = () => { throw new Error(secret); };
  assert.throws(() => safeMetadata('fixture-model', matcher), error => error instanceof CodexFailure && error.code === 'capture_failed' && !String(error).includes(secret));
});
