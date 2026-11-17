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
let assertions = 0;
const check = (name, actual, expected) => {
  assertions++;
  observations.push({ name, actual, expected });
  try { assert.deepEqual(actual, expected, name); } catch (error) { failures.push(error.message); }
};
try {
  application = await electron.launch({ executablePath: path.resolve('out/Autoresearch Lab-darwin-arm64/Autoresearch Lab.app/Contents/MacOS/Autoresearch Lab'), args: [`--user-data-dir=${userData}`], env });
  const page = await application.firstWindow(); page.setDefaultTimeout(10_000);
  await application.evaluate(({ BrowserWindow }) => { const main=BrowserWindow.getAllWindows().find(window=>window.getTitle()==='Autoresearch Lab'); main.setBounds({ width:1280, height:1000 }); main.webContents.setZoomFactor(1); });
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
    await entry.bringToFront();
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
  const captureView = async (panel, kind, file) => {
    await page.bringToFront();
    const selected = panel.locator('.saved-configuration');
    const target = kind === 'defaults' ? panel.getByRole('region', { name: 'Project defaults', exact: true })
      : kind === 'snapshot' && await selected.count() ? selected : panel.getByRole('region', { name: 'Run configurations', exact: true });
    await target.scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const region = kind === 'defaults' ? panel.getByRole('region', { name: 'Project defaults', exact: true })
      : panel.getByRole('region', { name: 'Run configurations', exact: true });
    const bounds = await region.boundingBox();
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    const top = Math.max(0, bounds.y), left = Math.max(0, bounds.x);
    await page.screenshot({ path: path.join(output, file), clip: { x: left, y: top,
      width: Math.min(bounds.x + bounds.width, viewport.width) - left,
      height: Math.min(bounds.y + bounds.height, viewport.height) - top } });
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
    await captureView(panel, kind, `${capture}-before.png`);
    if (dropNotification) await application.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows().find(window => window.getTitle() === 'Autoresearch Lab').webContents;
      const original = contents.send;
      contents.send = function(channel, ...args) { if (channel !== 'configuration:invalidate') return original.call(this, channel, ...args); };
      globalThis.restoreConfigurationNotification = () => { contents.send = original; };
    });
    await recognize(canary, kind !== 'snapshot');
    // Let the policy notification render before inspecting the surviving mount.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    if (!dropNotification) check(`${capture}: immediate policy invalidation`, await noBody(canary), true);
    else observations.push({ name: `${capture}: earlier response barrier may already invalidate`, actual: await noBody(canary), expected: 'either; current-policy denial must clear all bodies below' });
    // Exercise rejection even if the policy notification already cleared the row.
    const denied = await page.evaluate(async ({ projectId, kind }) => {
      try { return kind === 'snapshot' ? await window.lab.listConfigurations(projectId) : await window.lab.prepareConfiguration(projectId); }
      catch (error) {
        if (!(error instanceof Error) || !error.message.includes('Credential protection changed.')) throw error;
        return { ok: false }; // Intentional policy-barrier denial; body assertions still follow.
      }
    }, { projectId: project.projectId, kind });
    check(`${capture}: current-policy read denied`, denied.ok, false);
    if (kind === 'snapshot') {
      const view = panel.getByRole('button', { name: 'View saved configuration 1', exact: true });
      if (await view.count()) await view.click();
      await panel.getByRole('button', { name: 'Refresh saved configurations', exact: true }).click();
    } else if (kind === 'draft') await panel.getByRole('button', { name: /Prepare (again from defaults|new configuration)/ }).click();
    else await panel.getByRole('button', { name: 'Reload defaults', exact: true }).click();
    await panel.getByRole('alert').first().waitFor();
    check(`${capture}: rejected revalidation clears all bodies`, await noBody(canary), true);
    await captureView(panel, kind, `${capture}-after.png`);
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
    const button = panel.getByRole('button', { name: kind === 'prepare' ? 'Prepare new configuration'
      : kind === 'snapshot' ? 'View saved configuration 1' : 'Reload defaults', exact: true });
    await button.click({ trial: true });
    assert.equal(await button.isEnabled(), true);
    // Observe the actual React action, including follow-up reads and its finally
    // block. A cleared view or two animation frames alone cannot prove settlement.
    // This test-only React 19 hook fails explicitly if its pinned shape changes.
    await button.evaluate(element => {
      const key = Object.keys(element).find(key => key.startsWith('__reactProps$'));
      const action = key && element[key]?.onClick;
      if (typeof action !== 'function') throw new Error('Pinned React action observer is unavailable');
      const state = globalThis.delayedConfigurationAction = { settled: false };
      const pending = action();
      if (!pending || typeof pending.then !== 'function') throw new Error('Configuration action must return its completion promise');
      state.completion = pending.then(() => { state.settled = true; }, error => { state.error = String(error); state.settled = true; });
    });
    await application.evaluate(() => new Promise((resolve, reject) => {
      const until = Date.now() + 5000;
      const poll = () => globalThis.delayedConfiguration.held ? resolve() : Date.now() > until ? reject(new Error('Delayed reply fixture not reached')) : setTimeout(poll, 5); poll();
    }));
    await recognize(canary, true);
    check(`${kind}: original UI action remains pending while reply is held`, await page.evaluate(() => globalThis.delayedConfigurationAction.settled), false);
    await application.evaluate(({ ipcMain }) => {
      globalThis.delayedConfiguration.resume();
      ipcMain.removeHandler('configuration:request'); ipcMain.handle('configuration:request', globalThis.delayedConfiguration.original);
    });
    await page.waitForFunction(() => globalThis.delayedConfigurationAction.settled, undefined, { timeout: 15_000 });
    await page.evaluate(() => globalThis.delayedConfigurationAction.completion);
    check(`${kind}: original UI action settled without an unhandled failure`, await page.evaluate(() => globalThis.delayedConfigurationAction.error ?? null), null);
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
        state.child = this; state.id = message.id; state.requestId = message.configuration.operationId;
        state.saveCount = (state.saveCount ?? 0) + 1;
        this.on('message', reply => {
          if (reply.id === state.id && reply.configurationReply) { state.committed = true; state.reply = reply.configurationReply; }
        });
      }
      if (this === state.child && message.configurationAdmissionId && message.allowed && ++state.approvals === 2) {
        state.held = true; state.resume = () => original.call(this, message, ...rest); return;
      }
      return original.call(this, message, ...rest);
    };
  });
  await page.evaluate(input => {
    globalThis.orderingSave = window.lab.saveConfiguration(input).then(reply => ({ reply }), error => {
      if (!(error instanceof Error) || !error.message.includes('Credential protection changed.')) throw error;
      return { policyRejected: true, message: error.message };
    });
  }, input);
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
  // The durable owner receipt is authoritative even if a policy change prevents
  // publishing its model/objective body to the renderer. Rejection remains an
  // uncertain acknowledgement; it must not be converted into a fresh write.
  const owner = await application.evaluate(() => ({ committed: globalThis.configurationPort.committed,
    ok: globalThis.configurationPort.reply?.ok, requestId: globalThis.configurationPort.requestId,
    count: globalThis.configurationPort.saveCount }));
  check('safe admitted write completes before recognition', owner.committed && owner.ok, true);
  check('original write identity retained', owner.requestId, input.requestId);
  check('no implicit retry after changed-policy reply', owner.count, 1);
  check('settlement reports success or an explicitly uncertain acknowledgement', saved.reply?.ok === true ||
    (saved.policyRejected === true && saved.message.includes('a save may already have completed.')), true);
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
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ assertions, observations, failures, qualification: 'Controlled synthetic credentials, actual packaged main/coordinator/entry UI. No provider/inference qualification.' }, null, 2));
}
assert.deepEqual(failures, [], failures.join('\n'));
console.log('Packaged configuration protection passed:', assertions, 'assertions and', observations.length - assertions, 'early-barrier observations');
