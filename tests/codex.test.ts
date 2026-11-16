import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { spawn } from 'node:child_process';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { copyFile, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { CredentialService } from '../src/security/credentials';
import { PrivateFiles } from '../src/security/private-files';
import { Sanitizer } from '../src/security/sanitizer';
import { SafeRecording } from '../src/security/recording';
import { newId } from '../src/security/common';
import { CodexHost } from '../src/codex/host';
import Database from 'better-sqlite3';
import { openStore } from '../src/catalog/storage';
import { CodexStoreClient } from '../src/codex/store-client';
import { admitCodexValue } from '../src/codex/admission';
import { CodexStore, CODEX_SCHEMA_V1 } from '../src/codex/store';
import { StdioAuthRpc } from '../src/codex/stdio';
import { CodexFailure } from '../src/codex/errors';
import { authenticateAndList, validateRuntimeConfig } from '../src/codex/catalog';
import { CODEX_VERSION, type AgentChoice, type AgentSnapshot, type CodexReply, type CodexStoreCommand, type CodexStoreValue } from '../src/codex/contract';
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
  const recording = new SafeRecording(new PrivateFiles(path.join(directory, 'records')), sanitizer, id => credentials.revoke(id));
  await recording.initialize();
  const entry = await credentials.register('openai', newId(), 'Controlled OpenAI key', secret);
  let store = new CodexStore(directory); let starts = 0; let closes = 0;
  const processes: ReturnType<typeof spawn>[] = [];
  let storeHook: ((command: CodexStoreCommand, run: () => CodexStoreValue) => Promise<CodexStoreValue>) | undefined;
  let rpcHook: ((rpc: StdioAuthRpc) => void) | undefined;
  const host = new CodexHost({ credentials, recording, matcher: sanitizer, initialize: () => credentials.initialize() }, async command => storeHook ? storeHook(command, () => store.handle(command)) : store.handle(command), async signal => {
    starts++;
    const child = spawn(process.execPath, [path.resolve('.webpack/tests/codex-fixture.cjs')], {
      env: { ELECTRON_RUN_AS_NODE: '1', CODEX_FIXTURE_MODE: currentMode }, stdio: 'pipe', detached: true,
    }); processes.push(child);
    const rpc = new StdioAuthRpc(child, signal);
    const close = rpc.close.bind(rpc); rpc.close = async () => { await close(); closes++; };
    rpcHook?.(rpc); return rpc;
  });
  return { hookStore: (hook: typeof storeHook) => { storeHook = hook; }, hookRpc: (hook: typeof rpcHook) => { rpcHook = hook; }, mode: (mode: string) => { currentMode = mode; }, host, credentials, recording, entry, sanitizer, directory, processes, get starts() { return starts; }, get closes() { return closes; },
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
    assert.throws(() => f.store().handle({ kind: 'default', requestId: newId(), choice: { model: agent.model, effort: agent.effort }, agent: { ...agent, apiKey: secret } as AgentChoice }), { code: 'invalid_input' });
  } finally { f.close(); }
});

