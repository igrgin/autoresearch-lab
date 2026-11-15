import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const [output] = process.argv.slice(2);
assert.ok(output, 'Provide a round output directory.');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(os.tmpdir(), 'lab-council-21-'));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let application;
try {
  application = await electron.launch({ executablePath: path.resolve('out/Autoresearch Lab-darwin-arm64/Autoresearch Lab.app/Contents/MacOS/Autoresearch Lab'), args: [`--user-data-dir=${profile}`], env });
  const shell = await application.firstWindow();
  await shell.getByRole('status').filter({ hasText: 'Workspace ready' }).waitFor();
  const opening = application.waitForEvent('window');
  await application.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('credential-settings').click());
  const page = await opening; page.setDefaultTimeout(20_000);
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Credential settings').setContentSize(960, 800));
  await page.getByRole('heading', { name: 'Credential settings', exact: true }).waitFor();
  const images = [];
  async function screenshot(name) {
    for (const input of await page.locator('input[type="password"]').all()) assert.equal(await input.inputValue(), '');
    const file = path.join(output, name + '.png');
    await page.screenshot({ path: file, scale: 'css', animations: 'disabled', fullPage: name === '09-expanded-history' });
    const bytes = await readFile(file);
    images.push({ file: name + '.png', sha256: createHash('sha256').update(bytes).digest('hex'), width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });
  }
  await screenshot('01-add');
  await page.getByRole('button',{name:'Save credential',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Enter a credential value before saving.'}).waitFor();
  await screenshot('07-required-field');
  await page.getByLabel('Label', { exact: true }).fill('Demo Runpod');
  await page.getByLabel('Credential', { exact: true }).fill('synthetic-council-fixture-never-captured-21');
  await page.getByRole('button', { name: 'Save credential', exact: true }).click();
  await page.getByRole('heading', { name: 'Manage credential', exact: true }).waitFor();
  await screenshot('06-saved');
  await page.getByRole('button', {name:'Add credential',exact:true}).click();
  await page.getByLabel('Integration',{exact:true}).selectOption('anthropic');
  await page.getByLabel('Label',{exact:true}).fill('Demo Claude');
  await page.getByLabel('Credential',{exact:true}).fill('synthetic-claude-council-fixture-only');
  await page.getByRole('button',{name:'Save credential',exact:true}).click();
  await page.getByRole('heading',{name:'Manage credential',exact:true}).waitFor();
  await page.getByRole('button',{name:/Demo Runpod Runpod/}).click();
  await screenshot('02-manage');
  await page.getByRole('button', { name: 'Revoke access…', exact: true }).click();
  await screenshot('03-confirm-revoke');
  await page.getByRole('button', { name: 'Revoke app access', exact: true }).click();
  await page.getByRole('status').filter({hasText:'App access revoked.'}).waitFor();
  await screenshot('04-revoked');
  // Genuine fault-injection state: corrupt only this disposable synthetic vault, then refresh.
  const vaultPath=path.join(profile,'private-credentials','credentials.vault');
  const backup=await readFile(vaultPath);
  await writeFile(vaultPath, 'synthetic-vault-fault');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Credential storage is unavailable.' }).waitFor();
  await screenshot('05-storage-error');
  await writeFile(vaultPath,backup);
  await page.getByRole('button',{name:'Retry credential storage',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#credential').matches(':disabled'));
  await page.getByLabel('New credential value',{exact:true}).fill('synthetic-restored-key-not-captured');
  await page.getByRole('button',{name:'Save and restore app access',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Replacement saved.'}).waitFor();
  await screenshot('08-replacement-saved');
  await page.getByRole('button',{name:/^View previous versions/}).click();
  await screenshot('09-expanded-history');
  await writeFile(path.join(output, 'capture.json'), JSON.stringify({ sourceTreeDiff: 'working issue branch; see round record', viewport: [960,800], images, credentials: 'Synthetic value used between captures only; all password inputs empty in PNGs.', fault: '05 corrupts disposable synthetic vault before Refresh.' }, null, 2)+'\n');
  console.log(`Captured ${images.length} credential-settings states.`);
} finally {
  if (application) await application.close();
  await rm(profile, { recursive: true, force: true });
}
