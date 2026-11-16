import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import electron from 'electron';
const directory = await mkdtemp(path.join(os.tmpdir(), 'lab-research-main-'));
const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
try {
  execFileSync(electron, [path.resolve('.webpack/tests/research-transport-main.cjs'), `--user-data-dir=${directory}`], { env: environment, stdio: 'inherit', timeout: 60_000 });
} finally { await rm(directory, { recursive: true, force: true }); }
