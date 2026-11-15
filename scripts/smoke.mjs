import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
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
  const report = { packagedLaunch: 'passed', navigation: 'passed', rendererIsolation: 'passed', nativeCloseReopenQuit: 'passed', ...status };
  await writeFile('out/smoke/result.json', `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
} finally {
  if (application && child.exitCode === null) await application.close();
  await rm(userData, { recursive: true, force: true });
}
