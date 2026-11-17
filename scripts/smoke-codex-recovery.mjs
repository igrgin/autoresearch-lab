import assert from 'node:assert/strict';

// Test-only reply loss after the production handler commits. Separate transport
// tests cover the actual main/utility timeout and exit paths. No live service.
export async function checkCodexDefaultReplyRecovery(application, page) {
  await application.evaluate(({ ipcMain }) => {
    const original = ipcMain._invokeHandlers?.get('codex:default');
    if (typeof original !== 'function') throw new Error('Pinned IPC fixture hook is unavailable');
    globalThis.codexDefaultOriginal = original; globalThis.codexDefaultRequestIds = [];
    let loseReply = true;
    ipcMain.removeHandler('codex:default');
    ipcMain.handle('codex:default', async (event, choice, requestId) => {
      globalThis.codexDefaultRequestIds.push(requestId);
      const reply = await original(event, choice, requestId);
      if (reply.ok && loseReply) {
        loseReply = false;
        return { metadataGeneration: reply.metadataGeneration, ok: false, error: { code: 'unavailable', origin: 'codex_auth', operationId: requestId,
          message: 'Codex settings may have been saved. Reconcile this save before changing the selection.', effect: 'unknown', retry: 'same_key' } };
      }
      return reply;
    });
  });
  const panel = page.getByRole('region', { name: 'Codex settings', exact: true });
  try {
    await panel.getByRole('button', { name: 'Save default model', exact: true }).click();
    await panel.getByRole('alert').filter({ hasText: 'Codex settings may have been saved' }).waitFor();
    await panel.getByRole('button', { name: 'Reconcile default save', exact: true }).waitFor();
    await panel.screenshot({ path: 'out/smoke/codex-save-reconciliation-pending.png' });
    const committed = await page.evaluate(() => window.lab.codex.settings()); assert.equal(committed.ok, true);
    const starts = await application.evaluate(() => globalThis.codexLaunches.length);
    await panel.getByRole('button', { name: 'Reconcile default save', exact: true }).click();
    await panel.getByRole('status').filter({ hasText: 'Default model saved.' }).waitFor();
    const after = await page.evaluate(() => window.lab.codex.settings());
    assert.equal(after.ok, true); assert.deepEqual(after.value.settings.defaultAgent, committed.value.settings.defaultAgent);
    assert.equal(await application.evaluate(() => globalThis.codexLaunches.length), starts);
    const ids = await application.evaluate(() => globalThis.codexDefaultRequestIds);
    assert.equal(ids.length, 2); assert.equal(ids[0], ids[1]);
    assert.equal(await page.evaluate(() => localStorage.getItem('codex-save:default')), null);
    await panel.screenshot({ path: 'out/smoke/codex-save-reconciliation-after.png' });
  } finally {
    await application.evaluate(({ ipcMain }) => { ipcMain.removeHandler('codex:default'); ipcMain.handle('codex:default', globalThis.codexDefaultOriginal); });
  }
}
