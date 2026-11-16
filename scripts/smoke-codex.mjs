import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir, mkdir, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { _electron as electron } from 'playwright';

const executablePath = path.resolve('out/Autoresearch Lab-darwin-arm64/Autoresearch Lab.app/Contents/MacOS/Autoresearch Lab');
const directory = await mkdtemp(path.join(os.tmpdir(), 'lab-codex-ui-'));
const userData = path.join(directory, 'profile');
const fixturePath = path.join(directory, 'fixture.cjs');
await writeFile(fixturePath, ts.transpileModule(await readFile('tests/codex-fixture.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);
const launchEnv = { ...process.env }; delete launchEnv.ELECTRON_RUN_AS_NODE;
let application;
const synthetic = 'synthetic-packaged-codex-key-45';
const errors = [];
async function launch() {
  application = await electron.launch({ executablePath, args: [`--user-data-dir=${userData}`], env: launchEnv });
  const page = await application.firstWindow(); page.setDefaultTimeout(15_000);
  page.on('pageerror', error => errors.push(error.message));
  // Replace only the subprocess in the test's privileged Playwright context.
  // Production hash verification, IPC, auth RPC transport, vault and SQLite remain exercised.
  await application.evaluate((_electron, fixture) => {
    const childProcess = process.getBuiltinModule('child_process');
    const original = childProcess.spawn;
    globalThis.codexFixtureMode = '';
    globalThis.codexLaunches = [];
    childProcess.spawn = (executable, args, options) => {
      if (!executable.endsWith('/Resources/codex')) return original(executable, args, options);
      globalThis.codexLaunches.push({ args, env: options.env, cwd: options.cwd });
      return original(fixture.node, [fixture.path], { ...options, env: { ...options.env, CODEX_FIXTURE_MODE: globalThis.codexFixtureMode } });
    };
  }, { node: process.execPath, path: fixturePath });
  await page.getByRole('heading', { name: 'Your research projects', exact: true }).waitFor();
  return page;
}
try {
  let page = await launch();
  await page.getByLabel('Project name', { exact: true }).fill('Codex fixture research');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.getByRole('region', { name: 'Open project', exact: true }).waitFor();
  const projects = await page.evaluate(() => window.lab.listProjects()); assert.equal(projects.ok, true);
  const projectId = projects.value.projects[0].project.projectId;
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('heading', { name: 'Codex settings', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => typeof window.lab.codex.getSecret), 'undefined');
  const opening = application.waitForEvent('window');
  await page.getByRole('button', { name: 'Manage API keys', exact: true }).click();
  const entry = await opening; entry.setDefaultTimeout(15_000);
  await entry.getByLabel('Integration', { exact: true }).selectOption('openai');
  await entry.getByLabel('Label', { exact: true }).fill('Codex synthetic key');
  await entry.getByLabel('Credential', { exact: true }).fill(synthetic);
  await entry.getByRole('button', { name: 'Save credential', exact: true }).click();
  await entry.getByRole('button', { name: /Codex synthetic key OpenAI/ }).waitFor();
  assert.equal(await entry.getByLabel('New credential value', { exact: true }).inputValue(), '');
  const denied = await application.evaluate(async ({ BrowserWindow }) => {
    const probe = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false } });
    try { await probe.loadURL('data:text/html,<html></html>'); return await probe.webContents.executeJavaScript(`require('electron').ipcRenderer.invoke('codex:settings').then(() => false, () => true)`); }
    finally { probe.destroy(); }
  }); assert.equal(denied, true);
  await entry.close();
  await page.getByRole('button', { name: 'Refresh saved keys', exact: true }).click();
  await page.getByLabel('OpenAI credential', { exact: true }).selectOption({ label: 'Codex synthetic key (active)' });
  await page.getByRole('button', { name: 'Authenticate and load models', exact: true }).click();
  await page.getByText('API-key state confirmed by Codex. Inference access remains unverified.', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Codex model', { exact: true }).locator('option').count(), 3);
  await page.getByLabel('Codex model', { exact: true }).selectOption('fixture-second');
  await page.getByLabel('Reasoning effort', { exact: true }).selectOption('deep');
  await page.getByRole('button', { name: 'Save default model', exact: true }).click();
  await page.getByText('Default model saved. Existing run selections keep their recorded choices.', { exact: true }).waitFor();
  const invalid = await page.evaluate(() => window.lab.codex.saveDefault({ model: 'missing-model', effort: 'deep' }));
  assert.equal(invalid.error.code, 'model_unavailable');
  await page.getByRole('button', { name: 'Runs', exact: true }).click();
  await page.getByLabel('Research project', { exact: true }).selectOption(projectId);
  await page.getByRole('button', { name: 'Refresh Codex models', exact: true }).click();
  await page.getByRole('button', { name: 'Save run agent selection', exact: true }).click();
  await page.getByText('Run agent selection saved. Only the model settings and a credential reference are recorded.', { exact: true }).waitFor();
  const saved = await page.evaluate(id => window.lab.codex.runSelection(id), projectId); assert.equal(saved.ok, true);
  await application.close(); application = undefined;
  page = await launch();
  await page.getByRole('button', { name: 'Runs', exact: true }).click();
  await page.getByLabel('Research project', { exact: true }).selectOption(projectId);
  await page.getByText(/Saved selection \(revision 1\):/).waitFor();
  const restored = await page.evaluate(id => window.lab.codex.runSelection(id), projectId);
  assert.deepEqual(restored, saved);
  await application.evaluate(() => { globalThis.codexFixtureMode = 'removed'; });
  await page.getByRole('button', { name: 'Refresh Codex models', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'model_unavailable' }).waitFor();
  assert.equal(await page.getByLabel('Codex model', { exact: true }).inputValue(), 'fixture-second');
  await application.evaluate(() => { globalThis.codexFixtureMode = ''; });
  await page.getByRole('button', { name: 'Refresh Codex models', exact: true }).click();
  await page.getByLabel('Codex model', { exact: true }).selectOption('fixture-first');
  await application.evaluate(() => { globalThis.codexFixtureMode = 'unauthorized'; });
  await page.getByRole('button', { name: 'Save run agent selection', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'permission_denied' }).waitFor();
  assert.deepEqual(await page.evaluate(id => window.lab.codex.runSelection(id), projectId), saved);
  const view = await page.evaluate(() => window.lab.codex.settings()); assert.equal(view.ok, true);
  assert.equal(view.value.diagnostics[0].code, 'permission_denied');
  assert.ok(!JSON.stringify(view).includes(synthetic)); assert.ok(!(await page.content()).includes(synthetic));
  const launches = await application.evaluate(() => globalThis.codexLaunches);
  assert.ok(launches.length > 0);
  for (const launch of launches) {
    assert.ok(launch.args.includes('cli_auth_credentials_store="ephemeral"'));
    assert.deepEqual(Object.keys(launch.env).sort(), ['CODEX_HOME', 'HOME', 'LANG', 'PATH', 'TMPDIR']);
    assert.ok(launch.env.HOME.startsWith(await realpath(userData))); assert.ok(!JSON.stringify(launch).includes(synthetic));
  }
  assert.deepEqual(errors, []);
  await application.close(); application = undefined;
  for (const name of ['codex-settings.sqlite', 'codex-settings.sqlite-wal', 'codex-settings.sqlite-shm']) {
    const bytes = await readFile(path.join(userData, name)).catch(error => { if (error.code === 'ENOENT') return Buffer.alloc(0); throw error; });
    assert.ok(!bytes.includes(Buffer.from(synthetic)));
  }
  const state = await readdir(path.join(userData, 'private-codex/state')); assert.ok(!state.includes('auth.json'));
  await mkdir('out/smoke', { recursive: true });
  await writeFile('out/smoke/codex.json', JSON.stringify({ packagedUI: 'passed', persistenceAfterRestart: 'passed', rejectedModel: 'passed',
    unauthorizedAccess: 'passed', credentialFreeDiagnostics: 'passed', transport: 'controlled stdio fixture; not live service proof', liveInference: 'not run' }, null, 2));
  console.log('Packaged Codex acceptance passed (controlled stdio fixture; no live credentials or inference).');
} finally { await application?.close(); await rm(directory, { recursive: true, force: true }); }
