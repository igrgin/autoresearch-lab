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

export async function checkInheritedAdmission(application, page, project) {
  const opening = application.waitForEvent('window');
  await application.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('credential-settings').click());
  const entry = await opening;
  try {
    for (const scope of ['global', 'project']) {
      const canary = `LaterRecognized${scope}Objective20`;
      const prior = await page.evaluate(async ({ scope, projectId }) => scope === 'global' ? window.lab.getGlobalDefaults() : window.lab.getProjectDefaults(projectId), { scope, projectId: project.projectId });
      assert.equal(prior.ok, true);
      const changed = await page.evaluate(async ({ scope, projectId, prior, canary }) => {
        const values = scope === 'global' ? { ...prior.values, agent: { ...prior.values.agent, model: canary } } : { ...prior.values, objective: canary };
        const input = { requestId: crypto.randomUUID(), expectedRevision: prior.revision, values };
        return scope === 'global' ? window.lab.updateGlobalDefaults(input) : window.lab.updateProjectDefaults(projectId, input);
      }, { scope, projectId: project.projectId, prior: prior.value, canary });
      assert.equal(changed.ok, true);
      const prepared = await page.evaluate(id => window.lab.prepareConfiguration(id), project.projectId);
      assert.equal(prepared.ok, true);
      assert.ok(JSON.stringify(prepared.value.choices).includes(canary));
      const count = (await page.evaluate(id => window.lab.listConfigurations(id), project.projectId)).value.length;
      const current = await entry.evaluate(async () => (await window.credentialEntry.list()).find(item => item.category === 'runpod' && item.status === 'active'));
      assert.ok(current);
      assert.equal((await entry.evaluate(input => window.credentialEntry.replace(input.id, input.value), { id: current.id, value: canary })).ok, true);
      const save = { requestId: randomRequestId(), projectId: project.projectId, globalRevision: prepared.value.globalRevision, projectRevision: prepared.value.projectRevision, overrides: {} };
      assert.equal((await page.evaluate(input => window.lab.saveConfiguration(input), save)).ok, false);
      // Retiring the value must retain matching and must not permit a new copy.
      const replacement = await entry.evaluate(async () => (await window.credentialEntry.list()).find(item => item.category === 'runpod' && item.status === 'active'));
      assert.equal((await entry.evaluate(input => window.credentialEntry.replace(input.id, input.value), { id: replacement.id, value: 'synthetic-replacement-integration-check' })).ok, true);
      assert.equal((await page.evaluate(input => window.lab.saveConfiguration(input), save)).ok, false);
      const after = await page.evaluate(id => window.lab.listConfigurations(id), project.projectId);
      assert.equal(after.ok, true); assert.equal(after.value.length, count);
      await replaceDefaultsViaUi(page, project, scope, prior.value.values);
      const restored = await page.evaluate(async ({ scope, projectId }) => scope === 'global' ? window.lab.getGlobalDefaults() : window.lab.getProjectDefaults(projectId), { scope, projectId: project.projectId });
      assert.equal(restored.ok, true);
      assert.deepEqual(restored.value.values, prior.value.values);
    }
  } finally { await entry.close(); }
}

function randomRequestId() { return globalThis.crypto.randomUUID(); }


