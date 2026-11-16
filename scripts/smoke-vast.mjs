import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';

// Actual packaged host, security service, preload and UI; HTTP alone is controlled.
// This never contacts Vast.ai or imports host credentials/subscriptions.
const executablePath = path.resolve('out/Autoresearch Lab-darwin-arm64/Autoresearch Lab.app/Contents/MacOS/Autoresearch Lab');
const profile = await mkdtemp(path.join(os.tmpdir(), 'lab-vast-smoke-40-'));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const key = 'synthetic-packaged-vast-key-40'; const session = 'synthetic-packaged-vast-session-40';
let application;
async function installHttpFixture(mode = 'populated') {
  await application.evaluate((_electron, initialMode) => {
    globalThis.vastMode = initialMode; globalThis.vastRequests = [];
    globalThis.fetch = async (input, options) => {
      const url = new URL(String(input));
      if (url.origin !== 'https://console.vast.ai' || url.pathname !== '/api/v1/instances/' || options.method !== 'GET' ||
          options.redirect !== 'error' || options.credentials !== 'omit') throw new Error('Unexpected provider request');
      globalThis.vastRequests.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), authorization: options.headers.Authorization });
      const mode = globalThis.vastMode;
      const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
      if (mode === 'invalid') return json({ message: 'synthetic-packaged-vast-key-40' }, 401);
      if (mode === 'scope') return json({}, 403);
      if (mode === 'tfa') return json({ msg: 'This endpoint requires Two Factor Authentication.', secret: 'synthetic-challenge-secret', challenge_url: 'https://untrusted.example' }, 401);
      if (mode === 'expired') return json({ msg: 'Session expired. Please log in again.' }, 404);
      if (mode === 'failure') return json({ message: 'synthetic-error-secret' }, 503);
      if (mode === 'malformed') return json({ instances: [] });
      if (mode === 'empty') return json({ instances: [], next_token: null });
      const row = id => ({ id, actual_status: 'running', intended_status: 'stopped', cur_state: 'loading', next_state: 'running',
        num_gpus: 2, gpu_name: 'RTX 4090', cpu_cores_effective: 4, disk_space: 80, label: mode === 'unsafe' ? 'synthetic-packaged-vast-key-40' : 'Synthetic rental',
        jupyter_token: 'synthetic-jupyter-secret', extra_env: [['API_KEY', 'synthetic-environment-secret']], onstart: 'synthetic-onstart-secret' });
      return url.searchParams.has('after_token') ? json({ instances: [row(170), row(171)], next_token: null }) :
        json({ instances: [row(170)], next_token: 'fixture-cursor+/' });
    };
  }, mode);
}
async function launch() {
  application = await electron.launch({ executablePath, args: [`--user-data-dir=${profile}`], env, timeout: 30_000 });
  const page = await application.firstWindow(); page.setDefaultTimeout(15_000);
  await page.getByRole('heading', { name: 'No projects yet', exact: true }).waitFor();
  await installHttpFixture(); return page;
}
async function discover(page, mode) {
  await application.evaluate((_electron, value) => { globalThis.vastMode = value; }, mode);
  await page.getByRole('button', { name: /^(Connect and discover|Refresh instances)$/ }).click();
  await page.getByRole('button', { name: /^(Connect and discover|Refresh instances)$/ }).waitFor({ state: 'visible' });
}
try {
  let page = await launch();
  await page.getByRole('button', { name: 'Compute', exact: true }).click();
  await page.getByRole('tab', { name: 'Vast.ai', exact: true }).click();
  await page.getByRole('heading', { name: 'No connected instances', exact: true }).waitFor();
  const opening = application.waitForEvent('window'); await page.getByRole('button', { name: 'Credential settings', exact: true }).click();
  const entry = await opening; entry.setDefaultTimeout(15_000);
  await entry.getByLabel('Integration', { exact: true }).selectOption('vast');
  await entry.getByLabel('Label', { exact: true }).fill('Synthetic Vast account');
  await entry.getByLabel('Credential', { exact: true }).fill(key);
  await entry.getByRole('button', { name: 'Save credential', exact: true }).click();
  await entry.getByRole('status').filter({ hasText: 'Credential saved on this Mac.' }).waitFor();
  assert.equal(await entry.getByLabel('New credential value', { exact: true }).inputValue(), '');
  await page.getByRole('button', { name: 'Reload credentials', exact: true }).click();
  await page.getByRole('option', { name: 'Synthetic Vast account', exact: true }).waitFor({ state: 'attached' });
  await discover(page, 'populated');
  await page.getByRole('heading', { name: 'Vast.ai instance 171', exact: true }).waitFor();
  assert.equal(await page.locator('.vast-instance-list > li').count(), 2);
  const body = await page.locator('body').innerText();
  for (const secret of [key, session, 'synthetic-jupyter-secret', 'synthetic-environment-secret', 'synthetic-onstart-secret']) assert.ok(!body.includes(secret));
  assert.ok(body.includes('vast:170')); assert.ok(body.includes('stopped')); assert.ok(body.includes('loading')); assert.ok(body.includes('Not verified'));
  const requests = await application.evaluate(() => globalThis.vastRequests);
  assert.equal(requests.length, 2); assert.equal(requests[0].query.limit, '25'); assert.equal(requests[1].query.after_token, 'fixture-cursor+/');
  assert.ok(!JSON.parse(requests[0].query.select_cols).includes('jupyter_token'));
  assert.equal(requests[0].authorization, `Bearer ${key}`);
  for (const [mode, message] of [['invalid', 'rejected this API key'], ['scope', 'instance_read permission'], ['failure', 'discovery failed'],
    ['malformed', 'incomplete or unsupported response'], ['unsafe', 'could not be safely displayed'], ['tfa', 'requires two-factor authentication']]) {
    await discover(page, mode);
    await page.getByRole('alert').filter({ hasText: message }).waitFor();
    assert.equal(await page.locator('.vast-instance-list > li').count(), 2);
    assert.ok((await page.getByRole('status').innerText()).includes('stale'));
    assert.ok(!(await page.locator('body').innerText()).includes(key));
  }
  await entry.getByText('Vast.ai two-factor session', { exact: true }).click();
  await entry.getByLabel('Provider-issued session credential', { exact: true }).fill(session);
  await entry.getByRole('button', { name: 'Use session for Vast discovery', exact: true }).click();
  await entry.getByRole('status').filter({ hasText: 'Vast session available until expiry or app restart.' }).waitFor();
  assert.equal(await entry.getByLabel('Provider-issued session credential', { exact: true }).inputValue(), '');
  await discover(page, 'populated'); await page.getByText('Discovery complete.', { exact: false }).waitFor();
  assert.equal(await application.evaluate(() => globalThis.vastRequests.at(-1).authorization), `Bearer ${session}`);
  await discover(page, 'expired'); await page.getByRole('alert').filter({ hasText: 'session expired' }).waitFor();
  await discover(page, 'empty'); await page.getByRole('heading', { name: 'No running Vast.ai instances', exact: true }).waitFor();
  assert.equal(await page.locator('.vast-instance-list > li').count(), 0);
  await discover(page, 'failure'); await page.getByRole('alert').filter({ hasText: 'discovery failed' }).waitFor();
  await page.getByRole('heading', { name: 'Last scan found no running instances', exact: true }).waitFor();
  // Leave an active session at exit to prove restart does not restore it.
  await entry.getByLabel('Provider-issued session credential', { exact: true }).fill(session);
  await entry.getByRole('button', { name: 'Use session for Vast discovery', exact: true }).click();
  await entry.getByRole('status').filter({ hasText: 'Vast session available until expiry or app restart.' }).waitFor();
  // Sender-specific IPC, not merely an absent preload method, enforces the account boundary.
  const denied = await application.evaluate(async ({ BrowserWindow }) => {
    const probe = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false } });
    try {
      await probe.loadURL('data:text/html,<html></html>');
      return await probe.webContents.executeJavaScript(`Promise.all(['vast:credentials','vast:discover','vast:settings','credentials:vast-session'].map(channel => require('electron').ipcRenderer.invoke(channel, {}).then(reply => reply?.ok === false, () => true)))`);
    } finally { probe.destroy(); }
  });
  assert.ok(denied.every(Boolean));
  const vaultPath = path.join(profile, 'private-credentials/credentials.vault');
  assert.ok(!(await readFile(vaultPath)).includes(Buffer.from(key)));
  const vaultHasSession = await application.evaluate(async ({ safeStorage }, ciphertext) =>
    (await safeStorage.decryptStringAsync(Buffer.from(ciphertext))).result.includes('synthetic-packaged-vast-session-40'), Array.from(await readFile(vaultPath)));
  assert.equal(vaultHasSession, false);
  assert.deepEqual(await readdir(path.join(profile, 'admitted-records')), []);
  await application.close();
  page = await launch();
  await page.getByRole('button', { name: 'Compute', exact: true }).click();
  await page.getByRole('tab', { name: 'Vast.ai', exact: true }).click();
  await page.getByRole('option', { name: 'Synthetic Vast account', exact: true }).waitFor({ state: 'attached' });
  await discover(page, 'populated'); await page.getByRole('heading', { name: 'Vast.ai instance 170', exact: true }).waitFor();
  assert.equal(await application.evaluate(() => globalThis.vastRequests[0].authorization), `Bearer ${key}`);
  await application.close(); application = undefined;
  const report = { vastPackagedDiscovery: 'passed', completePagination: 'passed', stateSeparation: 'passed', emptyAndStale: 'passed',
    credentialFailureFeedback: 'passed', memoryOnlySession: 'passed', providerSecretExclusion: 'passed', credentialRestart: 'passed', ipcAuthorization: 'passed',
    qualification: 'Synthetic HTTP fixtures through the packaged application; no live Vast.ai account or rental accessed.' };
  await writeFile('out/smoke/vast-result.json', JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
} finally {
  if (application) await application.close();
  await rm(profile, { recursive: true, force: true });
}
