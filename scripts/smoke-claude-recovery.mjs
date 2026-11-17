import assert from 'node:assert/strict';

// Test-only interception of the pinned Electron 45.3.2 invoke registry. The
// original application handlers still perform the writes and reads. No app
// test endpoint or live provider traffic is added.
export async function checkClaudeDefaultReplyRecovery(application, page) {
  await application.evaluate(({ ipcMain }) => {
    const original = ipcMain._invokeHandlers?.get('claude:save');
    if (typeof original !== 'function') throw new Error('Pinned IPC fixture hook is unavailable');
    globalThis.claudeDefaultOriginal = original;
    globalThis.claudeDefaultRequestIds = [];
    let loseReply = true;
    ipcMain.removeHandler('claude:save');
    ipcMain.handle('claude:save', async (event, choice, revision, requestId) => {
      globalThis.claudeDefaultRequestIds.push(requestId);
      const reply = await original(event, choice, revision, requestId);
      if (reply.ok && loseReply) {
        loseReply = false;
        return { metadataGeneration: reply.metadataGeneration, ok: false, error: { code: 'unavailable', origin: 'claude', operationId: requestId, reason: 'unavailable',
          message: 'The Claude save outcome is unknown. Retry the same save to reconcile it before changing choices.', effect: 'unknown', retry: 'same_key' } };
      }
      return reply;
    });
  });
  try {
    await page.getByRole('button', { name: 'Save Claude default', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'save outcome is unknown' }).waitFor();
    await page.getByRole('button', { name: 'Save Claude default', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Claude default saved.' }).waitFor();
    const requests = await application.evaluate(() => globalThis.claudeDefaultRequestIds);
    assert.equal(requests.length, 2); assert.equal(requests[0], requests[1]);
    const settings = await page.evaluate(() => window.lab.claude.settings());
    assert.equal(settings.ok, true); assert.equal(settings.value.selection.revision, 1);
  } finally {
    await application.evaluate(({ ipcMain }) => { ipcMain.removeHandler('claude:save'); ipcMain.handle('claude:save', globalThis.claudeDefaultOriginal); });
  }
}

export async function checkClaudeRunRefreshRecovery(application, page, projectId) {
  await application.evaluate(({ ipcMain }) => {
    const save = ipcMain._invokeHandlers?.get('claude:save-run');
    const reads = ipcMain._invokeHandlers?.get('claude:runs');
    if (typeof save !== 'function' || typeof reads !== 'function') throw new Error('Pinned IPC fixture hook is unavailable');
    globalThis.claudeRunOriginal = save; globalThis.claudeRunsOriginal = reads;
    let failRead = false, savedGeneration;
    ipcMain.removeHandler('claude:save-run'); ipcMain.removeHandler('claude:runs');
    ipcMain.handle('claude:save-run', async (...args) => { const reply = await save(...args); if (reply.ok) { failRead = true; savedGeneration = reply.metadataGeneration; } return reply; });
    ipcMain.handle('claude:runs', (...args) => {
      if (failRead) {
        failRead = false;
        return { metadataGeneration: savedGeneration, ok: false, error: { code: 'unavailable', origin: 'claude', operationId: '00000000-0000-4000-8000-000000000001', reason: 'unavailable',
          message: 'Controlled list refresh failure', effect: 'none', retry: 'same_key' } };
      }
      return reads(...args);
    });
  });
  const panel = page.getByRole('region', { name: 'Run agent configuration', exact: true }).and(page.locator('.claude-settings'));
  try {
    await panel.getByRole('button', { name: 'Save run agent configuration', exact: true }).click();
    await panel.getByRole('status').filter({ hasText: 'Run agent configuration saved.' }).waitFor();
    await panel.getByRole('alert').filter({ hasText: 'configuration was saved, but the list could not refresh' }).waitFor();
    assert.equal(await panel.getByRole('button', { name: 'Save another run agent configuration', exact: true }).count(), 1);
    const committed = await page.evaluate(id => window.lab.claude.runInputs(id), projectId);
    assert.equal(committed.ok, true); assert.equal(committed.value.length, 1);
    await panel.screenshot({ path: 'out/smoke/claude-run-refresh-before.png' });
    await panel.getByRole('button', { name: 'Refresh saved configurations', exact: true }).click();
    await panel.getByRole('list', { name: 'Saved run agent configurations', exact: true }).getByText(committed.value[0].modelId, { exact: true }).waitFor();
    assert.equal(await panel.getByRole('alert').count(), 0);
    const after = await page.evaluate(id => window.lab.claude.runInputs(id), projectId);
    assert.deepEqual(after, committed); // Reading again never creates another run/snapshot.
    await panel.screenshot({ path: 'out/smoke/claude-run-refresh-after.png' });
  } finally {
    await application.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('claude:save-run'); ipcMain.removeHandler('claude:runs');
      ipcMain.handle('claude:save-run', globalThis.claudeRunOriginal); ipcMain.handle('claude:runs', globalThis.claudeRunsOriginal);
    });
  }
}

