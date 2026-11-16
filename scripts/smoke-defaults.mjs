import assert from 'node:assert/strict';

export async function setGlobalDefaults(page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('region', { name: 'Global defaults', exact: true });
  await settings.getByLabel('Global research agent integration', { exact: true }).selectOption('codex');
  await settings.getByLabel('Global research agent model', { exact: true }).fill('fixture-codex-model');
  await settings.getByLabel('Global training duration seconds', { exact: true }).fill('120');
  await settings.getByLabel('Global research objective', { exact: true }).fill('Improve validation');
  await settings.getByRole('button', { name: 'Save global defaults', exact: true }).click();
  await settings.getByRole('status').filter({ hasText: 'Defaults saved.' }).waitFor();
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
}
export async function checkDefaultsBeforeRestart(page, project) {
  const panel = page.getByRole('region', { name: 'Open project', exact: true });
  await panel.locator('summary').filter({ hasText: /^Project defaults$/ }).click();
  const settings = panel.getByRole('region', { name: 'Project defaults', exact: true });
  await settings.getByText('Inherited: 120 seconds', { exact: true }).waitFor();
  await settings.getByLabel('Project training duration source', { exact: true }).selectOption('explicit');
  await settings.getByLabel('Project training duration seconds', { exact: true }).fill('45');
  await settings.getByLabel('Project research objective source', { exact: true }).selectOption('explicit');
  await settings.getByLabel('Project research objective', { exact: true }).fill('');
  await settings.getByRole('button', { name: 'Save project defaults', exact: true }).click();
  await settings.getByRole('status').filter({ hasText: 'Defaults saved.' }).waitFor();
  await panel.getByRole('button', { name: 'Prepare new configuration', exact: true }).click();
  const form = panel.getByRole('form', { name: 'New run configuration', exact: true });
  await form.getByText('Inherited: 45 seconds', { exact: true }).waitFor();
  await form.getByRole('button', { name: 'Save configuration', exact: true }).click();
  const savedPanel = panel.getByRole('region', { name: 'Saved configuration', exact: true });
  await savedPanel.getByText('45 seconds', { exact: true }).waitFor();
  const reply = await page.evaluate(id => window.lab.listConfigurations(id), project.projectId);
  assert.equal(reply.ok, true);
  const saved = reply.value[0];
  assert.equal(saved.choices.objective, null);
  assert.equal(saved.origins.agent.level, 'global');
  assert.equal(saved.origins.trainingDurationSeconds.level, 'project');
  await settings.getByLabel('Project training duration seconds', { exact: true }).fill('60');
  await settings.getByRole('button', { name: 'Save project defaults', exact: true }).click();
  await settings.getByRole('status').filter({ hasText: 'Defaults saved.' }).waitFor();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const global = page.getByRole('region', { name: 'Global defaults', exact: true });
  await global.getByLabel('Global training duration seconds', { exact: true }).fill('300');
  await global.getByLabel('Global research objective', { exact: true }).fill('Changed global objective');
  await global.getByRole('button', { name: 'Save global defaults', exact: true }).click();
  await global.getByRole('status').filter({ hasText: 'Defaults saved.' }).waitFor();
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('article', { name: project.name, exact: true }).getByRole('button', { name: 'Open project', exact: true }).click();
  await panel.getByRole('button', { name: 'Prepare new configuration', exact: true }).click();
  await form.getByText('Inherited: 60 seconds', { exact: true }).waitFor();
  await form.getByLabel('Run training duration source', { exact: true }).selectOption('explicit');
  await form.getByLabel('Run training duration seconds', { exact: true }).fill('75');
  await form.getByRole('button', { name: 'Save configuration', exact: true }).click();
  await savedPanel.getByText('75 seconds', { exact: true }).waitFor();
  await panel.getByRole('button', { name: 'View saved configuration 1', exact: true }).click();
  await savedPanel.getByText('45 seconds', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(input => window.lab.getConfiguration(input.projectId, input.snapshotId), saved), { ok: true, value: saved });
  // Known-value admission rejects before SQL; it never saves a redacted choice.
  const unsafe = await page.evaluate(async id => {
    const global = await window.lab.getGlobalDefaults();
    const result = await window.lab.updateGlobalDefaults({ requestId: crypto.randomUUID(), expectedRevision: global.value.revision,
      values: { ...global.value.values, objective: 'synthetic-packaged-vault-check-4d7a' } });
    const crossScope = await window.lab.getConfiguration(id, crypto.randomUUID());
    return { result, crossScope, after: await window.lab.getGlobalDefaults() };
  }, project.projectId);
  assert.equal(unsafe.result.ok, false);
  assert.equal(unsafe.crossScope.ok, false);
  assert.equal(unsafe.after.value.values.objective, 'Changed global objective');
  return saved;
}
export async function checkDefaultsAfterRestart(page, saved) {
  const reply = await page.evaluate(async input => ({
    global: await window.lab.getGlobalDefaults(), project: await window.lab.getProjectDefaults(input.projectId),
    draft: await window.lab.prepareConfiguration(input.projectId), snapshot: await window.lab.getConfiguration(input.projectId, input.snapshotId),
  }), saved);
  assert.equal(reply.global.value.values.trainingDurationSeconds, 300);
  assert.equal(reply.project.value.values.trainingDurationSeconds, 60);
  assert.equal(reply.draft.value.choices.objective, null);
  assert.equal(reply.draft.value.origins.agent.level, 'global');
  assert.deepEqual(reply.snapshot, { ok: true, value: saved });
  await page.getByRole('button', { name: 'View saved configuration 1', exact: true }).click();
  const savedPanel = page.getByRole('region', { name: 'Saved configuration', exact: true });
  await savedPanel.getByText('45 seconds', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Prepare new configuration', exact: true }).click();
  await page.getByRole('form', { name: 'New run configuration', exact: true }).getByText('Inherited: 60 seconds', { exact: true }).waitFor();
}