export async function replaceDefaultsViaUi(page, project, scope, choices, withheld = true) {
  // Mount from navigation, so no pre-exposure revision or cached choices can
  // authorize recovery. All replacement writes go through the actual form.
  await page.getByRole('button', { name: scope === 'global' ? 'Projects' : 'Settings', exact: true }).click();
  await page.getByRole('button', { name: scope === 'global' ? 'Settings' : 'Projects', exact: true }).click();
  if (scope === 'project') {
    await page.getByRole('article', { name: project.name, exact: true }).getByRole('button', { name: 'Open project', exact: true }).click();
    await page.getByRole('region', { name: 'Open project', exact: true }).locator('summary').filter({ hasText: /^Project defaults$/ }).click();
  }
  const prefix = scope === 'global' ? 'Global' : 'Project';
  const panel = page.getByRole('region', { name: `${prefix} defaults`, exact: true });
  if (withheld) {
    await panel.getByRole('alert').waitFor();
    await panel.screenshot({ path: `out/smoke/defaults-${scope}-recovery-before.png` });
  }
  for (const [key, label] of [['agent', 'research agent'], ['trainingDurationSeconds', 'training duration'], ['objective', 'research objective']]) {
    if (scope === 'project') await panel.getByLabel(`${prefix} ${label} source`, { exact: true }).selectOption(Object.hasOwn(choices, key) ? 'explicit' : 'inherit', { timeout: 5000 });
    if (scope === 'project' && !Object.hasOwn(choices, key)) continue;
    if (key === 'agent') {
      await panel.getByLabel(`${prefix} ${label} integration`, { exact: true }).selectOption(choices.agent?.integration ?? '', { timeout: 5000 });
      if (choices.agent) await panel.getByLabel(`${prefix} ${label} model`, { exact: true }).fill(choices.agent.model ?? '');
    } else await panel.getByLabel(`${prefix} ${label}${key === 'trainingDurationSeconds' ? ' seconds' : ''}`, { exact: true }).fill(choices[key] === null ? '' : String(choices[key]), { timeout: 5000 });
  }
  await panel.getByRole('button', { name: `Save ${scope} defaults`, exact: true }).click();
  await panel.getByRole('status').filter({ hasText: 'Defaults saved.' }).waitFor();
  await panel.screenshot({ path: `out/smoke/defaults-${scope}-recovery-after.png` });
}


export async function armDefaultsRecoveryRestart(application, page, project) {
  const prior = await page.evaluate(async projectId => ({ global: await window.lab.getGlobalDefaults(), project: await window.lab.getProjectDefaults(projectId) }), project.projectId);
  assert.equal(prior.global.ok, true); assert.equal(prior.project.ok, true);
  const globalCanary = 'RestartGlobalObjective20', projectCanary = 'RestartProjectObjective20';
  await replaceDefaultsViaUi(page, project, 'global', { ...prior.global.value.values, objective: globalCanary }, false);
  await replaceDefaultsViaUi(page, project, 'project', { ...prior.project.value.values, objective: projectCanary }, false);
  const opening = application.waitForEvent('window');
  await application.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('credential-settings').click());
  const entry = await opening;
  try {
    for (const value of [globalCanary, projectCanary, 'synthetic-replacement-integration-check']) {
      const active = await entry.evaluate(async () => (await window.credentialEntry.list()).find(item => item.category === 'runpod' && item.status === 'active'));
      assert.equal((await entry.evaluate(input => window.credentialEntry.replace(input.id, input.value), { id: active.id, value })).ok, true);
    }
  } finally { await entry.close(); }
  return { global: prior.global.value.values, project: prior.project.value.values };
}

export async function checkDefaultsRecoveryRestart(page, project, prior) {
  const replies = await page.evaluate(async projectId => ({ global: await window.lab.getGlobalDefaults(), project: await window.lab.getProjectDefaults(projectId),
    globalRecovery: await window.lab.recoverGlobalDefaults(), projectRecovery: await window.lab.recoverProjectDefaults(projectId) }), project.projectId);
  assert.equal(replies.global.ok, false); assert.equal(replies.project.ok, false);
  assert.equal(replies.globalRecovery.ok, true); assert.equal(replies.projectRecovery.ok, true);
  assert.equal(JSON.stringify(replies).includes('RestartGlobalObjective20'), false);
  assert.equal(JSON.stringify(replies).includes('RestartProjectObjective20'), false);
  assert.deepEqual(Object.keys(replies.projectRecovery.value).sort(), ['projectId', 'revision', 'scope']);
  // The project remains repairable while its inherited global body is withheld.
  await replaceDefaultsViaUi(page, project, 'project', prior.project);
  await replaceDefaultsViaUi(page, project, 'global', prior.global);
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('article', { name: project.name, exact: true }).getByRole('button', { name: 'Open project', exact: true }).click();
}
