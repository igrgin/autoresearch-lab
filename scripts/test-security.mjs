import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test, after } from 'node:test';
import { metadataPolicyTests } from '../tests/metadata-policy.mjs';

const build = await mkdtemp(path.join(os.tmpdir(), 'lab-security-build-'));
execFileSync('node_modules/.bin/tsc', ['--noEmit', 'false', '--rootDir', '.', '--outDir', build], { stdio: 'pipe' });
const require = createRequire(import.meta.url);
const { newId, SecurityError, REDACTED } = require(path.join(build, 'src/security/common.js'));
const { PrivateFiles } = require(path.join(build, 'src/security/private-files.js'));
const { CredentialService } = require(path.join(build, 'src/security/credentials.js'));
const { Sanitizer, MAX_CAPTURE_BYTES } = require(path.join(build, 'src/security/sanitizer.js'));
const { SafeRecording, CAPTURE_PATHS } = require(path.join(build, 'src/security/recording.js'));
const { bindRecordedOperation, requireCredentialFreeCommand, providerRead, childEnvironment } = require(path.join(build, 'src/security/operations.js'));
const { validEntry } = require(path.join(build, 'src/security/entry-contract.js'));
const temporary = [build];
after(async () => { for (const folder of temporary) await rm(folder, { recursive: true, force: true }); });
const secret = 'synthetic-credential-4d7a+/"\\Ω';
const scope = () => ({ projectId: newId(), runId: newId(), actionId: newId(), operationId: newId() });
const meta = (s, source = 'tool_result', kind = 'activity') => ({ ...s, eventId: newId(), producerId: newId(), streamId: newId(), sequence: 0, source, kind, status: 'completed' });
function encryption() {
  const key = randomBytes(32);
  return {
    available: async () => true,
    encrypt: async text => { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv);
      const bytes = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), bytes]); },
    decrypt: async bytes => { const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'); },
  };
}
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lab-security-test-')); temporary.push(directory);
  const sanitizer = new Sanitizer(); const crypto = encryption();
  const vaultFiles = new PrivateFiles(path.join(directory, 'vault'));
  const credentials = new CredentialService(vaultFiles, crypto, sanitizer); await credentials.initialize();
  const entry = await credentials.register('runpod', newId(), 'Read access', secret);
  const recordFiles = new PrivateFiles(path.join(directory, 'records'));
  const recording = new SafeRecording(recordFiles, sanitizer, id => credentials.revoke(id)); await recording.initialize();
  return { directory, sanitizer, credentials, entry, recording, recordFiles, vaultFiles, crypto };
}
metadataPolicyTests({ require, build, fixture, newId });
async function assertAbsent(f, ids) {
  const variants = [secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret)];
  const authorizedScope = ids.length ? (await f.recording.read(ids[0])).envelope : scope();
  for (const destination of ['ui', 'export', 'search', 'replay', 'agent']) {
    const output = JSON.stringify(await f.recording.project(ids, destination, authorizedScope));
    for (const value of variants) assert.ok(!output.includes(value), `${destination} disclosed synthetic credential`);
  }
  for (const name of await readdir(path.join(f.directory, 'records'))) {
    const bytes = await readFile(path.join(f.directory, 'records', name), 'utf8');
    for (const value of variants) assert.ok(!bytes.includes(value), 'record file disclosed synthetic credential');
  }
}
for (const capturePath of CAPTURE_PATHS) test(`redacts ${capturePath} before disk, UI, exports and context`, async () => {
  const f = await fixture(); const s = scope();
  const raw = capturePath === 'attachment' ? `attachment ${secret}` : { message: secret, nested: { password: 'unknown-sensitive', url: 'https://user:unknown@example.test/a?signature=unknown' }, [secret]: secret };
  const record = await f.recording.capture(meta(s, capturePath), raw);
  assert.equal(record.coverage, 'redacted'); await assertAbsent(f, [record.envelope.eventId]);
});
test('complete streamed records hold UTF-8, JSON escapes and URL forms across every byte boundary', async () => {
  const f = await fixture(); const ids = [];
  for (const raw of [secret, JSON.stringify({ message: secret }), encodeURIComponent(secret), secret.split('').map(c => `\\u${c.charCodeAt(0).toString(16).padStart(4,'0')}`).join('')]) {
    const bytes = Buffer.from(raw);
    for (let split = 0; split <= bytes.length; split++) {
      const stream = f.recording.stream(meta(scope(), 'stdout'), raw.startsWith('{') ? 'json' : 'text');
      stream.push(bytes.subarray(0, split)); stream.push(bytes.subarray(split));
      const record = await stream.finish(); assert.equal(record.coverage, 'redacted'); ids.push(record.envelope.eventId);
    }
  }
  await assertAbsent(f, ids);
});
test('excluded native/auth/vendor/environment surfaces and binary attachments never retain detail', async () => {
  const f = await fixture(); const ids = [];
  for (const source of ['auth', 'headers', 'credential_file', 'environment', 'raw_provider', 'raw_sdk', 'native_history', 'attachment']) {
    const record = await f.recording.capture(meta(scope(), source), Buffer.from(secret));
    assert.equal(record.coverage, 'omitted'); assert.equal(record.body, null); ids.push(record.envelope.eventId);
  }
  await assertAbsent(f, ids);
});
test('incomplete, invalid UTF-8, oversized and malformed streams omit the whole body', async () => {
  const f = await fixture();
  for (const [bytes, complete, format, omission] of [[Buffer.from(secret.slice(0,10)), false, 'text', 'incomplete_record'],
    [Buffer.from([0xc0, 0xaf]), true, 'text', 'unsupported_encoding'], [Buffer.alloc(MAX_CAPTURE_BYTES + 1), true, 'text', 'size_limit'],
    [Buffer.from('{"unfinished":'), true, 'json', 'unsupported_encoding']]) {
    const stream = f.recording.stream(meta(scope(), 'stdout'), format); stream.push(bytes); const record = await stream.finish(complete);
    assert.equal(record.body, null); assert.equal(record.omission, omission);
  }
});
test('recursive fields, recognizable tokens, private keys and URL authority are scrubbed', () => {
  const sanitizer = new Sanitizer();
  const raw = { output: ['sk-proj-synthetic1234567890', 'hf_synthetic1234567890', 'Bearer random-value',
    '-----BEGIN PRIVATE KEY-----\nunknown\n-----END PRIVATE KEY-----', 'https://someone:unknown@example.test/file?api_key=unknown&signature=unknown'],
    Authentication: 'unknown', session_cookie: 'unknown' };
  const clean = JSON.stringify(sanitizer.filter(raw).body);
  for (const value of ['unknown', 'synthetic1234567890', 'random-value', 'someone']) assert.ok(!clean.includes(value));
});
test('unsupported/cyclic/getter/nested/non-finite inputs omit without evaluating getters', async () => {
  const f = await fixture(); let invoked = false; const cycle = {}; cycle.self = cycle;
  const getter = Object.defineProperty({}, 'value', { enumerable: true, get() { invoked = true; return secret; } });
  let nested = {}; for (let i=0; i<40; i++) nested = { child: nested };
  for (const input of [cycle, getter, nested, NaN, new Error(secret), '\ud800']) {
    const result = await f.recording.capture(meta(scope()), input); assert.equal(result.body, null); assert.equal(result.coverage, 'omitted');
  }
  assert.equal(invoked, false);
});
test('vault ciphertext, restart, permissions, lock and failed writes have no plaintext fallback', async () => {
  const f = await fixture(); const bytes = await readFile(path.join(f.directory, 'vault/credentials.vault'));
  assert.ok(!bytes.includes(Buffer.from(secret)));
  assert.equal((await stat(path.join(f.directory, 'vault'))).mode & 0o777, 0o700);
  assert.equal((await stat(path.join(f.directory, 'vault/credentials.vault'))).mode & 0o777, 0o600);
  const second = new CredentialService(f.vaultFiles, f.crypto, new Sanitizer()); await second.initialize(); assert.deepEqual(second.list(), [f.entry]);
  const locked = new CredentialService(f.vaultFiles, { ...f.crypto, available: async () => false }, new Sanitizer());
  await assert.rejects(locked.initialize(), { code: 'authentication_required' });
  f.crypto.encrypt = async () => { throw new Error(secret); };
  await assert.rejects(f.credentials.register('runpod', newId(), 'new', 'other-synthetic-value'), error => !String(error).includes(secret));
  assert.deepEqual(await readFile(path.join(f.directory, 'vault/credentials.vault')), bytes);
});
test('actual component capability rejects wrong category, account, purpose, unknown ref and cross-run use', async () => {
  const f = await fixture(); const s = scope();
  const binding = { component: 'runpod_adapter', accountId: f.entry.accountId, credentialId: f.entry.id, purpose: 'inspect', scope: s };
  let calls = 0; const handler = async value => { calls++; assert.equal(value, secret); return 'ok'; };
  assert.equal(await f.credentials.bindAdapter(binding, handler).execute(s), 'ok');
  for (const changed of [{ component: 'claude_worker', purpose: 'inference' }, { accountId: newId() }, { credentialId: newId() }]) {
    await assert.rejects(f.credentials.bindAdapter({ ...binding, ...changed }, handler).execute(s), { code: 'permission_denied' });
  }
  assert.throws(() => f.credentials.bindAdapter({ ...binding, component: 'research_agent' }, handler), { code: 'permission_denied' });
  assert.throws(() => f.credentials.bindAdapter({ ...binding, purpose: 'control' }, handler), { code: 'permission_denied' });
  await assert.rejects(f.credentials.bindAdapter(binding, handler).execute({ ...s, runId: newId() }), { code: 'permission_denied' });
  assert.equal(calls, 1);
});
test('all permitted category readers work without a generic renderer secret lookup', async () => {
  const f = await fixture();
  for (const [category, component, purpose] of [['vast', 'vast_adapter', 'discover'], ['openai', 'codex_auth', 'inference'],
    ['anthropic', 'claude_worker', 'list_models'], ['ssh_passphrase', 'ssh_transport', 'ssh_unlock'],
    ['model_download', 'model_fetcher', 'model_fetch'], ['control', 'control_transport', 'control']]) {
    const entry = await f.credentials.register(category, newId(), 'Synthetic', secret); const s = scope();
    const port = f.credentials.bindAdapter({ component, purpose, credentialId: entry.id, accountId: entry.accountId, scope: s }, async value => value === secret);
    assert.equal(await port.execute(s), true);
  }
  assert.equal(f.credentials.getSecret, undefined);
});
test('revocation aborts authenticated work, rejects subsequent use, matches retired values after restart', async () => {
  const f = await fixture(); const s = scope(); let aborted = false;
  const port = f.credentials.bindAdapter({ component: 'runpod_adapter', accountId: f.entry.accountId, credentialId: f.entry.id, purpose: 'inspect', scope: s },
    async (_value, signal) => new Promise(resolve => signal.addEventListener('abort', () => { aborted = true; resolve(secret); })));
  const running = assert.rejects(port.execute(s), { code: 'authentication_required' }); await f.credentials.revoke(f.entry.id);
  await running; assert.equal(aborted, true);
  await assert.rejects(port.execute(s), { code: 'authentication_required' });
  const matcher = new Sanitizer(); const second = new CredentialService(f.vaultFiles, f.crypto, matcher); await second.initialize();
  assert.equal(matcher.filter(secret).redacted, true); await second.finishRemediation(f.entry.id); assert.equal(second.list().length, 0);
});
test('broker filters successful tool returns before model delivery; ingress rejects secret commands', async () => {
  const f = await fixture(); const s = scope();
  const port = bindRecordedOperation(f.credentials, f.recording, { component: 'runpod_adapter', purpose: 'inspect', accountId: f.entry.accountId, credentialId: f.entry.id, scope: s }, meta(s), async value => ({ result: value }));
  const result = await port.execute(s); assert.equal(result.result, REDACTED);
  assert.throws(() => requireCredentialFreeCommand(f.sanitizer, ['download', secret]), { code: 'permission_denied' });
  assert.doesNotThrow(() => requireCredentialFreeCommand(f.sanitizer, ['python', 'train.py']));
});
test('broken sanitizer fences new work, keeps safe envelopes and separately validated controls', async () => {
  const f = await fixture(); const s = scope(); const filter = f.sanitizer.filter;
  f.sanitizer.filter = () => { throw new Error(secret); };
  const record = await f.recording.capture(meta(s), secret); assert.equal(record.omission, 'filter_unavailable');
  assert.throws(() => f.recording.assertCanAct(s), { code: 'capture_failed' });
  const receipt = await f.recording.control(meta(s), { controlId: newId(), state: 'unknown' }); assert.equal(receipt.body.state, 'unknown');
  const outcome = await f.recording.outcome(meta(s), { attemptId:newId(),executionOutcomeId:newId(),evidenceId:newId(),state:'interrupted' });
  assert.equal(outcome.envelope.kind,'execution_outcome'); assert.equal(outcome.body.state,'interrupted');
  f.sanitizer.filter = filter;
  await assertAbsent(f, [record.envelope.eventId, receipt.envelope.eventId]);
  const second = new SafeRecording(f.recordFiles, f.sanitizer, id => f.credentials.revoke(id)); await second.initialize();
  assert.throws(() => second.assertCanAct(s), { code: 'capture_failed' });
});
test('storage failure fences admission and never publishes raw exception diagnostics', async () => {
  const f = await fixture(); const s = scope(); f.recordFiles.write = async () => { throw new Error(secret); };
  await assert.rejects(f.recording.capture(meta(s), secret), error => error instanceof SecurityError && !String(error).includes(secret));
  assert.throws(() => f.recording.assertCanAct(s), { code: 'capture_failed' });
});
test('exposure quarantines run/context descendants and session, survives restart, corrects with new provenance, requires deliberate recovery', async () => {
  const f = await fixture(); const s = scope(); const sessionId = newId(); const original = meta(s); const descendant = meta(s, 'file_content', 'code');
  await f.recording.capture(original, 'original'); await f.recording.capture(descendant, {path:'train.py',content:'descendant'});
  const incident = await f.recording.incident(s, { recordIds: [original.eventId], sessionIds: [sessionId], credentialId: f.entry.id,
    reach: 'exposed', destinations: ['model', 'native_history', 'export'], reason: 'credential_exposure' });
  assert.equal(incident.coverage, 'incomplete'); assert.ok(!JSON.stringify(incident).includes(secret));
  assert.equal((await f.recording.read(descendant.eventId)).omission, 'quarantined');
  assert.throws(() => f.recording.assertCanAct(s), { code: 'capture_failed' });
  assert.deepEqual(await f.recording.project([original.eventId, descendant.eventId], 'agent', s), []);
  const restarted = new SafeRecording(f.recordFiles, f.sanitizer, id => f.credentials.revoke(id)); await restarted.initialize();
  assert.equal((await restarted.read(original.eventId)).body, null);
  const corrected = await restarted.correct(original.eventId, meta(s), { safe: secret }); assert.notEqual(corrected.envelope.eventId, original.eventId);
  assert.equal(corrected.supersedes, original.eventId); assert.equal(JSON.parse(await readFile(path.join(f.directory, 'records', `${original.eventId}.json`))).body, null);
  const proof = { replacementVerified: true, boundaryVerified: true, effectsReconciled: true, containmentComplete: true, explicitResume: true, freshSessionId: newId() };
  for (const flag of ['replacementVerified', 'boundaryVerified', 'effectsReconciled', 'containmentComplete', 'explicitResume']) {
    await assert.rejects(restarted.recover(incident.incidentId, { ...proof, [flag]: false }), { code: 'permission_denied' });
  }
  await assert.rejects(restarted.recover(incident.incidentId, { ...proof, freshSessionId: sessionId }), { code: 'permission_denied' });
  await restarted.recover(incident.incidentId, proof); restarted.assertCanAct(s, proof.freshSessionId);
  assert.throws(() => restarted.assertCanAct(s, sessionId), { code: 'capture_failed' });
  assert.equal((await restarted.read(original.eventId)).body, null);
  assert.equal((await restarted.read(corrected.envelope.eventId)).supersedes, original.eventId);
});
test('prevented and unknown reach remain explicit without fabricated outcomes or stop proof', async () => {
  const f = await fixture();
  for (const reach of ['prevented', 'unknown']) {
    const incident = await f.recording.incident(scope(), { recordIds: [], sessionIds: [], reach, destinations: ['unknown'], reason: 'unsafe_capture' });
    assert.equal(incident.reach, reach); assert.equal(incident.coverage, 'incomplete'); assert.equal(incident.executionOutcome, undefined); assert.equal(incident.reservationReleased, undefined);
  }
});
test('reuse rechecks newly registered secrets and keeps assessments/native/summaries out of model context', async () => {
  const f = await fixture(); const s = scope(); const value = 'newly-discovered-synthetic'; const ids = [];
  for (const [source, kind] of [['metric','validation'], ['metric','test_assessment'], ['summary','activity'], ['native_history','activity']]) {
    const record = await f.recording.capture(meta(s, source, kind), value); ids.push(record.envelope.eventId);
  }
  const discovered = await f.credentials.register('runpod', newId(), 'Discovered', value);
  assert.equal(discovered.status, 'active');
  for (const destination of ['ui','export','agent']) assert.ok(!JSON.stringify(await f.recording.project(ids,destination,s)).includes(value));
  const agent = await f.recording.project(ids, 'agent', s); assert.equal(agent.length, 0);
  assert.throws(() => f.recording.assertCanAct(s), { code: 'capture_failed' });
});
test('duplicate event replay is idempotent and identity conflicts never overwrite', async () => {
  const f = await fixture(); const event = meta(scope()); const record = await f.recording.capture(event, 'safe');
  assert.deepEqual(await f.recording.capture(event, 'safe'), record);
  await assert.rejects(f.recording.capture(event, 'changed'), { code: 'conflict' });
  assert.equal((await f.recording.read(event.eventId)).body, 'safe');
});
test('provider reads pin origin/method, refuse lifecycle and redirects; environments never inherit host auth', async () => {
  const calls = [];
  const request = async (url, options) => { calls.push({ url, options }); return new Response('{}'); };
  await providerRead('runpod','/v2/pods',secret,new AbortController().signal,request);
  await providerRead('vast','/api/v1/instances/',secret,new AbortController().signal,request);
  for (const { url, options } of calls) { assert.match(url,/^https:\/\/(api.runpod.io|console.vast.ai)\//); assert.equal(options.method,'GET'); assert.equal(options.redirect,'error'); assert.equal(options.credentials,'omit'); }
  for (const route of ['/v2/pods/id/stop','https://evil.test','/v2/pods?token=unknown']) await assert.rejects(providerRead('runpod',route,secret,new AbortController().signal,request));
  await assert.rejects(providerRead('runpod','/v2/pods',secret,new AbortController().signal,async () => { throw new Error(secret); }), error => !String(error).includes(secret));
  const paths = { home: '/private/isolated', temporary: '/private/temp', executablePath: '/usr/bin' };
  for (const kind of ['candidate','codex']) assert.deepEqual(Object.keys(childEnvironment(kind,paths,secret)).sort(), ['HOME','LANG','PATH','TMPDIR']);
  assert.equal(childEnvironment('claude',paths,secret).ANTHROPIC_API_KEY, secret);
});
test('credential entry schema has no retrieval route or transient challenge category', () => {
  assert.ok(validEntry({ category: 'openai', label: 'Local', value: secret }));
  assert.ok(!validEntry({ category: 'otp', label: 'Local', value: secret }));
  assert.ok(!validEntry({ category: 'openai', label: 'Local', value: secret, component: 'codex_auth' }));
});
test('tampered storage/symlinks fail safely', async () => {
  const f = await fixture(); await writeFile(path.join(f.directory, 'vault/credentials.vault'), 'corrupt');
  const second = new CredentialService(f.vaultFiles, f.crypto, new Sanitizer()); await assert.rejects(second.initialize(), { code: 'authentication_required' });
  const { symlink } = await import('node:fs/promises');
  await symlink('/etc/passwd', path.join(f.directory,'records','linked.json'));
  await assert.rejects(f.recordFiles.read('linked.json'), { code: 'capture_failed' });
});

test('agent context requires scope and exact task/code/validation schemas; extra test data is excluded', async () => {
  const f = await fixture(); const s = scope(); const ids = [];
  for (const [kind, source, body] of [
    ['task', 'file_content', { instruction: 'Classify the approved data.' }],
    ['code', 'file_content', { path: 'train.py', content: 'print(1)' }],
    ['validation', 'metric', { evaluationId: newId(), metricId: newId(), split: 'validation', value: .8 }],
    ['validation', 'metric', { evaluationId: newId(), metricId: newId(), split: 'test', value: .9 }],
    ['validation', 'metric', { evaluationId: newId(), metricId: newId(), split: 'validation', value: .8, testScore: .9 }],
    ['test_assessment', 'metric', { score: .9 }],
    ['activity', 'summary', { summary: 'Assessment score .9' }],
  ]) ids.push((await f.recording.capture(meta(s, source, kind),body)).envelope.eventId);
  const other = await f.recording.capture(meta(scope(), 'file_content','task'),{instruction:'Other project'}); ids.push(other.envelope.eventId);
  await assert.rejects(f.recording.project(ids,'agent'), {code:'permission_denied'});
  const context = await f.recording.project(ids,'agent',s);
  assert.deepEqual(context.map(r=>r.envelope.kind), ['task','code','validation']);
  assert.ok(!JSON.stringify(context).includes('testScore')); assert.ok(!JSON.stringify(context).includes('Other project'));
});

test('rotation preserves account scope, revokes old authority and retains remediation matching', async () => {
  const f = await fixture(); const replacement = await f.credentials.replace(f.entry.id, 'synthetic-replacement-value');
  assert.equal(replacement.accountId, f.entry.accountId); assert.notEqual(replacement.id, f.entry.id);
  assert.equal(f.credentials.list().find(e=>e.id===f.entry.id).status, 'revoked');
  assert.equal(f.sanitizer.filter(secret).redacted,true);
  const s = scope(); const port = f.credentials.bindAdapter({ component:'runpod_adapter', purpose:'inspect', accountId:f.entry.accountId, credentialId:replacement.id, scope:s }, async key=>key==='synthetic-replacement-value');
  assert.equal(await port.execute(s),true);
});
test('Vast issued sessions are operation-scoped memory only and cannot survive restart', async () => {
  const f = await fixture(); const s=scope(); const sessionValue='synthetic-expiring-vast-session';
  const session=f.credentials.registerVastSession(newId(),s,sessionValue);
  const binding={component:'vast_adapter',purpose:'discover',accountId:session.accountId,credentialId:session.id,scope:s};
  assert.equal(await f.credentials.bindAdapter(binding,async value=>value===sessionValue).execute(s),true);
  await assert.rejects(f.credentials.bindAdapter({...binding,scope:{...s,actionId:newId()}},async()=>true).execute({...s,actionId:newId()}));
  assert.ok(!(await f.crypto.decrypt(await readFile(path.join(f.directory,'vault/credentials.vault')))).includes(sessionValue));
  const second=new CredentialService(f.vaultFiles,f.crypto,new Sanitizer()); await second.initialize();
  await assert.rejects(second.bindAdapter(binding,async()=>true).execute(s),{code:'permission_denied'});
  await f.credentials.revoke(session.id); await assert.rejects(f.credentials.bindAdapter(binding,async()=>true).execute(s),{code:'authentication_required'});
});

test('post-dispatch failures preserve unknown effects and do not replay the operation', async () => {
  const f=await fixture(); const s=scope(); let calls=0;
  const binding={component:'runpod_adapter',purpose:'inspect',accountId:f.entry.accountId,credentialId:f.entry.id,scope:s};
  const port=bindRecordedOperation(f.credentials,f.recording,binding,meta(s),async()=>{calls++;throw new Error(secret);});
  await assert.rejects(port.execute(s),error=>error.effect==='unknown' && !String(error).includes(secret));
  assert.equal(calls,1);
});
test('incident propagation fence applies synchronously before asynchronous journal writes', async () => {
  const f=await fixture(); const s=scope();
  const pending=f.recording.incident(s,{recordIds:[],sessionIds:[],reach:'unknown',destinations:['unknown'],reason:'unsafe_capture'});
  assert.throws(()=>f.recording.assertCanAct(s),{code:'capture_failed'}); await pending;
});
test('permitted agent task/code/acceptance records retain useful content with synthetic credentials removed', async () => {
  const f=await fixture(); const s=scope(); const ids=[];
  for (const [kind,source,body] of [
    ['task','file_content',{instruction:`Use the approved dataset. Omit this credential: ${secret}`}],
    ['code','file_content',{path:'train.py',content:`# synthetic fixture ${secret}\nprint(1)`}],
    ['acceptance','tool_result',{decisionId:newId(),resultId:newId(),status:'kept',explanation:`Validation improved. Credential: ${secret}`}],
  ]) ids.push((await f.recording.capture(meta(s,source,kind),body)).envelope.eventId);
  const context=await f.recording.project(ids,'agent',s);
  assert.equal(context.length,3); assert.deepEqual(context.map(record=>record.envelope.kind),['task','code','acceptance']);
  assert.ok(JSON.stringify(context).includes('Validation improved'));
  assert.ok(JSON.stringify(context).includes(REDACTED));
  await assertAbsent(f,ids);
});

test('replacement metadata persists its safe version relationship without duplicating current credentials', async () => {
  const f=await fixture(); const replacement=await f.credentials.replace(f.entry.id,'synthetic-version-replacement');
  const second=new CredentialService(f.vaultFiles,f.crypto,new Sanitizer()); await second.initialize();
  const items=second.list(); const old=items.find(entry=>entry.id===f.entry.id);
  assert.equal(old.supersededById,replacement.id); assert.equal(old.status,'revoked'); assert.ok(Number.isFinite(Date.parse(old.replacedAt)));
  assert.equal(items.filter(entry=>!entry.supersededById).length,1);
  const s=scope(); await assert.rejects(second.bindAdapter({component:'runpod_adapter',purpose:'inspect',accountId:old.accountId,credentialId:old.id,scope:s},async()=>true).execute(s),{code:'authentication_required'});
});
