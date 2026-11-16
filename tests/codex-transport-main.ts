import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { app, utilityProcess } from 'electron';
import { CodexStoreClient } from '../src/codex/store-client';
import { CodexFailure } from '../src/codex/errors';
import { CODEX_PROTOCOL, CODEX_VERSION, type AgentChoice, type CodexReply, type CodexStoreCommand, type CodexStoreValue } from '../src/codex/contract';
async function connect(directory: string, mode: string) {
  const child = utilityProcess.fork(path.join(__dirname, 'codex-transport-worker.cjs'), [directory, mode]);
  let connected = true;
  const client = new CodexStoreClient({ available: () => connected, post: message => child.postMessage(message) }, undefined, undefined, 1000);
  child.on('message', (message: { id?: string; codexReply?: CodexReply<CodexStoreValue> }) => {
    if (message.id && message.codexReply) client.receive(message.id, message.codexReply);
  });
  const exited = new Promise<void>(resolve => child.once('exit', () => { connected = false; client.unavailable(); resolve(); }));
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Controlled utility bootstrap failed')), 10_000);
    child.once('message', (message: { ready?: boolean }) => { clearTimeout(timer); assert.equal(message.ready, true); resolve(); });
  });
  return { client, async close() { if (connected) child.kill(); await exited; } };
}
void app.whenReady().then(async () => {
  const accessRef = randomUUID();
  const agent: AgentChoice = { integration: 'codex', provider: 'openai', authMode: 'apiKey', credentialRef: accessRef, model: 'controlled-model', effort: 'brief',
    inputModalities: ['text'], catalogObservedAt: new Date().toISOString(), runtimeVersion: CODEX_VERSION, protocolVersion: CODEX_PROTOCOL, entitlement: 'unverified' };
  for (const kind of ['default', 'run_save'] as const) for (const mode of ['timeout', 'disconnect', 'rejected_reply']) {
    const directory = path.join(app.getPath('userData'), `${kind}-${mode}`);
    // Store initialization expects an existing application directory.
    await (await import('node:fs/promises')).mkdir(directory, { recursive: true });
    const first = await connect(directory, mode);
    const requestId = randomUUID(); const projectId = randomUUID(); const choice = { model: agent.model, effort: agent.effort };
    const command: CodexStoreCommand = kind === 'default' ? { kind, requestId, choice, agent } : { kind, requestId, projectId, expectedRevision: 0, choice, agent };
    try {
      await first.client.request({ kind: 'authenticate', credentialRef: accessRef });
      await assert.rejects(first.client.request(command), error => error instanceof CodexFailure && error.effect === 'unknown');
    } finally { await first.close(); }
    const reopened = await connect(directory, 'normal');
    try {
      const receipt = await reopened.client.request({ kind: 'mutation_receipt', requestId }); assert.ok(receipt);
      assert.deepEqual(await reopened.client.request(command), receipt);
      if ('revision' in receipt) assert.equal(receipt.revision, 1);
    } finally { await reopened.close(); }
  }
  console.log('Codex actual Electron main/utility timeout, disconnect and rejected reply: 6 passed; exact durable retries, no second revision.');
  app.exit(0);
}).catch(() => { console.error('Controlled Codex main/utility transport regression failed.'); app.exit(1); });