test('restored semantic metadata is rechecked against newly known credentials before UI disclosure', async () => {
  const f = await fixture();
  try {
    unwrap(await f.host.execute(() => f.host.catalog(f.entry.id)));
    unwrap(await f.host.execute(() => f.host.saveDefault({ model: 'fixture-first', effort: 'brief' })));
    const projectId = newId();
    const saved = unwrap(await f.host.execute(() => f.host.saveRunSelection(projectId, 0, { model: 'fixture-first', effort: 'brief' })));
    const exposed = await f.credentials.register('openai', newId(), 'Later discovered credential', 'fixture-first');
    for (const reply of [await f.host.execute(() => f.host.settings()), await f.host.execute(() => f.host.runSelection(projectId))]) {
      assert.equal(reply.ok, false); if (!reply.ok) assert.equal(reply.error.code, 'capture_failed');
      assert.ok(!JSON.stringify(reply).includes('fixture-first'));
    }
    assert.equal(f.credentials.list().find(entry => entry.id === exposed.id)!.status, 'revoked');
    const starts = f.starts;
    const denied = await f.host.execute(() => f.host.catalog(exposed.id));
    assert.equal(denied.ok, false); if (!denied.ok) assert.equal(denied.error.code, 'authentication_required');
    assert.equal(f.starts, starts);
    const state = await readFile(path.join(f.directory, 'records', 'security-state.json'), 'utf8');
    assert.ok(state.includes(exposed.id)); assert.ok(state.includes(saved.snapshotId));
    assert.equal(state.includes('fixture-first'), false);
    // Reopening storage and removing remediated matching material does not
    // unquarantine the original immutable selection or default version.
    f.restart(); await f.credentials.finishRemediation(exposed.id); await f.recording.initialize();
    for (const reply of [await f.host.execute(() => f.host.settings()), await f.host.execute(() => f.host.runSelection(projectId))]) {
      assert.equal(reply.ok, false); if (!reply.ok) assert.equal(reply.error.code, 'capture_failed');
    }
    unwrap(await f.host.execute(() => f.host.saveDefault({ model: 'fixture-second', effort: 'deep' })));
    assert.equal(unwrap(await f.host.execute(() => f.host.settings())).settings.defaultAgent?.model, 'fixture-second');
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

test('separately admitted recovery identities permit clean replacements without reading or unquarantining old agent metadata', async () => {
  const f = await fixture();
  try {
    unwrap(await f.host.execute(() => f.host.catalog(f.entry.id)));
    unwrap(await f.host.execute(() => f.host.saveDefault({ model: 'fixture-second', effort: 'deep' })));
    const projectId = newId(); const old = unwrap(await f.host.execute(() => f.host.saveRunSelection(projectId, 0, { model: 'fixture-second', effort: 'deep' })));
    const exposed = await f.credentials.register('openai', newId(), 'Controlled exposure', 'fixture-second');
    for (const reply of [await f.host.execute(() => f.host.settings()), await f.host.execute(() => f.host.runSelection(projectId))]) {
      assert.equal(reply.ok, false); if (!reply.ok) assert.equal(reply.error.code, 'capture_failed');
    }
    f.restart(); await f.recording.initialize();
    const recovery = unwrap(await f.host.execute(() => f.host.recovery(projectId)));
    assert.equal(recovery.credentialRef, f.entry.id);
    assert.equal(recovery.credentials.find(item => item.id === f.entry.id)?.status, 'active');
    assert.equal(recovery.credentials.find(item => item.id === exposed.id)?.status, 'revoked');
    assert.deepEqual({ ...recovery.selection }, { snapshotId: old.snapshotId, projectId, revision: 1 });
    assert.equal(JSON.stringify(recovery).includes('fixture-second'), false);
    f.mode('removed'); unwrap(await f.host.execute(() => f.host.catalog(recovery.credentialRef!)));
    unwrap(await f.host.execute(() => f.host.saveDefault({ model: 'fixture-first', effort: 'brief' })));
    const replacement = unwrap(await f.host.execute(() => f.host.saveRunSelection(projectId, recovery.selection!.revision, { model: 'fixture-first', effort: 'brief' })));
    assert.equal(replacement.revision, 2); assert.notEqual(replacement.snapshotId, old.snapshotId);
    assert.equal(unwrap(await f.host.execute(() => f.host.settings())).settings.defaultAgent?.model, 'fixture-first');
    assert.deepEqual(unwrap(await f.host.execute(() => f.host.runSelection(projectId))), replacement);
    await f.credentials.finishRemediation(exposed.id); await f.recording.initialize();
    const state = await readFile(path.join(f.directory, 'records', 'security-state.json'), 'utf8');
    assert.ok(state.includes(old.snapshotId)); assert.equal(state.includes('fixture-second'), false);
    // The recovery channel fails closed too; it is not a bypass around a broken matcher.
    f.sanitizer.filter = () => { throw new Error('Controlled matcher outage'); };
    const withheld = await f.host.execute(() => f.host.recovery(projectId));
    assert.equal(withheld.ok, false); if (!withheld.ok) assert.equal(withheld.error.code, 'capture_failed');
  } finally { f.close(); }
});

// Round 3 regressions exercise real credential registration and durable storage,
// with only the boundary timing controlled by deferred promises.
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function assertWithheld(reply: CodexReply<unknown>, effect = 'none') {
  assert.equal(reply.ok, false, 'unsafe metadata must not be published');
  if (!reply.ok) { assert.equal(reply.error.code, 'capture_failed'); assert.equal(reply.error.effect, effect); }
  assert.equal(JSON.stringify(reply).includes('fixture-first'), false);
}
for (const boundary of ['page', 'close', 'diagnostic', 'retired-diagnostic'] as const) test(`PR114-R3-F01: catalog re-admits after ${boundary}`, async () => {
  const f = await fixture(); const entered = deferred(); const release = deferred();
  try {
    f.hookRpc(rpc => {
      if (boundary === 'close') {
        const close = rpc.close.bind(rpc);
        rpc.close = async () => { entered.resolve(); await release.promise; await close(); };
      } else if (boundary === 'page') {
        const request = rpc.request.bind(rpc);
        rpc.request = async (method, params) => {
          if (method === 'model/list' && (params as { cursor?: string }).cursor) { entered.resolve(); await release.promise; }
          return request(method, params);
        };
      }
    });
    f.hookStore(async (command, run) => {
      if (boundary.endsWith('diagnostic') && command.kind === 'diagnostic') { entered.resolve(); await release.promise; }
      return run();
    });
    const running = f.host.execute(() => f.host.catalog(f.entry.id)); await entered.promise;
    const exposed = await f.credentials.register('openai', newId(), 'Controlled timing key', 'fixture-first');
    if (boundary === 'retired-diagnostic') await f.credentials.revoke(exposed.id);
    release.resolve();
    await assertWithheld(await running);
  } finally { release.resolve(); f.close(); }
});
for (const kind of ['default', 'run_save'] as const) test(`PR114-R3-F01: ${kind} refuses metadata made unsafe during diagnostics`, async () => {
  const f = await fixture(); const entered = deferred(); const release = deferred(); const projectId = newId();
  try {
    unwrap(await f.host.execute(() => f.host.catalog(f.entry.id)));
    f.hookStore(async (command, run) => {
      if (command.kind === 'diagnostic') { entered.resolve(); await release.promise; } return run();
    });
    const choice = { model: 'fixture-first', effort: 'brief' };
    const running = f.host.execute<AgentChoice | AgentSnapshot>(() => kind === 'default' ? f.host.saveDefault(choice) : f.host.saveRunSelection(projectId, 0, choice));
    await entered.promise; await f.credentials.register('openai', newId(), 'Controlled timing key', 'fixture-first'); release.resolve();
    await assertWithheld(await running);
    assert.equal((f.store().handle({ kind: 'settings' }) as { defaultAgent: unknown }).defaultAgent, null);
    assert.equal(f.store().handle({ kind: 'run_get', projectId }), null);
  } finally { release.resolve(); f.close(); }
});
test('PR114-R3-F01: settings rechecks its exact default after diagnostics await', async () => {
  const f = await fixture(); const entered = deferred(); const release = deferred();
  try {
    unwrap(await f.host.execute(() => f.host.catalog(f.entry.id)));
    unwrap(await f.host.execute(() => f.host.saveDefault({ model: 'fixture-first', effort: 'brief' })));
    f.hookStore(async (command, run) => { if (command.kind === 'diagnostics') { entered.resolve(); await release.promise; } return run(); });
    const running = f.host.execute(() => f.host.settings()); await entered.promise;
    const exposed = await f.credentials.register('openai', newId(), 'Controlled timing key', 'fixture-first'); release.resolve();
    await assertWithheld(await running);
    assert.equal(f.credentials.list().find(entry => entry.id === exposed.id)?.status, 'revoked');
  } finally { release.resolve(); f.close(); }
});
for (const kind of ['default', 'run_save'] as const) test(`PR114-R3-F02: committed ${kind} with rejected reply reports unknown`, async () => {
  const f = await fixture();
  try {
    unwrap(await f.host.execute(() => f.host.catalog(f.entry.id)));
    f.hookStore(async (command, run) => { const result = run(); if (command.kind === kind) throw new Error('Controlled dropped reply'); return result; });
    const choice = { model: 'fixture-first', effort: 'brief' }; const projectId = newId();
    const requestId = newId();
    const save = () => kind === 'default' ? f.host.saveDefault(choice, requestId) : f.host.saveRunSelection(projectId, 0, choice, requestId);
    const reply = await f.host.execute<AgentChoice | AgentSnapshot>(save);
    assert.equal(reply.ok, false); if (!reply.ok) assert.equal(reply.error.effect, 'unknown');
    f.restart(); f.hookStore(undefined); const starts = f.starts;
    const recovered = unwrap(await f.host.execute<AgentChoice | AgentSnapshot>(save)); assert.equal(f.starts, starts);
    assert.deepEqual(unwrap(await f.host.execute<AgentChoice | AgentSnapshot>(save)), recovered);
    const changed = await f.host.execute<AgentChoice | AgentSnapshot>(() => kind === 'default' ? f.host.saveDefault({ ...choice, effort: 'deep' }, requestId) : f.host.saveRunSelection(projectId, 0, { ...choice, effort: 'deep' }, requestId));
    assert.equal(changed.ok, false); if (!changed.ok) assert.equal(changed.error.code, 'conflict');
    assert.equal(f.starts, starts);
    assert.ok(kind === 'default' ? (f.store().handle({ kind: 'settings' }) as { defaultAgent: unknown }).defaultAgent : f.store().handle({ kind: 'run_get', projectId }));
  } finally { f.close(); }
});

for (const kind of ['default', 'run_save'] as const) test(`PR114-R3-F01: exact committed ${kind} receipt is contained after a delayed reply`, async () => {
  const f = await fixture(); const entered = deferred(); const release = deferred(); const projectId = newId();
  try {
    unwrap(await f.host.execute(() => f.host.catalog(f.entry.id)));
    f.hookStore(async (command, run) => {
      const result = run(); if (command.kind === kind) { entered.resolve(); await release.promise; } return result;
    });
    const choice = { model: 'fixture-first', effort: 'brief' }; const requestId = newId();
    const running = f.host.execute<AgentChoice | AgentSnapshot>(() => kind === 'default' ? f.host.saveDefault(choice, requestId) : f.host.saveRunSelection(projectId, 0, choice, requestId));
    await entered.promise;
    const exposed = await f.credentials.register('openai', newId(), 'Controlled late match', 'fixture-first'); release.resolve();
    await assertWithheld(await running, 'unknown');
    assert.equal(f.credentials.list().find(entry => entry.id === exposed.id)?.status, 'revoked');
    f.restart(); await f.recording.initialize();
    const reconciled = unwrap(await f.host.execute(() => f.host.reconcileSave(requestId)));
    assert.equal(reconciled.state, 'withheld'); assert.equal(JSON.stringify(reconciled).includes('fixture-first'), false);
    await f.credentials.finishRemediation(exposed.id); await f.recording.initialize();
    assert.equal(unwrap(await f.host.execute(() => f.host.reconcileSave(requestId))).state, 'withheld');
    const state = await readFile(path.join(f.directory, 'records/security-state.json'), 'utf8');
    assert.equal(state.includes('fixture-first'), false);
  } finally { release.resolve(); f.close(); }
});
test('PR114-R3-F01: a policy change during retained recheck restarts admission and persists containment', async () => {
  const f = await fixture(); const entered = deferred(); const release = deferred();
  try {
    unwrap(await f.host.execute(() => f.host.catalog(f.entry.id)));
    unwrap(await f.host.execute(() => f.host.saveDefault({ model: 'fixture-first', effort: 'brief' })));
    const recheck = f.recording.recheck.bind(f.recording); let first = true;
    f.recording.recheck = async record => { const result = await recheck(record); if (first) { first = false; entered.resolve(); await release.promise; } return result; };
    const running = f.host.execute(() => f.host.settings()); await entered.promise;
    const exposed = await f.credentials.register('openai', newId(), 'Controlled late match', 'fixture-first'); release.resolve();
    await assertWithheld(await running);
    assert.equal(f.credentials.list().find(entry => entry.id === exposed.id)?.status, 'revoked');
  } finally { release.resolve(); f.close(); }
});
for (const kind of ['default', 'run_save'] as const) for (const failure of ['timeout', 'disconnect', 'throw_after_commit'] as const)
  test(`PR114-R3-F02: production store client ${failure} recovers exact ${kind} receipt after reopen`, async () => {
    const f = await fixture();
    try {
      unwrap(await f.host.execute(() => f.host.catalog(f.entry.id)));
      const agent = unwrap(await f.host.execute(() => f.host.choose({ model: 'fixture-first', effort: 'brief' })));
      const requestId = newId(); const projectId = newId(); const choice = { model: agent.model, effort: agent.effort };
      const command: CodexStoreCommand = kind === 'default' ? { kind, requestId, choice, agent } : { kind, requestId, choice, agent, projectId, expectedRevision: 0 };
      const posts: { id: string; codex: CodexStoreCommand }[] = []; const timers: (() => void)[] = [];
      const client = new CodexStoreClient({ available: () => true, post(message) {
        posts.push(message);
        if (failure === 'throw_after_commit' && message.codex.kind === kind) { f.store().handle(message.codex); throw new Error('Controlled reply failure'); }
      } }, input => {
        const releasePolicy = f.sanitizer.holdMatchingPolicy();
        try { admitCodexValue(f.sanitizer, input); return releasePolicy; } catch (error) { releasePolicy(); throw error; }
      }, callback => { timers.push(callback); return () => {}; });
      const writing = client.request(command); const rejected = assert.rejects(writing, error => error instanceof CodexFailure && error.effect === 'unknown');
      // Registration cannot make already admitted bytes newly unsafe while a
      // write might still be pending. No raw secret goes to the coordinator.
      let registered = false;
      const registration = f.credentials.register('openai', newId(), 'Controlled pending key', 'unrelated-controlled-key').then(() => { registered = true; });
      await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(registered, false);
      if (failure !== 'throw_after_commit') f.store().handle(posts[0].codex);
      if (failure === 'disconnect') client.unavailable(); else {
        if (failure === 'timeout') timers[0]();
        await rejected; assert.equal(registered, false);
        const barrier = posts.at(-1)!; assert.equal(barrier.codex.kind, 'barrier');
        client.receive(barrier.id, { ok: true, value: f.store().handle(barrier.codex) });
      }
      await rejected; await registration; assert.equal(registered, true);
      f.restart(); const starts = f.starts;
      const receipt = unwrap(await f.host.execute<AgentChoice | AgentSnapshot>(() => kind === 'default' ? f.host.saveDefault(choice, requestId) : f.host.saveRunSelection(projectId, 0, choice, requestId)));
      assert.equal(f.starts, starts);
      assert.deepEqual(unwrap(await f.host.execute(() => f.host.reconcileSave(requestId))), { requestId, state: 'committed', result: receipt });
      if ('revision' in receipt) assert.equal(receipt.revision, 1);
    } finally { f.close(); }
  });
test('PR114-R3-F02: production client pre-dispatch unavailability has no effect', async () => {
  const client = new CodexStoreClient({ available: () => false, post() { assert.fail('must not dispatch'); } });
  await assert.rejects(client.request({ kind: 'authenticate', credentialRef: newId() }), error => error instanceof CodexFailure && error.effect === 'none');
});
test('PR114-R3-F02: schema upgrade backs up v1 history and supports deliberate backup recovery', async () => {
  const f = await fixture();
  try {
    unwrap(await f.host.execute(() => f.host.catalog(f.entry.id)));
    const agent = unwrap(await f.host.execute(() => f.host.choose({ model: 'fixture-first', effort: 'brief' })));
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lab-codex-upgrade-')); temporary.push(directory);
    const filename = path.join(directory, 'codex-settings.sqlite');
    const old = openStore(filename, CODEX_SCHEMA_V1);
    const projectId = newId(); const snapshotId = newId(); const createdAt = new Date().toISOString();
    old.prepare('INSERT INTO settings VALUES (1, ?, ?)').run(f.entry.id, JSON.stringify(agent));
    old.prepare('INSERT INTO agent_selections VALUES (?, ?, ?, ?, ?)').run(snapshotId, projectId, 1, createdAt, JSON.stringify(agent)); old.close();
    const upgraded = new CodexStore(directory);
    const snapshot = upgraded.handle({ kind: 'run_get', projectId }); assert.ok(snapshot && 'snapshotId' in snapshot); assert.equal(snapshot.snapshotId, snapshotId);
    const requestId = newId(); upgraded.handle({ kind: 'run_save', projectId, expectedRevision: 1, choice: { model: agent.model, effort: agent.effort }, agent, requestId }); upgraded.close();
    const backups = (await readdir(directory)).filter(name => name.includes('.before-v2-')); assert.equal(backups.length, 1);
    const backup = new Database(path.join(directory, backups[0]), { readonly: true });
    assert.equal(backup.pragma('integrity_check', { simple: true }), 'ok'); assert.equal(backup.pragma('user_version', { simple: true }), 1);
    assert.equal((backup.prepare('SELECT COUNT(*) AS n FROM agent_selections').get() as { n: number }).n, 1); backup.close();
    assert.throws(() => openStore(filename, CODEX_SCHEMA_V1), /Unsupported database schema version/);
    const reopened = new CodexStore(directory);
    const retried = reopened.handle({ kind: 'mutation_get', requestId, input: { kind: 'run_save', projectId, expectedRevision: 1, choice: { model: agent.model, effort: agent.effort } } });
    assert.ok(retried && 'revision' in retried); assert.equal(retried.revision, 2); reopened.close();
    const restoredDirectory = await mkdtemp(path.join(os.tmpdir(), 'lab-codex-restore-')); temporary.push(restoredDirectory);
    await copyFile(path.join(directory, backups[0]), path.join(restoredDirectory, 'codex-settings.sqlite'));
    const restored = new CodexStore(restoredDirectory);
    assert.deepEqual(restored.handle({ kind: 'run_get', projectId }), snapshot);
    assert.equal(restored.handle({ kind: 'mutation_receipt', requestId }), null); restored.close();
  } finally { f.close(); }
});

test('PR114-R3-F01: production write ownership delays new matching values until commit and withholds the late receipt', async () => {
  const f = await fixture(); const entered = deferred(); const releaseReply = deferred();
  try {
    unwrap(await f.host.execute(() => f.host.catalog(f.entry.id)));
    const client = new CodexStoreClient({ available: () => true, post(message) {
      const result = f.store().handle(message.codex);
      if (message.codex.kind === 'run_save') {
        entered.resolve(); void releaseReply.promise.then(() => client.receive(message.id, { ok: true, value: result }));
      } else client.receive(message.id, { ok: true, value: result });
    } }, command => {
      const release = f.sanitizer.holdMatchingPolicy();
      try { admitCodexValue(f.sanitizer, command); return release; } catch (error) { release(); throw error; }
    });
    f.hookStore(async command => client.request(command));
    const projectId = newId(); const requestId = newId();
    const running = f.host.execute(() => f.host.saveRunSelection(projectId, 0, { model: 'fixture-first', effort: 'brief' }, requestId));
    await entered.promise;
    let registered = false;
    const registration = f.credentials.register('openai', newId(), 'Controlled late match', 'fixture-first').then(value => { registered = true; return value; });
    await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(registered, false);
    releaseReply.resolve(); await registration;
    await assertWithheld(await running, 'unknown');
    assert.equal(unwrap(await f.host.execute(() => f.host.reconcileSave(requestId))).state, 'withheld');
  } finally { releaseReply.resolve(); f.close(); }
});
test('PR114-R3-F01: matching ownership acquired at credential admission defers registration without losing the value', async () => {
  const f = await fixture(); let release = () => {};
  try {
    let settled = false;
    const registering = f.credentials.register('openai', newId(), 'Controlled queued registration', 'controlled-queued-registration-value');
    const observed = registering.then(() => { settled = true; }, error => { settled = true; throw error; });
    queueMicrotask(() => { release = f.sanitizer.holdMatchingPolicy(); });
    // Attach the rejection observer before checking the controlled scheduling gap.
    const outcome = observed.then(() => 'saved', () => 'rejected');
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false, 'matching-policy contention must defer credential admission');
    release(); assert.equal(await outcome, 'saved');
  } finally { release(); f.close(); }
});
