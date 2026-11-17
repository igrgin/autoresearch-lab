import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function checkRetainedImportProtection(application, page, sourceRoot) {
  for (const sourceOnly of [false, true]) await checkRetainedImportCase(application, page, sourceRoot, sourceOnly);
}

async function checkRetainedImportCase(application, page, sourceRoot, sourceOnly) {
  const canary = sourceOnly ? 'LaterKnownNativeSource23' : 'LaterKnownNativeImport23';
  const credentialLabel = sourceOnly ? 'Controlled private source exposure' : 'Controlled import exposure';
  const source = path.join(sourceRoot, sourceOnly ? canary : 'retained-metadata-source');
  await mkdir(source); await writeFile(path.join(source, 'sample.txt'), 'Controlled dataset fixture\n');
  const created = await page.evaluate(({ requestId, sourceOnly }) => window.lab.createProject({ requestId, name: sourceOnly ? 'Private source containment' : 'Import containment', folderName: sourceOnly ? 'private-source-containment' : 'import-containment' }), { requestId: randomUUID(), sourceOnly });
  assert.equal(created.ok, true); const project = created.value;
  await page.getByRole('button', { name: 'Refresh projects', exact: true }).click();
  await page.getByRole('article', { name: project.name, exact: true }).getByRole('button', { name: 'Open project', exact: true }).click();
  await page.getByRole('region', { name: 'Open project', exact: true }).getByRole('heading', { name: project.name, exact: true }).waitFor();
  const panel = page.getByRole('region', { name: 'Local dataset imports', exact: true });
  assert.equal(await panel.count(), 1);
  await application.evaluate(({ dialog }, source) => {
    globalThis.protectionOriginalPicker = dialog.showOpenDialog;
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] });
  }, source);
  let entry;
  try {
    await panel.getByRole('button', { name: 'Choose dataset directory', exact: true }).click();
    await panel.getByLabel('Dataset folder name', { exact: true }).fill(sourceOnly ? 'safe-source-destination' : canary);
    await panel.getByRole('button', { name: 'Start copy import', exact: true }).click();
    await panel.getByText('Byte import complete', { exact: true }).waitFor();
    const before = await page.evaluate(id => window.lab.listImports(id), project.projectId);
    assert.equal(before.ok, true); const record = before.value[0];
    assert.equal(JSON.stringify(before).includes(source), false);
    if (sourceOnly) assert.equal(JSON.stringify(before).includes(canary), false);
    // Warm the private inventory-piece cache through actual main/utility IPC.
    // The credential registration below must invalidate it without disclosure.
    for (let i = 0; i < 2; i++) {
      assert.deepEqual(await page.evaluate(id => window.lab.listImports(id), project.projectId), before);
    }
    await panel.screenshot({ path: sourceOnly ? 'out/smoke/import-source-protection-before.png' : 'out/smoke/import-protection-before.png' });
    const opening = application.waitForEvent('window');
    await application.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('credential-settings').click());
    entry = await opening;
    assert.equal((await entry.evaluate(({ value, label }) => window.credentialEntry.save({ category: 'openai', label, value }), { value: canary, label: credentialLabel })).ok, true);
    await panel.getByRole('button', { name: 'Refresh imports', exact: true }).click();
    await panel.getByRole('alert').filter({ hasText: 'withheld by credential protection' }).waitFor();
    assert.equal((await panel.innerText()).includes(canary), false);
    assert.equal(await panel.locator('.import-record').count(), 0);
    const replies = await page.evaluate(async ({ projectId, record }) => {
      const selection = await window.lab.selectImportSource('directory');
      return [await window.lab.listImports(projectId),
        await window.lab.importAction(projectId, record.importId, record.revision, 'cancel'),
        await window.lab.startImport(projectId, { requestId: crypto.randomUUID(), selectionId: selection.selectionId, destinationName: 'another-safe-copy', mode: 'copy' })];
    }, { projectId: project.projectId, record });
    assert.ok(replies.every(reply => !reply.ok && !JSON.stringify(reply).includes(canary)));
    const credentials = await entry.evaluate(() => window.credentialEntry.list());
    assert.equal(credentials.find(item => item.label === credentialLabel).status, 'revoked');
    await entry.close(); entry = undefined;
    await panel.screenshot({ path: sourceOnly ? 'out/smoke/import-source-protection-after.png' : 'out/smoke/import-protection-after.png' });
  } catch (error) {
    const diagnostic = await page.evaluate(async id => {
      const reply = await window.lab.listImports(id);
      return reply.ok ? reply.value.map(({ state, problem, totalFiles, completedFiles }) => ({ state, problem, totalFiles, completedFiles })) : reply.error;
    }, project.projectId);
    console.error('Controlled import-protection fixture:', JSON.stringify(diagnostic));
    throw error;
  } finally {
    if (entry) await entry.close();
    await application.evaluate(({ dialog }) => { dialog.showOpenDialog = globalThis.protectionOriginalPicker; });
  }
}
