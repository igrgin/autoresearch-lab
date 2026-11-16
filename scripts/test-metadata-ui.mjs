import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import webpack from 'webpack';
import config from '../webpack.metadata-tests.config.cjs';
import { _electron as electron } from 'playwright';

await new Promise((resolve, reject) => {
  const compiler = webpack(config);
  compiler.run((error, stats) => { compiler.close(() => {}); if (error || stats.hasErrors()) reject(error ?? new Error(stats.toString({ all: false, errors: true }))); else resolve(); });
});
const directory = await mkdtemp(path.join(os.tmpdir(), 'lab-metadata-ui-'));
const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
let application;
const failures = [], results = [];
const token = 'claude-metadata-policy-fixture-20261116';
const projectId = '00000000-0000-4000-8000-000000000001';
const modes = ['runpod', 'vast', 'codex', 'codex-run', 'claude', 'claude-run', 'imports'];
const channels = { runpod: 'runpod:discover', vast: 'vast:discover', codex: 'codex:authenticate', 'codex-run': 'codex:models', claude: 'claude:discover', 'claude-run': 'claude:discover', imports: 'imports:list' };
async function open(mode) {
  const opening = application.waitForEvent('window');
  await application.evaluate(async (_electron, mode) => globalThis.metadataFixture.open(mode), mode);
  const page = await opening; page.setDefaultTimeout(6000); return page;
}
async function act(page, mode) {
  if (mode === 'runpod' || mode === 'vast') await page.getByRole('button', { name: /^(Connect and discover|Refresh Pods|Refresh instances)$/ }).click();
  else if (mode === 'codex') {
    await page.getByLabel('OpenAI credential', { exact: true }).selectOption('00000000-0000-4000-8000-000000000002');
    await page.getByRole('button', { name: 'Authenticate and load models', exact: true }).click();
  } else if (mode === 'codex-run') await page.getByRole('button', { name: 'Refresh Codex models', exact: true }).click();
  else if (mode.startsWith('claude')) await page.getByRole('button', { name: 'Refresh Claude models', exact: true }).click();
  else await page.getByRole('button', { name: 'Refresh imports', exact: true }).click();
}
async function setup(page, mode) {
  if (mode === 'codex-run') await page.getByLabel('Research project', { exact: true }).selectOption(projectId);
  if (mode === 'claude-run') await page.getByLabel('Project for run configuration', { exact: true }).selectOption(projectId);
  if (['runpod', 'vast'].includes(mode)) await act(page, mode);
  await page.waitForFunction(value => document.body.innerText.includes(value), token);
}
async function absent(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return page.evaluate(value => !document.body.innerText.includes(value) && !Array.from(document.querySelectorAll('input,textarea,select')).some(element => element.value.includes(value)), token);
}
try {
  application = await electron.launch({ args: [path.resolve('.webpack/metadata-tests/main.cjs'), `--user-data-dir=${directory}`], env: environment });
  await application.firstWindow();
  for (const mode of modes) {
    try {
      const page = await open(mode); await setup(page, mode);
      await application.evaluate(async () => globalThis.metadataFixture.recognize());
      assert.equal(await absent(page), true, `${mode}: invalidate mounted metadata on matching change`);
      // Read again through the current renderer, preserving explicit recovery.
      if (mode === 'imports') await act(page, mode);
      else if (mode === 'codex') await page.getByRole('button', { name: 'Refresh saved keys', exact: true }).click();
      else if (mode === 'codex-run') await page.getByRole('button', { name: 'Reload saved selection', exact: true }).click();
      else if (mode.startsWith('claude')) await page.getByRole('button', { name: 'Reload credentials', exact: true }).click();
      else await page.getByRole('button', { name: mode === 'runpod' ? 'Refresh credentials' : 'Reload credentials', exact: true }).click();
      assert.equal(await absent(page), true, `${mode}: denied reuse cannot restore the cache`);
      results.push(`${mode} mounted + denied reuse`);
    } catch (error) { failures.push(error.message); }
    for (const drop of [false, true]) {
      try {
        const page = await open(mode); await setup(page, mode);
        await application.evaluate((_electron, input) => globalThis.metadataFixture.hold(input.channel, input.drop), { channel: channels[mode], drop });
        const action = act(page, mode); await action;
        await application.evaluate(async () => { while (!globalThis.metadataFixture.admitted()) await new Promise(resolve => setTimeout(resolve, 5)); });
        await application.evaluate(async () => globalThis.metadataFixture.recognize());
        await application.evaluate(() => globalThis.metadataFixture.release());
        await page.waitForFunction(() => !document.querySelector('button:disabled')?.textContent?.includes('Working'));
        // Observe this operation's settlement; no unrelated metadata request may
        // mask a missing barrier in the request under test.
        await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
        await page.waitForTimeout(25);
        assert.equal(await absent(page), true, `${mode}: late reply cannot republish (notification dropped=${drop})`);
        results.push(`${mode} pending reply, drop=${drop}`);
      } catch (error) { failures.push(error.message); }
    }
  }

  for (const mode of ['codex', 'codex-run', 'claude', 'claude-run']) {
    try {
      const page = await open(mode); await setup(page, mode); await act(page, mode);
      await page.getByLabel(mode.startsWith('codex') ? 'Codex model' : 'Canonical Claude model', { exact: true }).selectOption(token);
      const channel = { codex: 'codex:default', 'codex-run': 'codex:run-save', claude: 'claude:save', 'claude-run': 'claude:save-run' }[mode];
      await application.evaluate((_electron, channel) => globalThis.metadataFixture.hold(channel), channel);
      const save = { codex: 'Save default model', 'codex-run': 'Save run agent selection', claude: 'Save Claude default', 'claude-run': 'Save run agent configuration' }[mode];
      await page.getByRole('button', { name: save, exact: true }).click();
      await application.evaluate(async () => { while (!globalThis.metadataFixture.admitted()) await new Promise(resolve => setTimeout(resolve, 5)); });
      const before = await application.evaluate(() => globalThis.metadataFixture.mutations());
      await application.evaluate(async () => globalThis.metadataFixture.recognize());
      await application.evaluate(() => globalThis.metadataFixture.release());
      await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
      await page.waitForTimeout(25);
      assert.equal(await absent(page), true, `${mode}: late save cannot restore its model body`);
      if (mode.startsWith('codex')) {
        const key = mode === 'codex' ? 'default' : projectId;
        assert.equal(await page.evaluate(key => localStorage.getItem(`codex-save:${key}`), key), before[0].requestId);
        await page.getByRole('button', { name: mode === 'codex' ? 'Reconcile default save' : 'Retry same run save', exact: true }).click();
        assert.deepEqual(await application.evaluate(() => globalThis.metadataFixture.reconciliations()), [before[0].requestId]);
      }
      assert.deepEqual(await application.evaluate(() => globalThis.metadataFixture.mutations()), before, `${mode}: no implicit duplicate write`);
      results.push(`${mode} pending save, identity retained/no duplicate`);
    } catch (error) { failures.push(error.message); }
  }
  console.log(JSON.stringify({ metadataUI: results, failures, qualification: 'Production renderer/preload; real synthetic encrypted credential service; controlled domain projections; no live service' }, null, 2));
  assert.deepEqual(failures, []);
} finally { await application?.close(); await rm(directory, { recursive: true, force: true }); }
