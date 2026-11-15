import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const executablePath = path.resolve('out/Autoresearch Lab-darwin-arm64/Autoresearch Lab.app/Contents/MacOS/Autoresearch Lab');
const userData = await mkdtemp(path.join(os.tmpdir(), 'autoresearch-lab-smoke-'));
// Some coding hosts export this for their own Node subprocesses.
const launchEnv = { ...process.env };
delete launchEnv.ELECTRON_RUN_AS_NODE;
let application;
let child;
try {
  application = await electron.launch({ executablePath, args: [`--user-data-dir=${userData}`], env: launchEnv, timeout: 30_000 });
  child = application.process();
  const page = await application.firstWindow();
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(15_000);
  page.on('console', (message) => { if (message.type() === 'error') console.error(message.text()); });
  const rendererErrors = [];
  page.on('pageerror', (error) => { rendererErrors.push(error.message); console.error(error.message); });
  page.on('requestfailed', (request) => console.error(request.url(), request.failure()));

  await page.getByRole('status').filter({ hasText: 'Workspace ready' }).waitFor();
  for (const [name, heading] of [['Projects', 'No projects yet'], ['Runs', 'No runs yet'], ['Compute', 'No connected instances']]) {
    await page.getByRole('button', { name, exact: true }).click();
    await page.getByRole('heading', { name: heading, exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name, exact: true }).getAttribute('aria-current'), 'page');
  }
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  const status = await page.evaluate(() => window.lab.getStatus());
  assert.equal(status.coordinator, 'ready');
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  assert.equal(await page.evaluate(() => typeof window.process), 'undefined');
  const preferences = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
  assert.equal(preferences.sandbox, true);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.nodeIntegration, false);
  assert.deepEqual(rendererErrors, []);
  // Ordinary renderer cannot read or enter credentials through its bridge.
  assert.equal(await page.evaluate(() => typeof window.credentialEntry), 'undefined');
  const entryOpening = application.waitForEvent('window');
  await application.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu().getMenuItemById('credential-settings');
    item.click();
  });
  const entryPage = await entryOpening;
  await application.evaluate(({ shell }) => {
    globalThis.evidenceDocLinks = [];
    globalThis.originalOpenExternal = shell.openExternal;
    shell.openExternal = async url => { globalThis.evidenceDocLinks.push(url); };
  });
  await entryPage.getByRole('link', { name: /Manage or revoke at Runpod/ }).click();
  assert.deepEqual(await application.evaluate(() => globalThis.evidenceDocLinks), ['https://console.runpod.io/user/credentials']);
  const invalidHelp = await entryPage.evaluate(() => window.credentialEntry.help('https://untrusted.example'));
  assert.equal(invalidHelp.ok, false);
  await application.evaluate(({ shell }) => { shell.openExternal = globalThis.originalOpenExternal; });
  const synthetic = 'synthetic-packaged-vault-check-4d7a';
  await entryPage.getByLabel('Label', { exact: true }).fill('Packaged synthetic check');
  await entryPage.getByLabel('Credential', { exact: true }).fill(synthetic);
  await entryPage.getByRole('button', { name: 'Show entered value', exact: true }).click();
  assert.equal(await entryPage.getByLabel('Credential', { exact: true }).getAttribute('type'), 'text');
  await entryPage.evaluate(() => window.dispatchEvent(new Event('blur')));
  await entryPage.waitForFunction(() => document.querySelector('#credential').type === 'password');
  await entryPage.getByRole('button', { name: 'Save credential', exact: true }).click();
  await entryPage.getByRole('status').filter({ hasText: 'Credential saved on this Mac.' }).waitFor();
  await entryPage.getByRole('heading', { name: 'Manage credential', exact: true }).waitFor();
  assert.equal(await entryPage.getByLabel('New credential value', { exact: true }).inputValue(), '');
  assert.ok(!(await entryPage.locator('body').innerText()).includes(synthetic));
  await entryPage.getByRole('button', { name: 'Replace credential', exact: true }).click();
  await entryPage.getByRole('alert').filter({ hasText: 'Enter a credential value before saving.' }).waitFor();
  await entryPage.getByRole('button', { name: 'Add credential', exact: true }).click();
  await entryPage.getByLabel('Integration', { exact: true }).selectOption('anthropic');
  await entryPage.getByLabel('Label', { exact: true }).fill('Synthetic Claude access');
  await entryPage.getByLabel('Credential', { exact: true }).fill('synthetic-second-integration-check');
  await entryPage.getByRole('button', { name: 'Save credential', exact: true }).click();
  await entryPage.getByRole('heading', { name: 'Manage credential', exact: true }).waitFor();
  const credentialOrder = await entryPage.locator('.credential-list .row-copy > strong').allTextContents();
  await entryPage.getByRole('button', { name: /Packaged synthetic check Runpod/ }).click();
  assert.equal(await entryPage.getByTestId('saved-integration').textContent(), 'Runpod');
  assert.equal(await entryPage.getByTestId('saved-label').textContent(), 'Packaged synthetic check');
  await entryPage.getByRole('button', { name: 'Revoke access…', exact: true }).click();
  assert.equal(await entryPage.getByRole('button', { name: 'Cancel', exact: true }).evaluate(element => element === document.activeElement), true);
  await entryPage.keyboard.press('Escape');
  await entryPage.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(await entryPage.getByRole('button', { name: 'Revoke access…', exact: true }).evaluate(element => element === document.activeElement), true);
  await entryPage.getByRole('button', { name: 'Revoke access…', exact: true }).click();
  await entryPage.getByRole('button', { name: 'Cancel', exact: true }).click();
  await entryPage.getByRole('button', { name: 'Revoke access…', exact: true }).click();
  await entryPage.getByRole('button', { name: 'Revoke app access', exact: true }).click();
  await entryPage.getByRole('status').filter({ hasText: 'App access revoked.' }).waitFor();
  assert.equal(await entryPage.getByRole('button', { name: 'Revoke access…', exact: true }).count(), 0);
  await entryPage.getByLabel('New credential value', { exact: true }).fill('synthetic-replacement-integration-check');
  await entryPage.getByRole('button', { name: 'Save and restore app access', exact: true }).click();
  await entryPage.getByRole('status').filter({ hasText: 'Replacement saved.' }).waitFor();
  assert.equal(await entryPage.locator('.credential-list > li').count(), 2);
  assert.deepEqual(await entryPage.locator('.credential-list .row-copy > strong').allTextContents(), credentialOrder);
  await entryPage.getByRole('button', { name: /^View previous versions/ }).click();
  await entryPage.getByRole('dialog', { name: 'Previous credential versions' }).waitFor();
  await entryPage.getByRole('button', { name: 'Close history', exact: true }).click();
  assert.equal(await entryPage.getByLabel('New credential value', { exact: true }).inputValue(), '');
  const vaultBytes = await readFile(path.join(userData, 'private-credentials', 'credentials.vault'));
  assert.ok(!vaultBytes.includes(Buffer.from(synthetic)));
  const vaultPath = path.join(userData, 'private-credentials', 'credentials.vault');
  const validVault = await readFile(vaultPath);
  await writeFile(vaultPath, 'synthetic-storage-fault');
  await entryPage.getByRole('button', { name: 'Refresh', exact: true }).click();
  await entryPage.getByRole('button', { name: 'Retry credential storage', exact: true }).waitFor();
  assert.equal(await entryPage.getByLabel('New credential value', { exact: true }).isDisabled(), true);
  await writeFile(vaultPath, validVault);
  await entryPage.getByRole('button', { name: 'Retry credential storage', exact: true }).click();
  await entryPage.waitForFunction(() => !document.querySelector('#credential').matches(':disabled'));
  assert.equal(await entryPage.getByRole('alert').count(), 0);
  // Internal protocol capabilities are outside the credential-entry component's boundary.
  const controlId = randomUUID();
  const injectedVault = await application.evaluate(async ({ safeStorage }, input) => {
    const data = JSON.parse((await safeStorage.decryptStringAsync(Buffer.from(input.ciphertext))).result);
    data.entries.push(input.entry);
    return Array.from(await safeStorage.encryptStringAsync(JSON.stringify(data)));
  }, { ciphertext: Array.from(await readFile(vaultPath)), entry: { id: controlId, accountId: randomUUID(), category: 'control', label: 'Synthetic protocol capability', status: 'active', value: 'synthetic-internal-control-fixture' } });
  await writeFile(vaultPath, Buffer.from(injectedVault));
  await entryPage.getByRole('button', { name: 'Refresh', exact: true }).click();
  await entryPage.waitForFunction(() => !document.querySelector('#credential').matches(':disabled'));
  assert.equal(await entryPage.getByText('Synthetic protocol capability', { exact: true }).count(), 0);
  assert.equal((await entryPage.evaluate(id => window.credentialEntry.replace(id, 'synthetic-denied-replacement'), controlId)).ok, false);
  assert.equal((await entryPage.evaluate(id => window.credentialEntry.revoke(id), controlId)).ok, false);
  // A separate renderer with IPC access still cannot impersonate credential-entry.
  const unauthorized = await application.evaluate(async ({ BrowserWindow }) => {
    const probe = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false } });
    try {
      await probe.loadURL('data:text/html,<html></html>');
      return await probe.webContents.executeJavaScript(`require('electron').ipcRenderer.invoke('credentials:register', {category:'openai',label:'probe',value:'synthetic-probe-value'})`);
    } finally { probe.destroy(); }
  });
  assert.equal(unauthorized.ok, false);
  await entryPage.close();
  await mkdir('out/smoke', { recursive: true });
  await page.screenshot({ path: 'out/smoke/workspace.png' });
  // Exercise the native close path, then macOS activation/reopen, then normal quit.
  const closing = page.waitForEvent('close');
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await closing;
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 0);
  const reopening = application.waitForEvent('window');
  await application.evaluate(({ app }) => app.emit('activate'));
  const reopened = await reopening;
  await reopened.getByRole('heading', { name: 'No projects yet', exact: true }).waitFor();
  await application.close();
  assert.equal(child.exitCode, 0);
  const report = { packagedLaunch: 'passed', navigation: 'passed', rendererIsolation: 'passed', nativeCloseReopenQuit: 'passed', keychainVaultAndEntryIsolation: 'passed', ...status };
  await writeFile('out/smoke/result.json', `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
} finally {
  if (application && child.exitCode === null) await application.close();
  await rm(userData, { recursive: true, force: true });
}
