import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import webpack from 'webpack';
import ts from 'typescript';
import { _electron as electron } from 'playwright';
import config from '../webpack.stabilization-native.config.cjs';

// Real application routes, vault, utility, stores, preload and renderer. Only
// external HTTPS/subprocesses, notifications and acknowledgement loss are controlled.
await new Promise((resolve, reject) => {
  const compiler = webpack(config);
  compiler.run((error, stats) => { compiler.close(() => {}); if (error || stats.hasErrors()) reject(error ?? new Error(stats.toString({ all: false, errors: true }))); else resolve(); });
});
const bundle = path.resolve('.webpack/stabilization-native');
for (const [name, script] of [['main', 'renderer'], ['credential', 'credential']]) {
  await writeFile(path.join(bundle, `${name}.html`), `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'"><title>${name === 'main' ? 'Autoresearch Lab' : 'Credential settings'}</title></head><body><div id="root"></div><script src="${script}.js"></script></body></html>`);
}
await writeFile(path.join(bundle, 'bootstrap.cjs'), `require('electron').app.setAppPath(${JSON.stringify(process.cwd())}); require('./main.cjs');`);
const directory = await mkdtemp(path.join(os.tmpdir(), 'lab-stabilization-native-'));
const fixture = path.join(directory, 'codex.cjs');
await writeFile(fixture, ts.transpileModule(await readFile('tests/codex-fixture.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);
const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
const failures = [], results = [];
let application;
async function launch(name) {
  application = await electron.launch({ args: [path.join(bundle, 'bootstrap.cjs'), `--user-data-dir=${path.join(directory, name)}`], env: environment });
  const page = await application.firstWindow(); page.setDefaultTimeout(15000);
  await page.getByRole('heading', { name: 'Your research projects', exact: true }).waitFor();
  return page;
}
async function entry(button) {
  const opening = application.waitForEvent('window'); await button.click(); const pageEntry = await opening;
  await pageEntry.getByRole('heading', { name: 'Credential settings', exact: true }).waitFor(); return pageEntry;
}
async function save(entryPage, category, label, value) {
  await entryPage.getByRole('button', { name: 'Add credential', exact: false }).click();
  await entryPage.getByLabel('Integration', { exact: true }).selectOption(category);
  await entryPage.getByLabel('Label', { exact: true }).fill(label);
  await entryPage.getByLabel('Credential', { exact: true }).fill(value);
  await entryPage.getByRole('button', { name: 'Save credential', exact: true }).click();
  await entryPage.getByRole('button', { name: new RegExp(label) }).waitFor();
}
try {
  try {
    const page = await launch('rejected');
    await page.getByRole('button', { name: 'Compute', exact: true }).click();
    const credential = await entry(page.getByRole('button', { name: 'Credential settings', exact: true }));
    await save(credential, 'runpod', 'Native Runpod', 'synthetic-native-runpod-key');
    await application.evaluate(({ ipcMain }) => {
      const https = process.getBuiltinModule('node:https');
      const { EventEmitter } = process.getBuiltinModule('node:events');
      const { PassThrough } = process.getBuiltinModule('node:stream');
      globalThis.holdDiscovery = false; globalThis.discoveryHeld = false; globalThis.discoverySettled = false; globalThis.discoveryRejected = false;
      https.request = (url, options, callback) => {
        if (url.origin !== 'https://api.runpod.io' || options.method !== 'GET') throw new Error('Unexpected native transport');
        const request = new EventEmitter();
        request.end = () => queueMicrotask(() => {
          const finish = () => {
            const response = new PassThrough(); response.statusCode = 200; response.headers = { 'content-type': 'application/json' };
            callback(response); response.end(JSON.stringify(url.pathname === '/v2/account' ? { id: 'native-account' } : { pods: [{ id: 'native-pod-metadata', status: 'RUNNING', gpu: { id: 'NVIDIA RTX 4090', count: 1, memory: 64, vcpuCount: 8 } }], pagination: { nextCursor: null, hasNextPage: false } }));
          };
          if (globalThis.holdDiscovery && url.pathname === '/v2/pods') { globalThis.discoveryHeld = true; globalThis.releaseDiscovery = finish; } else finish();
        }); return request;
      };
      const original = ipcMain._invokeHandlers.get('runpod:discover');
      ipcMain.removeHandler('runpod:discover'); ipcMain.handle('runpod:discover', async (...args) => {
        try { return await original(...args); } catch (error) { globalThis.discoveryRejected = true; throw error; }
        finally { globalThis.discoverySettled = true; }
      });
    });
    await page.getByRole('button', { name: 'Refresh credentials', exact: true }).click();
    await page.getByRole('button', { name: 'Connect and discover', exact: true }).click();
    await page.getByRole('heading', { name: 'Pod native-pod-metadata', exact: true }).waitFor();
    await application.evaluate(({ BrowserWindow }) => {
      globalThis.holdDiscovery = true; globalThis.discoverySettled = false;
      const contents = BrowserWindow.getAllWindows().find(window => window.getTitle() === 'Autoresearch Lab').webContents;
      const original = contents.send; contents.send = function(channel, ...args) { if (channel !== 'configuration:invalidate') return original.call(this, channel, ...args); };
    });
    await page.getByRole('button', { name: 'Refresh Pods', exact: true }).click();
    await application.evaluate(async () => { const deadline = Date.now() + 5000; while (!globalThis.discoveryHeld) { if (Date.now() > deadline) throw new Error('Native discovery did not reach held HTTPS response'); await new Promise(resolve => setTimeout(resolve, 5)); } });
    await save(credential, 'model_download', 'Recognized native metadata', 'native-pod-metadata');
    await application.evaluate(() => globalThis.releaseDiscovery());
    await page.waitForFunction(() => document.querySelector('section.compute')?.getAttribute('aria-busy') === 'false');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await application.evaluate(() => globalThis.discoveryRejected && globalThis.discoverySettled), true, 'real native handler rejected after matching changed');
    assert.equal(await page.getByRole('heading', { name: 'Pod native-pod-metadata', exact: true }).count(), 0, 'rejected native response must clear metadata without an unrelated barrier');
    results.push('F02 native rejected response invalidates without another metadata call');
  } catch (error) { failures.push(`F02: ${error.message}`); console.log('F02 native state', await application?.windows()[0]?.locator('body').innerText()); }
  finally { await application?.close(); application = undefined; }
  try {
    const page = await launch('unmounted');
    await application.evaluate((_electron, input) => {
      const child = process.getBuiltinModule('node:child_process'), original = child.spawn;
      child.spawn = (executable, args, options) => executable.endsWith('/bin/codex') ? original(input.node, [input.fixture], options) : original(executable, args, options);
    }, { node: process.execPath, fixture });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const credential = await entry(page.getByRole('region', { name: 'Codex settings', exact: true }).getByRole('button', { name: 'Manage API keys', exact: true }));
    await save(credential, 'openai', 'Native OpenAI', 'synthetic-native-openai-key');
    await page.getByRole('button', { name: 'Refresh saved keys', exact: true }).click();
    await page.getByLabel('OpenAI credential', { exact: true }).selectOption({ label: 'Native OpenAI (active)' });
    await page.getByRole('button', { name: 'Authenticate and load models', exact: true }).click();
    await page.getByLabel('Codex model', { exact: true }).selectOption('fixture-second');
    await page.getByLabel('Reasoning effort', { exact: true }).selectOption('deep');
    await application.evaluate(({ ipcMain }) => {
      globalThis.nativeDefaultCalls = []; globalThis.nativeReconcileCalls = [];
      const original = ipcMain._invokeHandlers.get('codex:default');
      ipcMain.removeHandler('codex:default'); ipcMain.handle('codex:default', async (event, choice, requestId) => {
        globalThis.nativeDefaultCalls.push({ requestId, recognizedPayload: choice.model === 'fixture-second' });
        const reply = await original(event, choice, requestId);
        return { metadataGeneration: reply.metadataGeneration, ok: false, error: { code: 'unavailable', origin: 'codex_auth', operationId: requestId, message: 'Native acknowledgement withheld.', effect: 'unknown', retry: 'same_key' } };
      });
    });
    await page.getByRole('button', { name: 'Save default model', exact: true }).click();
    await page.getByText('unavailable: Native acknowledgement withheld.', { exact: true }).waitFor();
    const requestId = await page.evaluate(() => localStorage.getItem('codex-save:default')); assert.ok(requestId);
    await page.getByRole('button', { name: 'Compute', exact: true }).click();
    await save(credential, 'model_download', 'Recognized model payload', 'fixture-second');
    await application.evaluate(({ ipcMain }) => {
      const original = ipcMain._invokeHandlers.get('codex:reconcile-save');
      ipcMain.removeHandler('codex:reconcile-save'); ipcMain.handle('codex:reconcile-save', async (event, requestId) => {
        globalThis.nativeReconcileCalls.push(requestId); const reply = await original(event, requestId);
        return { metadataGeneration: reply.metadataGeneration, ok: false, error: { code: 'unavailable', origin: 'codex_auth', operationId: requestId, message: 'Native reconciliation temporarily unavailable.', effect: 'unknown', retry: 'same_key' } };
      });
    });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByText('unavailable: Native reconciliation temporarily unavailable.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Reconcile default save', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Codex settings"]')?.getAttribute('aria-busy') === 'false');
    const calls = await application.evaluate(() => ({ defaults: globalThis.nativeDefaultCalls, reconciles: globalThis.nativeReconcileCalls }));
    assert.equal(calls.defaults.length, 1, 'unmounted Codex pending cache must never redispatch recognized model payload');
    assert.deepEqual(calls.reconciles, [requestId, requestId], 'opaque pending identity survives unmount and failed reconciliation');
    assert.equal(await page.evaluate(() => localStorage.getItem('codex-save:default')), requestId);
    results.push('F04 native route unmount retains only reconciliation identity');
  } catch (error) { failures.push(`F04: ${error.message}`); console.log('F04 native state', await application?.windows()[0]?.locator('body').innerText()); }
  finally { await application?.close(); application = undefined; }
  console.log(JSON.stringify({ results, failures, qualification: 'Actual production native routes; synthetic transport/ack fixtures only' }, null, 2));
  assert.deepEqual(failures, []);
} finally { await application?.close(); await rm(directory, { recursive: true, force: true }); }
