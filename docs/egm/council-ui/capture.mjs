/* global window */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { _electron as electron } from 'playwright';

const destination = path.resolve(process.argv[2]);
assert.ok(/round-\d+$/.test(destination), 'Supply a new numbered council round directory.');
await mkdir(destination, { recursive: true });
const executablePath = path.resolve('out/Autoresearch Lab-darwin-arm64/Autoresearch Lab.app/Contents/MacOS/Autoresearch Lab');
const profile = await mkdtemp('/tmp/lab-council-demo-');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
let application;
let child;
const errors = [];
const captures = [];
async function launch() {
  application = await electron.launch({ executablePath, args: [`--user-data-dir=${profile}`], env, timeout: 30_000 });
  child = application.process();
  const page = await application.firstWindow();
  page.setDefaultTimeout(20_000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1180, 838));
  await page.getByRole('status').filter({ hasText: 'Workspace ready' }).waitFor();
  return page;
}
async function capture(page, filename) {
  await page.locator('.page-header .primary:not(:disabled)').waitFor();
  const bytes = await page.screenshot({ path: path.join(destination, filename), scale: 'css' });
  captures.push({ filename, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), sha256: createHash('sha256').update(bytes).digest('hex') });
}
try {
  let page = await launch();
  for (const name of ['Image research demo', 'Audio research demo']) {
    await page.getByLabel('Project name', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Create project', exact: true }).click();
    await page.getByRole('region', { name: 'Open project', exact: true }).getByRole('heading', { name, exact: true }).waitFor();
    await page.getByRole('button', { name: 'New project', exact: true }).click();
  }
  const created = await page.evaluate(() => window.lab.listProjects());
  assert.equal(created.ok, true);
  assert.equal(created.value.projects.length, 2);
  const first = created.value.projects.find((entry) => entry.project.name === 'Image research demo').project;
  await application.close();
  page = await launch();
  await page.getByRole('heading', { name: 'Image research demo', exact: true }).waitFor();
  await page.getByLabel('Project name', { exact: true }).fill('Tabular research');
  assert.equal(await page.getByLabel('Folder name', { exact: true }).inputValue(), 'tabular-research');
  await capture(page, 'create-list.png');
  await page.getByRole('article', { name: 'Image research demo', exact: true }).getByRole('button', { name: 'Open', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Open project', exact: true });
  await panel.getByRole('heading', { name: 'Image research demo', exact: true }).waitFor();
  await capture(page, 'open.png');
  await panel.getByText('Project details', { exact: true }).click();
  await panel.getByText(first.projectId, { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate((id) => window.lab.openProject(id), first.projectId), { ok: true, value: first });
  await capture(page, 'open-details.png');
  await application.close();
  assert.deepEqual(errors, []);
  assert.equal(new Set(captures.map((entry) => `${entry.width}x${entry.height}`)).size, 1);
  await writeFile(path.join(destination, 'capture-results.json'), `${JSON.stringify({ synthetic: true, restartReopen: 'passed', errors, captures }, null, 2)}\n`);
} finally {
  if (application && child?.exitCode === null) await application.close();
  await rm(profile, { recursive: true, force: true });
}
