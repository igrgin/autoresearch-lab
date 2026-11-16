import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const output = path.resolve(process.env.PR107_OUTPUT || 'out/smoke/configuration-protection');
await mkdir(output, { recursive: true });
const userData = await mkdtemp(path.join(os.tmpdir(), 'lab-configuration-protection-'));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let application;
const observations = [], failures = [];
const check = (name, actual, expected) => {
  observations.push({ name, actual, expected });
  try { assert.deepEqual(actual, expected, name); } catch (error) { failures.push(error.message); }
};
try {
  application = await electron.launch({ executablePath: path.resolve('out/Autoresearch Lab-darwin-arm64/Autoresearch Lab.app/Contents/MacOS/Autoresearch Lab'), args: [`--user-data-dir=${userData}`], env });
  const page = await application.firstWindow(); page.setDefaultTimeout(10_000);
  await page.getByRole('heading', { name: 'No projects yet', exact: true }).waitFor();
  const opening = application.waitForEvent('window');
  await application.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('credential-settings').click());
  const entry = await opening;
  const create = async name => {
    const reply = await page.evaluate(async name => {
      const requestId = crypto.randomUUID(); return window.lab.createProject({ requestId, name, folderName: name });
    }, name);
    assert.equal(reply.ok, true); return reply.value;
  };
  const open = async project => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
    await page.getByRole('article', { name: project.name, exact: true }).getByRole('button', { name: 'Open project', exact: true }).click();
    return page.getByRole('region', { name: 'Open project', exact: true });
  };
  const noBody = async canary => page.evaluate(value => !document.body.innerText.includes(value) &&
    !Array.from(document.querySelectorAll('input,textarea,select')).some(input => input.value.includes(value)), canary);
  const recognize = async (canary, rotate = false) => {
    // Real trusted entry form, host handler, credential service and encrypted vault.
    if (rotate) {
      await entry.getByLabel('New credential value', { exact: true }).fill(canary);
      await entry.getByRole('button', { name: 'Replace credential', exact: true }).click();
      await entry.getByRole('status').filter({ hasText: 'Replacement saved.' }).waitFor();
    } else {
      if (await entry.getByRole('button', { name: 'Add credential', exact: true }).count()) await entry.getByRole('button', { name: 'Add credential', exact: true }).click();
      await entry.getByLabel('Label', { exact: true }).fill('Controlled configuration protection');
      await entry.getByLabel('Credential', { exact: true }).fill(canary);
      await entry.getByRole('button', { name: 'Save credential', exact: true }).click();
      await entry.getByRole('status').filter({ hasText: 'Credential saved on this Mac.' }).waitFor();
    }
  };
  for (const [kind, dropNotification] of [['snapshot', false], ['draft', false], ['defaults', false], ['snapshot', true], ['draft', true]]) {
    const project = await create(`cache-${kind}-${dropNotification}`), canary = `LaterRecognized${kind}${dropNotification}107`;
    await page.evaluate(async ({ projectId, canary, kind }) => {
      const requestId = crypto.randomUUID();
      if (kind !== 'snapshot') await window.lab.updateProjectDefaults(projectId, { requestId, expectedRevision: 0, values: { objective: canary } });
      else {
        const draft = await window.lab.prepareConfiguration(projectId);
        await window.lab.saveConfiguration({ requestId, projectId, globalRevision: draft.value.globalRevision, projectRevision: draft.value.projectRevision, overrides: { objective: canary } });
      }
    }, { projectId: project.projectId, canary, kind });
    const panel = await open(project);
    if (kind === 'snapshot') await panel.getByRole('button', { name: 'View saved configuration 1', exact: true }).click();
    if (kind === 'draft') await panel.getByRole('button', { name: 'Prepare new configuration', exact: true }).click();
    if (kind === 'defaults') await panel.locator('summary').filter({ hasText: /^Project defaults$/ }).click();
    await page.waitForFunction(value => document.body.innerText.includes(value) ||
      Array.from(document.querySelectorAll('input')).some(input => input.value.includes(value)), canary);
    assert.equal(await noBody(canary), false);
    const capture = `${kind}${dropNotification ? '-denial-only' : ''}`;
    await panel.screenshot({ path: path.join(output, `${capture}-before.png`) });
    if (dropNotification) await application.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows().find(window => window.getTitle() === 'Autoresearch Lab').webContents;
      const original = contents.send;
      contents.send = function(channel, ...args) { if (channel !== 'configuration:invalidate') return original.call(this, channel, ...args); };
      globalThis.restoreConfigurationNotification = () => { contents.send = original; };
    });
    await recognize(canary, kind !== 'snapshot');
    // Let the policy notification render before inspecting the surviving mount.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    check(`${capture}: immediate policy invalidation`, await noBody(canary), !dropNotification);
    // Exercise rejection even if the policy notification already cleared the row.
    const denied = await page.evaluate(async ({ projectId, kind }) => kind === 'snapshot' ? window.lab.listConfigurations(projectId) : window.lab.prepareConfiguration(projectId), { projectId: project.projectId, kind });
    check(`${capture}: current-policy read denied`, denied.ok, false);
    if (kind === 'snapshot') {
      const view = panel.getByRole('button', { name: 'View saved configuration 1', exact: true });
      if (await view.count()) await view.click();
      await panel.getByRole('button', { name: 'Refresh saved configurations', exact: true }).click();
    } else if (kind === 'draft') await panel.getByRole('button', { name: /Prepare (again from defaults|new configuration)/ }).click();
    else await panel.getByRole('button', { name: 'Reload defaults', exact: true }).click();
    await panel.getByRole('alert').first().waitFor();
    check(`${capture}: rejected revalidation clears all bodies`, await noBody(canary), true);
    await panel.screenshot({ path: path.join(output, `${capture}-after.png`) });
    if (dropNotification) await application.evaluate(() => globalThis.restoreConfigurationNotification());
  }
  for (const kind of ['prepare', 'snapshot', 'project:get']) {
    const project = await create(`delayed-${kind.replace(':', '-')}`), canary = `DelayedReply${kind.replace(':', '')}107`;
    const snapshotId = await page.evaluate(async ({ projectId, canary, kind }) => {
      const requestId = crypto.randomUUID();
      if (kind !== 'snapshot') {
        const reply = await window.lab.updateProjectDefaults(projectId, { requestId, expectedRevision: 0, values: { objective: canary } });
        if (!reply.ok) throw new Error('Controlled defaults setup failed'); return null;
      }
      const draft = await window.lab.prepareConfiguration(projectId);
      const reply = await window.lab.saveConfiguration({ requestId, projectId, globalRevision: draft.value.globalRevision, projectRevision: draft.value.projectRevision, overrides: { objective: canary } });
      return reply.value.snapshotId;
    }, { projectId: project.projectId, canary, kind });
    const panel = await open(project);
    if (kind === 'project:get') {
      await panel.locator('summary').filter({ hasText: /^Project defaults$/ }).click();
      await panel.getByLabel('Project research objective source', { exact: true }).waitFor();
    }
    await application.evaluate(({ ipcMain }, { kind, projectId }) => {
      const original = ipcMain._invokeHandlers.get('configuration:request');
      globalThis.delayedConfiguration = { original, held: false };
      ipcMain.removeHandler('configuration:request');
      ipcMain.handle('configuration:request', async (event, request) => {
        const reply = await original(event, request);
        if (request.kind !== kind || request.projectId !== projectId) return reply;
        globalThis.delayedConfiguration.held = true;
        await new Promise(resolve => { globalThis.delayedConfiguration.resume = resolve; });
        return reply;
      });
    }, { kind, projectId: project.projectId });
    if (kind === 'prepare') await panel.getByRole('button', { name: 'Prepare new configuration', exact: true }).click();
    else if (kind === 'snapshot') await panel.getByRole('button', { name: 'View saved configuration 1', exact: true }).click();
    else await panel.getByRole('button', { name: 'Reload defaults', exact: true }).click();
    await application.evaluate(() => new Promise((resolve, reject) => {
      const until = Date.now() + 5000;
      const poll = () => globalThis.delayedConfiguration.held ? resolve() : Date.now() > until ? reject(new Error('Delayed reply fixture not reached')) : setTimeout(poll, 5); poll();
    }));
    await recognize(canary, true);
    await application.evaluate(({ ipcMain }) => {
      globalThis.delayedConfiguration.resume();
      ipcMain.removeHandler('configuration:request'); ipcMain.handle('configuration:request', globalThis.delayedConfiguration.original);
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    check(`${kind}: delayed previously admitted reply cannot restore body`, await noBody(canary), true);
    if (snapshotId) check('snapshot: explicit current-policy read denied', (await page.evaluate(({ projectId, snapshotId }) => window.lab.getConfiguration(projectId, snapshotId), { projectId: project.projectId, snapshotId })).ok, false);
  }
  // Delay main's already-approved second admission on the actual utility port.
  const project = await create('ordering');
  const canary = 'DelayedPackagedAdmission107';
  const input = await page.evaluate(async ({ projectId, canary }) => {
    const current = await window.lab.getGlobalDefaults();
    await window.lab.updateGlobalDefaults({ requestId: crypto.randomUUID(), expectedRevision: current.value.revision, values: { objective: canary } });
    const draft = await window.lab.prepareConfiguration(projectId);
    return { requestId: crypto.randomUUID(), projectId, globalRevision: draft.value.globalRevision, projectRevision: draft.value.projectRevision, overrides: {} };
  }, { projectId: project.projectId, canary });
  await application.evaluate(async ({ app, utilityProcess }) => {
    const path = process.getBuiltinModule('node:path');
    const probe = utilityProcess.fork(path.join(app.getAppPath(), '.webpack/main/coordinator.cjs'), [path.join(app.getPath('userData'), 'prototype-probe')]);
    const prototype = Object.getPrototypeOf(probe), original = prototype.postMessage;
    await new Promise(resolve => probe.once('message', resolve));
    await new Promise(resolve => { probe.once('exit', resolve); probe.kill(); });
    globalThis.configurationPort = { prototype, original, approvals: 0, held: false, committed: false };
    prototype.postMessage = function(message, ...rest) {
      const state = globalThis.configurationPort;
      if (message.configuration?.kind === 'save') {
        state.child = this; state.id = message.id;
        this.on('message', reply => { if (reply.id === state.id && reply.configurationReply) state.committed = true; });
      }
      if (this === state.child && message.configurationAdmissionId && message.allowed && ++state.approvals === 2) {
        state.held = true; state.resume = () => original.call(this, message, ...rest); return;
      }
      return original.call(this, message, ...rest);
    };
  });
  await page.evaluate(input => { globalThis.orderingSave = window.lab.saveConfiguration(input); }, input);
  await application.evaluate(() => new Promise((resolve, reject) => {
    const until = Date.now() + 5000;
    const poll = () => globalThis.configurationPort.held ? resolve() : Date.now() > until ? reject(new Error('Admission hook not reached')) : setTimeout(poll, 5); poll();
  }));
  await entry.evaluate(value => {
    globalThis.registrationDone = false;
    globalThis.registration = window.credentialEntry.save({ category: 'runpod', label: 'Controlled ordering', value }).then(reply => { globalThis.registrationDone = true; return reply; });
  }, canary);
  await entry.waitForTimeout(250);
  const registeredBeforeCommit = await entry.evaluate(() => globalThis.registrationDone);
  check('credential registration waits for admitted writer', registeredBeforeCommit, false);
  await application.evaluate(() => globalThis.configurationPort.resume());
  const saved = await page.evaluate(() => globalThis.orderingSave);
  const registered = await entry.evaluate(() => globalThis.registration);
  check('registration completes after writer quiescence', registered.ok, true);
  check('safe admitted write completes before recognition', saved.ok, true);
  const reRead = await page.evaluate(id => window.lab.listConfigurations(id), project.projectId);
  check('recognized committed choices withheld on reuse', reRead.ok, false);
  const bytes = await readFile(path.join(project.location, '.lab/configuration.sqlite'));
  check('no invalidated-admission snapshot copy', registeredBeforeCommit && bytes.includes(Buffer.from(canary)), false);
  await application.evaluate(() => { const state = globalThis.configurationPort; state.prototype.postMessage = state.original; });
  // A registration that wins first denies a fresh write without a new SQL/WAL copy.
  const deniedProject = await create('registration-first');
  const denied = await page.evaluate(async projectId => {
    const draft = await window.lab.prepareConfiguration(projectId);
    return window.lab.saveConfiguration({ requestId: crypto.randomUUID(), projectId, globalRevision: draft.value?.globalRevision ?? 1, projectRevision: 0, overrides: {} });
  }, deniedProject.projectId);
  check('registration-first write rejected', denied.ok, false);
  const deniedBytes = await readFile(path.join(deniedProject.location, '.lab/configuration.sqlite'));
  check('registration-first no project snapshot bytes', deniedBytes.includes(Buffer.from(canary)), false);
  await entry.close();
  await application.close(); application = undefined;
  // Real application restart loads current + retired matching before reads.
  application = await electron.launch({ executablePath: path.resolve('out/Autoresearch Lab-darwin-arm64/Autoresearch Lab.app/Contents/MacOS/Autoresearch Lab'), args: [`--user-data-dir=${userData}`], env });
  const restarted = await application.firstWindow();
  await restarted.getByRole('button', { name: 'Projects', exact: true }).waitFor();
  const reply = await restarted.evaluate(id => window.lab.listConfigurations(id), project.projectId);
  check('restart retains matching and withholds old snapshot', reply.ok, false);
} catch (error) { failures.push(error.stack); }
finally {
  if (application) await application.close();
  await rm(userData, { recursive: true, force: true });
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ observations, failures, qualification: 'Controlled synthetic credentials, actual packaged main/coordinator/entry UI. No provider/inference qualification.' }, null, 2));
}
assert.deepEqual(failures, [], failures.join('\n'));
console.log('Packaged configuration protection passed:', observations.length, 'assertions');
