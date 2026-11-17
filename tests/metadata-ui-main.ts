import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { CredentialService } from '../src/security/credentials';
import { PrivateFiles } from '../src/security/private-files';
import { Sanitizer } from '../src/security/sanitizer';

// Real production renderer/preload and actual credential matching. Domain reads
// are controlled projections: no network, inference or dataset mutation here.
const projectId = '00000000-0000-4000-8000-000000000001';
const credentialId = '00000000-0000-4000-8000-000000000002';
const token = 'claude-metadata-policy-fixture-20261116';
const date = new Date().toISOString();
const project = { projectId, name: 'Metadata fixture', location: '/controlled/project', repository: '/controlled/project/.git', createdAt: date };
let window: BrowserWindow;
let matcher: Sanitizer;
let credentials: CredentialService;
let denied = false, held = '', serial = 0, drop = false;
let heldReply: (() => void) | undefined;
let admitted = 0;
let mutations: { channel: string; requestId: string }[] = [], reconciliations: string[] = [];
const available = (value: string | number) => ({ availability: 'available', value });
const error = { code: 'capture_failed', reason: 'capture_failed', origin: 'fixture', operationId: projectId, message: 'Metadata is withheld by credential protection.', effect: 'none', retry: 'never' };
const agent = { integration: 'codex', provider: 'openai', authMode: 'apiKey', credentialRef: credentialId, model: token, effort: 'deep', inputModalities: ['text'], catalogObservedAt: date, runtimeVersion: '0.169.0', protocolVersion: 'codex-auth/1', entitlement: 'unverified' };
const claudeChoice = { integration: 'claude', credentialId, modelId: token };
const catalog = { source: 'codex_app_server', observedAt: date, complete: true, models: [{ model: token, displayName: token, efforts: ['deep'], defaultEffort: 'deep', inputModalities: ['text'] }], runtimeVersion: '0.169.0', protocolVersion: 'codex-auth/1', entitlement: 'unverified' };
function body(channel: string): unknown {
  if (denied && !channel.endsWith(':recovery') && channel !== 'runpod:credentials' && channel !== 'vast:credentials') {
    if (channel.startsWith('runpod:')) return { complete: false, items: [], error, pages: 0, receivedAt: date };
    return { ok: false, error: channel.startsWith('vast:') ? { ...error, reason: 'unsafe_response' } : error };
  }
  if (channel === 'runpod:credentials') return { ok: true, credentials: [{ id: credentialId, label: 'Controlled Runpod access' }] };
  if (channel === 'runpod:discover') return { complete: true, accountId: 'controlled-account', items: [{ identity: { provider: 'runpod', resourceId: token }, reportedState: 'RUNNING', allocation: { gpuCount: 1, gpuType: 'Controlled GPU' }, capabilities: [] }], pages: 1, receivedAt: date };
  if (channel === 'runpod:inspect') return { ok: true, instance: { identity: { provider: 'runpod', resourceId: token }, reportedState: 'RUNNING', capabilities: [], receivedAt: date } };
  if (channel === 'vast:credentials') return { ok: true, value: [{ id: credentialId, label: 'Controlled Vast access' }] };
  if (channel === 'vast:discover') return { ok: true, value: { receivedAt: date, instances: [{ resourceId: '170', canonicalKey: 'vast:170', label: available(token), actualState: available('running'), intendedState: available('running'), contractState: available('active'), nextContractState: available('none'), hardware: { gpuCount: available(1), gpuModel: available('Controlled GPU'), effectiveCpuCores: available(4), diskGb: available(10) } }] } };
  if (channel === 'codex:settings') return { ok: true, value: { settings: { credentialRef: credentialId, defaultAgent: agent }, credentials: [{ id: credentialId, label: 'Controlled OpenAI access', status: 'active' }], diagnostics: [] } };
  if (channel === 'codex:models' || channel === 'codex:authenticate') return { ok: true, value: catalog };
  if (channel === 'codex:run-get') return { ok: true, value: { agent, revision: 1, projectId, snapshotId: projectId, createdAt: date } };
  if (channel === 'codex:recovery') return { ok: true, value: { credentialRef: credentialId, credentials: [{ id: credentialId, label: 'Controlled OpenAI access', status: 'active' }], selection: { revision: 1, projectId, snapshotId: projectId } } };
  if (channel === 'claude:settings') return { ok: true, value: { selection: { ...claudeChoice, revision: 1 }, credentials: [{ id: credentialId, label: 'Controlled Anthropic access', status: 'active' }] } };
  if (channel === 'claude:recovery') return { ok: true, value: { revision: 1, credentials: [{ id: credentialId, label: 'Controlled Anthropic access', status: 'active' }] } };
  if (channel === 'claude:discover') return { ok: true, value: { credentialId, observedAt: date, complete: true, models: [{ id: token, lifecycle: 'active' }] } };
  if (channel === 'claude:runs') return { ok: true, value: [{ ...claudeChoice, snapshotId: projectId, runId: projectId, createdAt: date }] };
  if (channel === 'imports:list') return { ok: true, value: [{ importId: projectId, destination: token, state: 'complete', mode: 'copy', bytesUsable: true, completedFiles: 1, totalFiles: 1, completedBytes: 1, totalBytes: 1, failedFiles: 0 }] };
  throw new Error('Unexpected fixture route');
}
async function open(mode: string) {
  for (const current of BrowserWindow.getAllWindows()) current.destroy();
  denied = false; held = ''; heldReply = undefined; admitted = 0; drop = false; mutations = []; reconciliations = [];
  matcher = new Sanitizer();
  const key = randomBytes(32), directory = path.join(app.getPath('userData'), `fixture-${++serial}`);
  credentials = new CredentialService(new PrivateFiles(directory), {
    available: async () => true,
    encrypt: async text => { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); return Buffer.concat([iv, cipher.update(text), cipher.final(), cipher.getAuthTag()]); },
    decrypt: async bytes => { const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); decipher.setAuthTag(bytes.subarray(-16)); return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString(); },
  }, matcher);
  await credentials.initialize();
  // The generation travels on both notifications and replies. Holding a reply
  // after admission models an already prepared/in-transit native IPC response.
  matcher.onMatchingPolicyChanged(() => { if (!drop) window.webContents.send('configuration:invalidate', matcher.matchingGeneration); });
  window = new BrowserWindow({ width: 1200, height: 1000, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await window.loadFile(path.join(__dirname, 'index.html'), { query: { mode } });
}
app.whenReady().then(async () => {
  ipcMain.handle('metadata:revision', () => matcher.matchingGeneration);
  ipcMain.handle('metadata:ready', () => matcher.matchingGeneration);
  for (const channel of ['runpod:credentials', 'runpod:discover', 'runpod:inspect', 'vast:credentials', 'vast:discover', 'codex:settings', 'codex:models', 'codex:authenticate', 'codex:run-get', 'codex:recovery', 'claude:settings', 'claude:recovery', 'claude:discover', 'claude:runs', 'imports:list', 'codex:default', 'codex:run-save', 'codex:reconcile-save', 'claude:save', 'claude:save-run']) {
    ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
      let value;
      if (channel === 'codex:reconcile-save') { reconciliations.push(args[0] as string); value = { ok: true, value: { requestId: args[0], state: 'withheld', selection: null } }; }
      else if (['codex:default', 'codex:run-save', 'claude:save', 'claude:save-run'].includes(channel)) {
        const requestId = channel === 'codex:default' ? args[1] : channel === 'codex:run-save' ? args[3] : channel === 'claude:save' ? args[2] : (args[0] as { snapshotId: string }).snapshotId;
        mutations.push({ channel, requestId: requestId as string });
        value = { ok: true, value: channel === 'codex:default' ? agent : channel === 'codex:run-save' ? { agent, revision: 2, projectId, snapshotId: projectId } : { ...claudeChoice, revision: 2, snapshotId: projectId, runId: projectId, createdAt: date } };
      } else value = body(channel);
      const metadataGeneration = matcher.matchingGeneration;
      if (channel === held) { admitted++; await new Promise<void>(resolve => { heldReply = resolve; }); }
      return { ...value as object, metadataGeneration };
    });
  }
  ipcMain.handle('projects:list', () => ({ ok: true, value: { projects: [{ project, availability: 'ready' }] } }));
  Object.assign(globalThis, { metadataFixture: {
    open,
    recognize: async () => { await credentials.register('model_download', projectId, 'Controlled later material', token); denied = true; },
    hold: (channel: string, dropNotifications = false) => { held = channel; drop = dropNotifications; },
    admitted: () => admitted,
    mutations: () => mutations,
    reconciliations: () => reconciliations,
    release: () => { heldReply?.(); heldReply = undefined; held = ''; },
  } });
  await mkdir(__dirname, { recursive: true });
  await writeFile(path.join(__dirname, 'index.html'), '<!doctype html><div id="root"></div><script src="renderer.js"></script>');
  await open('runpod');
});
app.on('window-all-closed', () => { /* The test owns the app and opens the next isolated case. */ });
