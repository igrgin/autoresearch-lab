// Controlled stdio App Server fixture. No service requests or real credentials.
import { createInterface } from 'node:readline';
let initialized = false; let key = '';
const mode = process.env.CODEX_FIXTURE_MODE;
const model = (name: string) => ({ id: `catalog-${name}`, model: name, displayName: name, hidden: false,
  supportedReasoningEfforts: [{ reasoningEffort: 'brief' }, { reasoningEffort: 'deep' }], defaultReasoningEffort: 'brief', inputModalities: ['text'] });
function send(message: unknown) { process.stdout.write(JSON.stringify(message) + '\n'); }
createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (request.method === 'initialized') { initialized = true; return; }
  if (mode === 'hung' && request.method !== 'initialize') return;
  if (request.method === 'initialize') { send({ id: request.id, result: { userAgent: 'controlled-fixture' } }); return; }
  if (!initialized) { send({ id: request.id, error: { code: -32600, message: 'not initialized' } }); return; }
  if (request.method === 'config/read') {
    send({ id: request.id, result: { config: { cli_auth_credentials_store: mode === 'unsafe-storage' ? 'file' : 'ephemeral', model_provider: 'openai', forced_login_method: 'api' },
      layers: mode === 'inherited-config' ? [{ name: { type: 'system' }, config: { unapproved_override: true } }] : [] } }); return;
  }
  if (request.method === 'account/login/start') {
    key = request.params.apiKey;
    process.stderr.write(`Excluded synthetic auth diagnostic: ${key}\n`);
    send({ method: 'account/login/completed', params: { success: true, error: key } });
    if (mode === 'unauthorized' || mode === 'quota') send({ id: request.id, error: { code: -32000, message: mode === 'quota' ? `429 quota ${key}` : `403 unauthorized ${key}` } });
    else send({ id: request.id, result: { type: 'apiKey' } });
  } else if (request.method === 'account/read') send({ id: request.id, result: { account: mode === 'logged-out' ? null : { type: 'apiKey' }, requiresOpenaiAuth: true } });
  else if (request.method === 'model/list') {
    if (mode === 'malformed') { process.stdout.write('invalid json\n'); return; }
    if (mode === 'oversized') { process.stdout.write('x'.repeat(3 * 1024 * 1024)); return; }
    if (mode === 'secret-model') { send({ id: request.id, result: { data: [model(key)], nextCursor: null } }); return; }
    const next = request.params.cursor;
    const response = { id: request.id, result: { data: next ? (mode === 'removed' ? [] : [model('fixture-second')]) : [model('fixture-first'), { ...model('hidden'), hidden: true }], nextCursor: next && mode !== 'cursor-loop' ? null : 'page-two' } };
    // Deliberately split a complete UTF-8 record across separate writes.
    const bytes = Buffer.from(JSON.stringify(response) + '\n'); process.stdout.write(bytes.subarray(0, 13)); process.stdout.write(bytes.subarray(13));
  }
});
