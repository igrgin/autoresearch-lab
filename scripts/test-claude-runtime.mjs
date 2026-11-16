import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import { query } from '@anthropic-ai/claude-agent-sdk/core';

// Controlled synthetic initialization, with external network denied by the OS.
// This is runtime/capability evidence, never live account or inference proof.
const build = await mkdtemp(path.join(os.tmpdir(), 'lab-claude-runtime-build-'));
execFileSync('node_modules/.bin/tsc', ['--noEmit', 'false', '--rootDir', '.', '--outDir', build], { stdio: 'pipe' });
const require = createRequire(import.meta.url);
const { sdkOptions, sandboxProfile } = require(path.join(build, 'src/claude/runtime.js'));
const { checkSurface } = require(path.join(build, 'src/claude/qualification.js'));
const temporary = [build];
after(async () => { for (const folder of temporary) await rm(folder, { recursive: true, force: true }); });
async function directory() {
  const folder = await realpath(await mkdtemp(path.join(os.tmpdir(), 'lab-claude-runtime-'))); temporary.push(folder); return folder;
}
const supported = process.platform === 'darwin' && process.arch === 'arm64';
test('macOS sandbox permits private state and denies external fixture reads/writes and helper execution', { skip: !supported }, async () => {
  const inside = await directory(); const outside = await directory();
  const externalFile = path.join(outside, 'synthetic-credential.txt'); await writeFile(externalFile, 'synthetic-external-credential');
  const ownFile = path.join(inside, 'permitted.txt'); await writeFile(ownFile, 'permitted');
  const program = `const fs=require('node:fs'),assert=require('node:assert/strict'),cp=require('node:child_process');
    assert.equal(fs.readFileSync(process.argv[1],'utf8'),'permitted');
    assert.throws(()=>fs.readFileSync(process.argv[2]),e=>e.code==='EPERM'||e.code==='EACCES');
    assert.throws(()=>fs.writeFileSync(process.argv[2],'changed'),e=>e.code==='EPERM'||e.code==='EACCES');
    const child=cp.spawnSync('/bin/sh',['-c','exit 0']);assert.ok(child.error);process.stdout.write('isolated');`;
  const output = execFileSync('/usr/bin/sandbox-exec', ['-p', sandboxProfile(inside, process.execPath), process.execPath, '-e', program, ownFile, externalFile], {
    env: { HOME: inside, TMPDIR: inside, PATH: '/usr/bin:/bin' }, timeout: 10_000,
  });
  assert.equal(output.toString(), 'isolated'); assert.equal(await readFile(externalFile, 'utf8'), 'synthetic-external-credential');
});

test('pinned native SDK initializes, resolves supportedModels and advertises only qualified builtins with external network denied', { skip: !supported, timeout: 40_000 }, async () => {
  const dir = await directory(); const executable = path.resolve('node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude');
  const secret = 'synthetic-offline-claude-runtime-key-50';
  const abortController = new AbortController(); const timer = setTimeout(() => abortController.abort(), 30_000);
  let child; let session; let release;
  const gate = new Promise(resolve => { release = resolve; });
  async function* input() {
    await gate;
    if (!abortController.signal.aborted) yield { type: 'user', session_id: '', parent_tool_use_id: null,
      message: { role: 'user', content: 'Return a structured ok status.' } };
  }
  try {
    const options = sdkOptions(dir, executable, secret, abortController, undefined, () => {});
    options.spawnClaudeCodeProcess = spawnOptions => {
      const offlineProfile = sandboxProfile(dir, executable).replace('(allow network-outbound)', '');
      child = spawn('/usr/bin/sandbox-exec', ['-p', offlineProfile, executable, ...spawnOptions.args], {
        cwd: dir, env: spawnOptions.env, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
      });
      child.stderr.resume(); return child;
    };
    session = query({ prompt: input(), options });
    const models = await session.supportedModels();
    assert.ok(models.length > 0); assert.ok(models.every(m => typeof m.resolvedModel === 'string' && m.resolvedModel.startsWith('claude-')));
    release(); let initialized = false;
    for await (const message of session) {
      if (message.type === 'system' && message.subtype === 'init') { checkSurface(message); initialized = true; break; }
    }
    assert.equal(initialized, true);
  } finally {
    clearTimeout(timer); abortController.abort(); release(); session?.close();
    if (child?.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ } }
  }
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const bytes = await readFile(path.join(entry.parentPath, entry.name));
      assert.ok(!bytes.includes(Buffer.from(secret)), 'native incidental file retained synthetic API key');
    }
  }
});
