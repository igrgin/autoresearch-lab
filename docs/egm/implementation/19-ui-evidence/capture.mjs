/* global window */
// Capture genuine packaged Electron UIs; never substitute DOM, styles or data.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const evidence = path.dirname(fileURLToPath(import.meta.url));
const [baseExecutable, headExecutable] = process.argv.slice(2);
assert.ok(baseExecutable && headExecutable, 'Pass the base and head packaged executable paths.');
const launchEnv = { ...process.env };
delete launchEnv.ELECTRON_RUN_AS_NODE;
const errors = [];
const captures = [];
let application;
let child;
let profile;
let contentSize;

async function launch(executablePath, reuseProfile = false) {
  if (!reuseProfile) profile = await mkdtemp('/tmp/lab-project-demo-');
  application = await electron.launch({ executablePath: path.resolve(executablePath), args: [`--user-data-dir=${profile}`], env: launchEnv, timeout: 30_000 });
  child = application.process();
  const page = await application.firstWindow();
  page.setDefaultTimeout(20_000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  contentSize = await application.evaluate(({ BrowserWindow }, desired) => {
    const nativeWindow = BrowserWindow.getAllWindows()[0];
    nativeWindow.setContentSize(...desired);
    return nativeWindow.getContentSize();
  }, contentSize || [1180, 1000]);
  await page.getByRole('status').filter({ hasText: 'Workspace ready' }).waitFor();
  return page;
}

async function capture(page, filename, caption) {
  const image = await page.screenshot({ path: path.join(evidence, filename), scale: 'css', fullPage: false });
  const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const png = { width: image.readUInt32BE(16), height: image.readUInt32BE(20) };
  assert.deepEqual(png, viewport);
  captures.push({ filename, caption, viewport, sha256: createHash('sha256').update(image).digest('hex') });
}

try {
  const before = await launch(baseExecutable);
  await before.getByRole('heading', { name: 'No projects yet', exact: true }).waitFor();
  assert.equal(await before.getByRole('button', { name: 'Create project', exact: true }).count(), 0);
  await capture(before, 'before.png', 'Before: base shell has an empty Projects view and no creation controls.');
  await application.close();
  await rm(profile, { recursive: true, force: true });

  let after = await launch(headExecutable);
  for (const name of ['Image research demo', 'Audio research demo']) {
    await after.getByLabel('Project name', { exact: true }).fill(name);
    await after.getByRole('button', { name: 'Create project', exact: true }).click();
    await after.getByRole('region', { name: 'Open project', exact: true }).getByRole('heading', { name, exact: true }).waitFor();
    await after.locator('button.primary:not(:disabled)').waitFor();
  }
  const created = await after.evaluate(() => window.lab.listProjects());
  assert.equal(created.ok, true);
  assert.equal(created.value.projects.length, 2);
  assert.equal(created.value.projects.every((entry) => entry.availability === 'ready'), true);
  const first = created.value.projects.find((entry) => entry.project.name === 'Image research demo').project;
  await application.close();
  // A full application restart demonstrates that the list and open view are durable.
  after = await launch(headExecutable, true);
  await after.getByRole('heading', { name: 'Image research demo', exact: true }).waitFor();
  await after.getByRole('heading', { name: 'Audio research demo', exact: true }).waitFor();
  await after.locator('button.primary:not(:disabled)').waitFor();
  await capture(after, 'after-create-list.png', 'After: creation controls and two independent saved projects, loaded after an application restart.');
  const card = after.getByRole('article').filter({ has: after.getByRole('heading', { name: 'Image research demo', exact: true }) });
  await card.getByRole('button', { name: 'Open', exact: true }).click();
  const details = after.getByRole('region', { name: 'Open project', exact: true });
  await details.getByText(first.projectId, { exact: true }).waitFor();
  await after.locator('button.primary:not(:disabled)').waitFor();
  const reopened = await after.evaluate((id) => window.lab.openProject(id), first.projectId);
  assert.deepEqual(reopened, { ok: true, value: first });
  await after.evaluate(() => window.scrollTo(0, 0));
  await capture(after, 'after-open.png', 'After: reopening the saved project displays its unchanged identity, files folder and Git repository.');
  await application.close();
  assert.deepEqual(errors, []);
  assert.equal(new Set(captures.map((capture) => `${capture.viewport.width}x${capture.viewport.height}`)).size, 1);
  await writeFile(path.join(evidence, 'capture-results.json'), `${JSON.stringify({ nativeContentSize: contentSize, rendererErrors: errors, syntheticProjects: true, restartedBeforeAfterCaptures: true, captures }, null, 2)}\n`);
} finally {
  if (application && child?.exitCode === null) await application.close();
  if (profile) await rm(profile, { recursive: true, force: true });
}
