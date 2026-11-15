import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile, rename, stat } from 'node:fs/promises';
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
  const consoleErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') { consoleErrors.push(message.text()); console.error(message.text()); } });
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
  // Exercise project creation through the sandboxed UI, then verify real files.
  await page.getByLabel('Project name', { exact: true }).fill('First research');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  const details = page.getByRole('region', { name: 'Open project', exact: true });
  await details.getByRole('heading', { name: 'First research', exact: true }).waitFor();
  const firstReply = await page.evaluate(() => window.lab.listProjects());
  assert.equal(firstReply.ok, true);
  const first = firstReply.value.projects[0].project;
  assert.equal((await stat(first.repository)).isDirectory(), true);
  await writeFile(path.join(first.location, 'research.py'), '# retained source file\n');
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByLabel('Project name', { exact: true }).fill('Second research');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await details.getByRole('heading', { name: 'Second research', exact: true }).waitFor();
  const secondReply = await page.evaluate(() => window.lab.listProjects());
  assert.equal(secondReply.ok, true);
  assert.equal(secondReply.value.projects.length, 2);
  const second = secondReply.value.projects.find((entry) => entry.project.projectId !== first.projectId).project;
  assert.notEqual(first.repository, second.repository);
  assert.equal((await stat(second.repository)).isDirectory(), true);
  // A conflict must preserve the first project's source and expose an error.
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByLabel('Project name', { exact: true }).fill('Conflicting research');
  await page.getByRole('button', { name: 'Customize folder', exact: true }).click();
  await page.getByLabel('Folder name', { exact: true }).fill('../invalid');
  assert.equal(await page.getByRole('button', { name: 'Create project', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Done', exact: true }).isDisabled(), true);
  assert.equal(await page.getByLabel('Folder name', { exact: true }).getAttribute('aria-invalid'), 'true');
  await page.getByLabel('Folder name', { exact: true }).fill('first-research');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'already exists' }).waitFor();
  assert.equal(await readFile(path.join(first.location, 'research.py'), 'utf8'), '# retained source file\n');
  await mkdir('out/smoke', { recursive: true });
  await page.getByRole('button', { name: 'Create project', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Create project', exact: true }).waitFor();
  await page.screenshot({ path: 'out/smoke/workspace.png' });
  // Exercise the native close path, then macOS activation/reopen, then normal quit.
  const closing = page.waitForEvent('close');
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await closing;
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 0);
  const reopening = application.waitForEvent('window');
  await application.evaluate(({ app }) => app.emit('activate'));
  const reopened = await reopening;
  reopened.on('pageerror', (error) => rendererErrors.push(error.message));
  reopened.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await reopened.getByRole('heading', { name: 'First research', exact: true }).waitFor();
  await application.close();
  assert.equal(child.exitCode, 0);
  // A new main and coordinator must read the same registry and project identity.
  application = await electron.launch({ executablePath, args: [`--user-data-dir=${userData}`], env: launchEnv, timeout: 30_000 });
  child = application.process();
  const restarted = await application.firstWindow();
  restarted.setDefaultTimeout(15_000);
  restarted.on('pageerror', (error) => rendererErrors.push(error.message));
  restarted.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await restarted.getByRole('heading', { name: 'First research', exact: true }).waitFor();
  const firstCard = restarted.getByRole('article').filter({ has: restarted.getByRole('heading', { name: 'First research', exact: true }) });
  await firstCard.getByText(/^Last opened/).waitFor();
  await firstCard.getByRole('button', { name: 'Show folder path for First research', exact: true }).click();
  await firstCard.getByText(first.location, { exact: true }).waitFor();
  await firstCard.getByRole('button', { name: 'Open', exact: true }).click();
  await restarted.getByRole('region', { name: 'Open project', exact: true }).getByRole('heading', { name: 'First research', exact: true }).waitFor();
  await restarted.getByRole('article').filter({ has: restarted.getByRole('heading', { name: 'First research', exact: true }) }).getByText('Current', { exact: true }).waitFor();
  await restarted.getByRole('button', { name: 'New project', exact: true }).click();
  await restarted.getByLabel('Project name', { exact: true }).fill('Cancelled draft');
  await restarted.getByRole('button', { name: 'Cancel creation', exact: true }).click();
  await restarted.getByRole('region', { name: 'Open project', exact: true }).getByRole('heading', { name: 'First research', exact: true }).waitFor();
  // UI-only filtering and ordering never change the saved project catalog.
  await restarted.getByRole('searchbox', { name: 'Search projects', exact: true }).fill('Second');
  assert.equal(await restarted.getByRole('article').count(), 1);
  await restarted.getByRole('searchbox', { name: 'Search projects', exact: true }).fill('absent-project');
  await restarted.getByRole('heading', { name: 'No matching projects', exact: true }).waitFor();
  await restarted.getByRole('button', { name: 'Clear search', exact: true }).click();
  assert.equal(await restarted.getByRole('article').count(), 2);
  // Stub only the native Finder dispatch in this test; catalog validation still runs.
  await application.evaluate(({ app, shell }) => {
    app.revealedProjectPaths = [];
    shell.openPath = async (location) => { app.revealedProjectPaths.push(location); return ''; };
  });
  await restarted.getByRole('button', { name: 'Show files in Finder', exact: true }).click();
  await restarted.getByText('Project folder opened in Finder.', { exact: true }).waitFor({ state: 'attached' });
  assert.deepEqual(await application.evaluate(({ app }) => app.revealedProjectPaths), [first.location]);
  await application.evaluate(({ app, clipboard }) => {
    app.copiedWorkspacePaths = [];
    clipboard.writeText = (location) => { app.copiedWorkspacePaths.push(location); };
  });
  await restarted.getByText('Projects folder and location', { exact: true }).click();
  await restarted.getByRole('button', { name: 'Copy workspace path', exact: true }).click();
  await restarted.getByText('Workspace location copied.', { exact: true }).waitFor({ state: 'attached' });
  assert.deepEqual(await application.evaluate(({ app }) => app.copiedWorkspacePaths), [path.dirname(first.location)]);
  await restarted.getByRole('button', { name: 'Copy project path', exact: true }).click();
  await restarted.getByText('Project path copied.', { exact: true }).waitFor({ state: 'attached' });
  assert.deepEqual(await application.evaluate(({ app }) => app.copiedWorkspacePaths), [path.dirname(first.location), first.location]);
  const invalidCopy = await restarted.evaluate(() => window.lab.copyProjectLocation('not-a-project'));
  assert.equal(invalidCopy.ok, false);
  assert.deepEqual(await application.evaluate(({ app }) => app.copiedWorkspacePaths), [path.dirname(first.location), first.location]);
  const invalidReveal = await restarted.evaluate(() => window.lab.revealProject('not-a-project'));
  assert.equal(invalidReveal.ok, false);
  assert.deepEqual(await application.evaluate(({ app }) => app.revealedProjectPaths), [first.location]);
  const openedReply = await restarted.evaluate((id) => window.lab.openProject(id), first.projectId);
  assert.deepEqual(openedReply, { ok: true, value: first });
  assert.equal(await readFile(path.join(first.location, 'research.py'), 'utf8'), '# retained source file\n');
  // Unavailable folders stay listed; opening must never silently recreate them.
  await rename(first.location, `${first.location}-temporarily-unavailable`);
  await restarted.getByRole('button', { name: 'Refresh projects', exact: true }).click();
  await firstCard.getByText('Project unavailable', { exact: true }).waitFor();
  await firstCard.getByRole('button', { name: 'Open', exact: true }).click();
  await restarted.getByRole('alert').waitFor();
  await assert.rejects(stat(first.location), { code: 'ENOENT' });
  await rename(`${first.location}-temporarily-unavailable`, first.location);
  await firstCard.getByRole('button', { name: 'Open', exact: true }).click();
  await restarted.getByRole('region', { name: 'Open project', exact: true }).getByRole('heading', { name: 'First research', exact: true }).waitFor();
  await application.close();
  assert.equal(child.exitCode, 0);
  assert.deepEqual(rendererErrors, []);
  assert.deepEqual(consoleErrors, []);
  const report = { persistedRecency: 'passed', projectFilter: 'passed', nativeWorkspaceCopy: 'passed', validatedProjectCopy: 'passed', validatedFinderDispatch: 'passed', projectCreation: 'passed', projectConflict: 'passed', projectRestartReopen: 'passed', unavailableFolderRecovery: 'passed', packagedLaunch: 'passed', navigation: 'passed', rendererIsolation: 'passed', nativeCloseReopenQuit: 'passed', ...status };
  await writeFile('out/smoke/result.json', `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
} finally {
  if (application && child.exitCode === null) await application.close();
  await rm(userData, { recursive: true, force: true });
}
