// Regenerate only the auth/catalog request bindings from the exact bundled runtime.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const executable = path.resolve('node_modules/@openai/codex-runtime/vendor/aarch64-apple-darwin/bin/codex');
const source = await readFile('src/codex/stdio.ts', 'utf8');
const checksum = source.match(/CODEX_SHA256 = '([0-9a-f]{64})'/)?.[1];
if (createHash('sha256').update(await readFile(executable)).digest('hex') !== checksum) throw new Error('Bundled Codex checksum mismatch.');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'lab-codex-bindings-'));
try {
  const home = path.join(temporary, 'home'); await mkdir(home, { mode: 0o700 });
  const out = path.join(temporary, 'schema');
  execFileSync(executable, ['app-server', 'generate-ts', '--out', out], {
    env: { HOME: home, CODEX_HOME: home, TMPDIR: temporary, PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' }, cwd: home, stdio: 'pipe', timeout: 30_000,
  });
  const seen = new Set();
  async function copy(relative) {
    if (seen.has(relative)) return;
    seen.add(relative);
    const contents = await readFile(path.join(out, relative), 'utf8');
    const target = path.join('src/codex/generated', relative);
    await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, contents);
    for (const match of contents.matchAll(/from "([^"]+)"/g)) await copy(path.normalize(path.join(path.dirname(relative), `${match[1]}.ts`)));
  }
  for (const name of ['v2/ConfigReadParams.ts', 'InitializeParams.ts', 'v2/LoginAccountParams.ts', 'v2/GetAccountParams.ts', 'v2/ModelListParams.ts']) await copy(name);
  console.log(`Generated ${seen.size} auth/catalog request bindings from the pinned Codex binary.`);
} finally { await rm(temporary, { recursive: true, force: true }); }
