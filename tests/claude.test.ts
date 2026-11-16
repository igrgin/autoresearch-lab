import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { CredentialService } from '../src/security/credentials';
import { PrivateFiles } from '../src/security/private-files';
import { Sanitizer } from '../src/security/sanitizer';
import { SafeRecording } from '../src/security/recording';
import { newId } from '../src/security/common';
import { ClaudeHost, ClaudeWorker } from '../src/claude/host';
import { ClaudeSelectionStore, type SelectionCommand, type SelectionValue } from '../src/claude/store';
import { SelectionClient } from '../src/claude/selection-client';
import { ownClaudePublication } from '../src/claude/publication';
import { CATALOG_MAX_AGE_MS, CLAUDE_CODE_VERSION, ClaudeChoice, ClaudeFailure, failureReply } from '../src/claude/contracts';
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
  const buildHost = (dispatch: (command: SelectionCommand) => Promise<SelectionValue> = async command => store.handle(command)) =>
    new ClaudeHost(credentials, recording, async () => {}, (input, signal) => worker(input, signal), dispatch, async id => id === projectId, () => now);
  const host = buildHost();
  const choice: ClaudeChoice = { integration: 'claude', credentialId: entry.id, modelId };
  return { directory, matcher, credentials, recording, entry, choice, host, projectId, buildHost, store: () => store,
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

test('a committed default with a lost reply reports unknown and reconciles the same save after restart', async () => {
  for (const failure of ['timeout', 'disconnect'] as const) {
    const f = await fixture();
    try {
      let acknowledge = false, expire: (() => void) | undefined, late: { id: string; selection: SelectionCommand } | undefined;
      let reached!: () => void; const committed = new Promise<void>(resolve => { reached = resolve; });
      const client = new SelectionClient(message => {
        let result: SelectionValue;
        try { result = f.store().handle(message.selection); }
        catch (error) { client.receive(message.id, failureReply(error instanceof ClaudeFailure ? error.reason : 'unavailable', message.id)); return; }
        if (message.selection.kind === 'save' && !acknowledge) { late = message; reached(); }
        else client.receive(message.id, { ok: true, value: result });
      }, callback => { expire = callback; return () => { if (expire === callback) expire = undefined; }; });
      const host = f.buildHost(command => client.request(command));
      await host.discover(f.entry.id);
      const requestId = newId();
      const pending = host.reply(() => host.save(f.choice, 0, requestId));
      await committed;
      const saved = f.store().handle({ kind: 'get' }); assert.ok(saved && 'revision' in saved); assert.equal(saved.revision, 1);
      if (failure === 'timeout') expire!(); else client.unavailable();
      const reply = await pending; assert.ok(!reply.ok); assert.equal(reply.error.effect, 'unknown');
      assert.match(reply.error.message, /outcome is unknown/); assert.equal(reply.error.retry, 'same_key');
      client.receive(late!.id, { ok: true, value: saved }); // An expired reply cannot change the outcome already reported.
      acknowledge = true; const calls = f.calls(); f.restart();
      const reopened = f.buildHost(command => client.request(command));
      const recovered = await reopened.save(f.choice, 0, requestId);
      assert.deepEqual(recovered, saved); assert.equal(f.calls(), calls); // No fresh catalog or worker is needed to reconcile.
      assert.equal((f.store().handle({ kind: 'get' }) as typeof recovered).revision, 1);
      await assert.rejects(reopened.save({ ...f.choice, modelId: otherId }, 0, requestId), { reason: 'idempotency_conflict' });
      const db = new Database(path.join(f.directory, 'agent-settings.sqlite'), { readonly: true });
      try { assert.equal((db.prepare('SELECT count(*) AS count FROM save_requests').get() as { count: number }).count, 1); }
      finally { db.close(); }
    } finally { f.close(); }
  }
});

test('selection transport freezes dispatched input and distinguishes uncertain saves from unavailable reads', async () => {
  let expire!: () => void, sent: SelectionCommand | undefined;
  const client = new SelectionClient(message => { sent = message.selection; }, callback => { expire = callback; return () => {}; });
  const command: SelectionCommand = { kind: 'save', requestId: newId(), expectedRevision: 0,
    observedAt: new Date().toISOString(), choice: { integration: 'claude', credentialId: newId(), modelId } };
  const write = client.request(command); Object.assign(command, { kind: 'get' });
  assert.equal(sent!.kind, 'save'); expire(); await assert.rejects(write, { effect: 'unknown' });
  const read = client.request({ kind: 'get' }); client.unavailable(); await assert.rejects(read, { effect: 'none' });
});

test('default state and its durable retry receipt commit atomically', async () => {
  const f = await fixture();
  const db = new Database(path.join(f.directory, 'agent-settings.sqlite'));
  try {
    await f.host.discover(f.entry.id); const requestId = newId();
    db.exec("CREATE TRIGGER controlled_receipt_failure BEFORE INSERT ON save_requests BEGIN SELECT RAISE(ABORT, 'Controlled receipt fault'); END");
    await assert.rejects(f.host.save(f.choice, 0, requestId));
    assert.equal(f.store().handle({ kind: 'get' }), null);
    assert.equal((db.prepare('SELECT count(*) AS count FROM save_requests').get() as { count: number }).count, 0);
    db.exec('DROP TRIGGER controlled_receipt_failure');
    assert.equal((await f.host.save(f.choice, 0, requestId)).revision, 1);
    assert.equal((await f.host.save(f.choice, 0, requestId)).revision, 1);
  } finally { db.close(); f.close(); }
});

test('newly recognized persisted model metadata revokes access and remains quarantined after remediation', async () => {
  const f = await fixture();
  try {
    await f.host.discover(f.entry.id); const requestId = newId();
    await f.host.save(f.choice, 0, requestId);
    const snapshot = await f.host.saveRun({ projectId: f.projectId, runId: newId(), snapshotId: newId(), choice: f.choice });
    const exposed = await f.credentials.register('anthropic', newId(), 'Later recognized model credential', modelId);
    for (const reply of [await f.host.reply(() => f.host.settings()), await f.host.reply(() => f.host.runs(f.projectId)),
      await f.host.reply(() => f.host.save(f.choice, 0, requestId))]) {
      assert.ok(!reply.ok); assert.equal(reply.error.reason, 'capture_failed'); assert.equal(JSON.stringify(reply).includes(modelId), false);
    }
    assert.equal(f.credentials.list().find(entry => entry.id === exposed.id)!.status, 'revoked');
    const calls = f.calls(); await assert.rejects(f.host.discover(exposed.id), { reason: 'authentication_required' });
    assert.equal(f.calls(), calls);
    await assert.rejects(f.host.discover(f.entry.id), { reason: 'capture_failed' });
    const state = await readFile(path.join(f.directory, 'records', 'security-state.json'), 'utf8');
    assert.ok(state.includes(exposed.id)); assert.ok(state.includes(snapshot.snapshotId)); assert.equal(state.includes(modelId), false);
    const reopened = f.restart(); await f.credentials.finishRemediation(exposed.id); await f.recording.initialize();
    for (const reply of [await reopened.reply(() => reopened.settings()), await reopened.reply(() => reopened.runs(f.projectId))]) {
      assert.ok(!reply.ok); assert.equal(reply.error.reason, 'capture_failed');
    }
    await reopened.discover(f.entry.id);
    await reopened.save({ ...f.choice, modelId: otherId }, 1);
    assert.equal((await reopened.settings()).selection?.modelId, otherId);
    // A clean new default never removes the original run record's quarantine.
    const oldRun = await reopened.reply(() => reopened.runs(f.projectId)); assert.ok(!oldRun.ok); assert.equal(oldRun.error.reason, 'capture_failed');
  } finally { f.close(); }
});

test('v1 Claude selections upgrade with a preserved backup and a durable save journal', async () => {
  const f = await fixture();
  try {
    await f.host.discover(f.entry.id); const saved = await f.host.save(f.choice, 0);
    const input = { projectId: f.projectId, runId: newId(), snapshotId: newId(), choice: f.choice };
    const run = await f.host.saveRun(input);
    // Reconstruct the exact previous supported schema: v1 has these same rows
    // and migration checksum, but no retry journal or v2 migration entry.
    const legacy = new Database(path.join(f.directory, 'agent-settings.sqlite'));
    legacy.exec('DROP TABLE save_requests; DELETE FROM schema_migrations WHERE version=2; PRAGMA user_version=1'); legacy.close();
    const reopened = f.restart();
    assert.deepEqual((await reopened.settings()).selection, saved); assert.deepEqual(await reopened.runs(f.projectId), [run]);
    const backups = (await readdir(f.directory)).filter(name => name.startsWith('agent-settings.sqlite.before-v2-'));
    assert.equal(backups.length, 1);
    const backup = new Database(path.join(f.directory, backups[0]), { readonly: true });
    try {
      assert.equal(backup.pragma('user_version', { simple: true }), 1);
      assert.deepEqual(JSON.parse((backup.prepare('SELECT body FROM agent_selection').get() as { body: string }).body), saved);
      assert.equal(backup.prepare("SELECT 1 FROM sqlite_master WHERE name='save_requests'").get(), undefined);
    } finally { backup.close(); }
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
    const failedDiscovery = await f.host.reply(() => f.host.discover(f.entry.id));
    assert.ok(!failedDiscovery.ok); assert.equal(failedDiscovery.error.effect, 'none');
    assert.equal(failedDiscovery.error.message.includes('save outcome is unknown'), false);
    assert.ok(!JSON.stringify(failedDiscovery).includes(secret));
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

test('run save replay rechecks the exact durable receipt and cannot revive quarantine after remediation', async () => {
 const f=await fixture();try {
  await f.host.discover(f.entry.id);const input={projectId:f.projectId,runId:newId(),snapshotId:newId(),choice:f.choice};const saved=await f.host.saveRun(input);
  const exposed=await f.credentials.register('anthropic',newId(),'Controlled timestamp exposure',saved.createdAt);
  f.advance();await f.host.discover(f.entry.id);
  const replay=await f.host.reply(()=>f.host.saveRun(input));assert.equal(replay.ok,false);if(!replay.ok)assert.equal(replay.error.reason,'capture_failed');assert.equal(JSON.stringify(replay).includes(saved.createdAt),false);
  assert.equal(f.credentials.list().find(row=>row.id===exposed.id)?.status,'revoked');
  const listed=await f.host.reply(()=>f.host.runs(f.projectId));assert.equal(listed.ok,false);
  await f.credentials.finishRemediation(exposed.id);const restarted=f.restart();await f.recording.initialize();await restarted.discover(f.entry.id);
  const again=await restarted.reply(()=>restarted.saveRun(input));assert.equal(again.ok,false);if(!again.ok)assert.equal(again.error.reason,'capture_failed');
 }finally{f.close();}
});


test('fresh default save rechecks catalog observation metadata before persisting it', async () => {
  const f = await fixture();
  try {
    const catalog = await f.host.discover(f.entry.id);
    const exposed = await f.credentials.register('anthropic', newId(), 'Later catalog observation credential', catalog.observedAt);
    const reply = await f.host.reply(() => f.host.save(f.choice, 0, newId()));
    assert.ok(!reply.ok); assert.equal(reply.error.reason, 'capture_failed');
    assert.equal(JSON.stringify(reply).includes(catalog.observedAt), false);
    assert.equal(f.store().handle({ kind: 'get' }), null);
    assert.equal(f.credentials.list().find(entry => entry.id === exposed.id)!.status, 'active'); // Rejected before this proposed record was retained.
  } finally { f.close(); }
});


test('minimal Claude recovery projection permits an explicit clean replacement after quarantine and restart', async () => {
  const f = await fixture();
  try {
    await f.host.discover(f.entry.id); const requestId = newId();
    await f.host.save(f.choice, 0, requestId);
    const exposed = await f.credentials.register('anthropic', newId(), 'Later recognized default', modelId);
    await assert.rejects(f.host.settings(), { code: 'capture_failed' });
    const host = f.restart(); await f.credentials.finishRemediation(exposed.id); await f.recording.initialize();
    await assert.rejects(host.settings(), { code: 'capture_failed' });
    const recovery = await host.recovery();
    assert.equal(recovery.revision, 1);
    assert.ok(recovery.credentials.some(item => item.id === f.entry.id && item.status === 'active'));
    assert.equal(JSON.stringify(recovery).includes(modelId), false);
    assert.deepEqual(Object.keys(recovery).sort(), ['credentials', 'revision']);
    await host.discover(f.entry.id);
    const saved = await host.save({ ...f.choice, modelId: otherId }, recovery.revision, newId());
    assert.equal(saved.revision, 2); assert.equal((await host.settings()).selection?.modelId, otherId);
    await assert.rejects(host.save(f.choice, 0, requestId), { code: 'capture_failed' });
    assert.equal((await f.restart().recovery()).revision, 2);
  } finally { f.close(); }
});

test('Claude recovery returns independently sanitized labels and fails closed when policy is unavailable', async () => {
  const f = await fixture();
  try {
    await f.credentials.register('anthropic', newId(), 'Safe label', f.entry.label);
    const recovery = await f.host.recovery();
    assert.equal(JSON.stringify(recovery).includes(f.entry.label), false);
    assert.ok(recovery.credentials.some(item => item.id === f.entry.id));
    await writeFile(path.join(f.directory, 'records', 'security-state.json'), 'invalid');
    await assert.rejects(f.recording.initialize());
    const reply = await f.host.reply(() => f.host.recovery());
    assert.ok(!reply.ok); assert.equal(reply.error.reason, 'capture_failed');
  } finally { f.close(); }
});


test('a default receipt that becomes unsafe during storage is withheld with unknown effect', async () => {
  const f = await fixture();
  try {
    const host = f.buildHost(async command => {
      const result = f.store().handle(command);
      if (command.kind === 'save') await f.credentials.register('anthropic', newId(), 'Concurrent observation credential', command.observedAt);
      return result;
    });
    const catalog = await host.discover(f.entry.id);
    const reply = await host.reply(() => host.save(f.choice, 0, newId()));
    assert.ok(!reply.ok); assert.equal(reply.error.reason, 'capture_failed'); assert.equal(reply.error.effect, 'unknown');
    assert.equal(JSON.stringify(reply).includes(catalog.observedAt), false);
    await assert.rejects(f.restart().settings(), { code: 'capture_failed' });
  } finally { f.close(); }
});


test('qualification rechecks cached semantic choices before any worker receives them', async () => {
  const f = await fixture();
  try {
    await f.host.discover(f.entry.id);
    await f.credentials.register('model_download', newId(), 'Late model metadata', f.choice.modelId);
    let qualificationCalls = 0;
    f.setWorker(async () => { qualificationCalls++; return { qualified: true }; });
    const reply = await f.host.reply(() => f.host.qualify(f.choice));
    assert.ok(!reply.ok); assert.equal(reply.error.reason, 'capture_failed');
    assert.equal(qualificationCalls, 0); assert.equal(JSON.stringify(reply).includes(f.choice.modelId), false);
  } finally { f.close(); }
});


for (const kind of ['save', 'save_run'] as const) for (const timeout of [false, true]) test(`Claude pending publication holds matching through ${kind} / timeout=${timeout}`, async () => {
  const f = await fixture();
  try {
    let queued: { id: string; selection: SelectionCommand } | undefined, expire: (() => void) | undefined;
    const barriers: { id: string; selection: SelectionCommand }[] = [];
    let dispatched!: () => void; const entered = new Promise<void>(resolve => { dispatched = resolve; });
    const own = (command: SelectionCommand) => ownClaudePublication(f.matcher, f.recording, command);
    // Reflect permits the same test to execute against the prior constructor,
    // where the fourth (ownership) argument was ignored rather than a TS error.
    const client: SelectionClient = Reflect.construct(SelectionClient, [(message: { id: string; selection: SelectionCommand }) => {
      if (message.selection.kind === kind) { queued = message; dispatched(); }
      else if ((message.selection as { kind: string }).kind === 'barrier') barriers.push(message);
      else client.receive(message.id, { ok: true, value: f.store().handle(message.selection) });
    }, (callback: () => void) => { expire = callback; return () => {}; }, 15000, own]);
    const host = f.buildHost(command => client.request(command)); await host.discover(f.entry.id);
    const saving = host.reply<SelectionValue>(() => kind === 'save' ? host.save(f.choice, 0, newId())
      : host.saveRun({ projectId: f.projectId, runId: newId(), snapshotId: newId(), choice: f.choice }));
    await entered;
    let matcherChanged = false, matchingStarted!: () => void;
    const matchingEntered = new Promise<void>(resolve => { matchingStarted = resolve; });
    const registerMatching = f.matcher.registerWhenMutable.bind(f.matcher);
    f.matcher.registerWhenMutable = async (id, value) => { matchingStarted(); await registerMatching(id, value); matcherChanged = true; };
    const registration = f.credentials.register('model_download', newId(), 'Concurrent pending metadata', f.choice.modelId);
    await matchingEntered; await new Promise(resolve => setImmediate(resolve));
    try {
      const registeredBeforeWrite = matcherChanged;
      if (timeout) { expire!(); const reply = await saving; assert.ok(!reply.ok); assert.equal(reply.error.effect, 'unknown'); }
      const result = f.store().handle(queued!.selection);
      const db = new Database(path.join(f.directory, 'agent-settings.sqlite'), { readonly: true });
      try { assert.ok(JSON.stringify(db.prepare(kind === 'save' ? 'SELECT body FROM agent_selection' : 'SELECT body FROM run_agent_inputs').all()).includes(modelId)); }
      finally { db.close(); }
      assert.equal(registeredBeforeWrite, false, 'matching mutation completed before the admitted SQL write');
      assert.equal(matcherChanged, false, 'commit happened while matching was still unchanged');
      client.receive(queued!.id, { ok: true, value: result });
      await registration; await saving;
      for (const barrier of barriers) client.receive(barrier.id, { ok: true, value: null });
      await assert.rejects(kind === 'save' ? host.settings() : host.runs(f.projectId), error => error instanceof ClaudeFailure ? error.reason === 'capture_failed' : (error as {code?: string}).code === 'capture_failed');
    } finally { client.unavailable(); await registration; await saving; }
  } finally { f.close(); }
});


for (const proof of ['barrier', 'confirmed_exit'] as const) test(`Claude timed-out publication retains matching until ${proof}`, async () => {
  const sent: { id: string; selection: SelectionCommand }[] = []; let expire!: () => void, owners = 0;
  const client = new SelectionClient(message => sent.push(message), callback => { expire = callback; return () => {}; }, 100,
    () => { owners++; return () => { owners--; }; });
  const saving = client.request({ kind: 'save', requestId: newId(), choice: { integration: 'claude', credentialId: newId(), modelId }, expectedRevision: 0, observedAt: new Date().toISOString() });
  assert.equal(owners, 1); expire(); await assert.rejects(saving, { effect: 'unknown' }); assert.equal(owners, 1);
  assert.equal(sent[1].selection.kind, 'barrier');
  if (proof === 'barrier') client.receive(sent[1].id, { ok: true, value: null }); else client.unavailable();
  assert.equal(owners, 0); client.receive(sent[0].id, { ok: true, value: null }); assert.equal(owners, 0);
});

for (const kind of ['save', 'save_run'] as const) test(`Claude exact-command admission rejects recognition before ${kind} dispatch`, async () => {
  const f = await fixture(); let writes = 0;
  try {
    const client = new SelectionClient(message => {
      if (message.selection.kind === kind) writes++;
      client.receive(message.id, { ok: true, value: f.store().handle(message.selection) });
    }, undefined, undefined, command => ownClaudePublication(f.matcher, f.recording, command));
    const host = f.buildHost(async command => {
      if (command.kind === kind) await f.credentials.register('model_download', newId(), 'Recognized before dispatch', modelId);
      return client.request(command);
    });
    await host.discover(f.entry.id);
    const reply = await host.reply<SelectionValue>(() => kind === 'save' ? host.save(f.choice, 0, newId())
      : host.saveRun({ projectId: f.projectId, runId: newId(), snapshotId: newId(), choice: f.choice }));
    assert.ok(!reply.ok); assert.equal(reply.error.reason, 'capture_failed'); assert.equal(reply.error.effect, 'none'); assert.equal(writes, 0);
    const db = new Database(path.join(f.directory, 'agent-settings.sqlite'), { readonly: true });
    try { for (const table of ['agent_selection', 'save_requests', 'run_agent_inputs']) assert.equal((db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as {n: number}).n, 0); }
    finally { db.close(); }
  } finally { f.close(); }
});
