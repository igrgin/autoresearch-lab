import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

// Run only with the unpacked CI apps identified in provenance.json; no source checkout changes.
const [baseExecutable, changedExecutable] = process.argv.slice(2);
assert.ok(baseExecutable && changedExecutable, 'Provide base and changed CI executable paths.');
const directory = path.dirname(fileURLToPath(import.meta.url));
const size = { width: 960, height: 620 };
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
async function capture(executablePath, changed) {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'lab-21-ui-evidence-'));
  let application;
  try {
    application = await electron.launch({ executablePath: path.resolve(executablePath), args: [`--user-data-dir=${profile}`], env: environment, timeout: 30_000 });
    const shell = await application.firstWindow();
    shell.setDefaultTimeout(20_000);
    await shell.getByRole('status').filter({ hasText: 'Workspace ready' }).waitFor();
    const menuLabels = await application.evaluate(({ Menu }) => {
      const collect = menu => menu.items.flatMap(item => [item.label, ...(item.submenu ? collect(item.submenu) : [])]);
      return collect(Menu.getApplicationMenu());
    });
    let page = shell;
    if (changed) {
      assert.ok(menuLabels.includes('Credential settings…'));
      const opening = application.waitForEvent('window');
      await application.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('credential-settings').click());
      page = await opening;
      await page.getByRole('heading', { name: 'Credential settings', exact: true }).waitFor();
    } else {
      assert.ok(!menuLabels.some(label => /credential/i.test(label)));
      await page.getByRole('heading', { name: 'No projects yet', exact: true }).waitFor();
    }
    await application.evaluate(({ BrowserWindow }, options) => {
      const window = BrowserWindow.getAllWindows().find(window => options.changed ? window.getTitle() === 'Credential settings' : window.getTitle() === 'Autoresearch Lab');
      assertWindow(window);
      function assertWindow(window) { if (!window) throw new Error('Expected application window missing.'); }
      window.setContentSize(options.size.width, options.size.height);
      window.center();
    }, { changed, size });
    await page.waitForFunction(expected => innerWidth === expected.width && innerHeight === expected.height, size);
    const files = [];
    const screenshot = async name => {
      if (changed) {
        assert.equal(await page.getByLabel('Credential', { exact: true }).inputValue(), '');
        assert.ok(!(await page.locator('body').innerText()).includes('synthetic-evidence-only'));
      }
      await page.screenshot({ path: path.join(directory, name), scale: 'css', animations: 'disabled' });
      const bytes = await readFile(path.join(directory, name));
      assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
      assert.equal(bytes.readUInt32BE(16), size.width); assert.equal(bytes.readUInt32BE(20), size.height);
      files.push({ file: name, sha256: createHash('sha256').update(bytes).digest('hex'), ...size });
    };
    await screenshot(changed ? 'after-credential-entry.png' : 'before-projects-shell.png');
    if (changed) {
      await page.getByLabel('Label', { exact: true }).fill('Synthetic Runpod read access');
      await page.getByLabel('Credential', { exact: true }).fill('synthetic-evidence-only-21-no-real-account');
      await page.getByRole('button', { name: 'Save credential', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'Credential saved on this Mac.' }).waitFor();
      const saved = page.getByRole('combobox', { name: /^Saved credential/ });
      await saved.selectOption({ label: 'Synthetic Runpod read access (active)' });
      // The selected row shows only safe metadata. No screenshot is taken during entry.
      assert.equal(await page.getByLabel('Credential', { exact: true }).inputValue(), '');
      await screenshot('after-safe-metadata.png');
    }
    return { menuLabels, files };
  } finally {
    if (application) await application.close();
    await rm(profile, { recursive: true, force: true });
  }
}
const base = await capture(baseExecutable, false);
const changed = await capture(changedExecutable, true);
await writeFile(path.join(directory, 'capture-result.json'), `${JSON.stringify({ size, base, changed, credentialInputsEmptyInScreenshots: true, realCredentialsUsed: false }, null, 2)}\n`);
console.log('Captured base shell, changed credential entry and synthetic safe metadata.');