export async function checkClaudeRetainedMetadataProtection(application, page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Claude settings', exact: true });
  const before = await page.evaluate(() => window.lab.claude.settings());
  assert.equal(before.ok, true); const model = before.value.selection.modelId;
  await panel.getByText(model, { exact: true }).waitFor();
  await panel.screenshot({ path: 'out/smoke/claude-metadata-protection-before.png' });
  const opening = application.waitForEvent('window');
  await application.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('credential-settings').click());
  const entry = await opening;
  try {
    assert.equal((await entry.evaluate(value => window.credentialEntry.save({ category: 'anthropic', label: 'Controlled Claude exposure', value }), model)).ok, true);
    await panel.getByRole('button', { name: 'Reload credentials', exact: true }).click();
    await panel.getByRole('alert').filter({ hasText: 'withheld by credential protection' }).waitFor();
    assert.equal((await panel.innerText()).includes(model), false);
    assert.equal(await panel.getByLabel('Canonical Claude model', { exact: true }).inputValue(), '');
    const after = await page.evaluate(() => window.lab.claude.settings());
    assert.ok(!after.ok); assert.equal(after.error.reason, 'capture_failed'); assert.equal(JSON.stringify(after).includes(model), false);
    const keys = await entry.evaluate(() => window.credentialEntry.list());
    assert.equal(keys.find(key => key.label === 'Controlled Claude exposure').status, 'revoked');
  } finally { await entry.close(); }
  await panel.screenshot({ path: 'out/smoke/claude-metadata-protection-after.png' });
  // Resume through the actual renderer and private host using a controlled
  // clean catalog. The real provider is never called by this acceptance case.
  await application.evaluate(({ utilityProcess }) => {
    const { EventEmitter } = process.getBuiltinModule('node:events');
    globalThis.claudeRecoveryOriginalFork = utilityProcess.fork;
    utilityProcess.fork = (file, args, options) => {
      if (options?.serviceName !== 'Claude model access') return globalThis.claudeRecoveryOriginalFork(file, args, options);
      const child = new EventEmitter(); child.kill = () => { child.emit('exit', 0); return true; };
      child.postMessage = input => {
        if (input.kind !== 'discover') throw new Error('Recovery fixture permits model discovery only');
        const catalog = { credentialId: input.credentialId, observedAt: new Date().toISOString(), complete: true,
          source: 'anthropic_models+sdk_supportedModels', sdkVersion: '0.3.323', models: [{ id: 'claude-recovery-clean-20261116', lifecycle: 'active' }] };
        setImmediate(() => { child.emit('message', { result: { catalog } }); child.emit('exit', 0); });
      };
      return child;
    };
  });
  try {
    await panel.getByLabel('Anthropic API key reference', { exact: true }).selectOption({ label: 'Synthetic Claude access' }, { timeout: 5000 });
    await panel.getByRole('button', { name: 'Refresh Claude models', exact: true }).click();
    await panel.getByLabel('Canonical Claude model', { exact: true }).selectOption('claude-recovery-clean-20261116');
    await panel.getByRole('button', { name: 'Save Claude default', exact: true }).click();
    await panel.getByRole('status').filter({ hasText: 'Claude default saved.' }).waitFor();
    const clean = await page.evaluate(() => window.lab.claude.settings());
    assert.equal(clean.ok, true); assert.equal(clean.value.selection.revision, before.value.selection.revision + 1);
    assert.equal(clean.value.selection.modelId, 'claude-recovery-clean-20261116');
    assert.equal((await panel.innerText()).includes(model), false);
    await panel.screenshot({ path: 'out/smoke/claude-default-recovery-after.png' });
  } finally {
    await application.evaluate(({ utilityProcess }) => { utilityProcess.fork = globalThis.claudeRecoveryOriginalFork; });
  }
}
