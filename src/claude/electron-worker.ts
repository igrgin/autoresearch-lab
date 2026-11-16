import { app, utilityProcess } from 'electron';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { childEnvironment } from '../security/operations';
import { ClaudeWorker, WorkerResult } from './host';
import { QUALIFICATION_LIMITS } from './contracts';

export const runClaudeWorker: ClaudeWorker = async (input, signal) => {
  if (process.platform !== 'darwin' || process.arch !== 'arm64' || signal.aborted) return { reason: 'unsupported_capability' };
  const directory = await realpath(await mkdtemp(path.join(app.getPath('temp'), 'lab-claude-')));
  const executable = app.isPackaged ? path.join(process.resourcesPath, 'claude-agent-sdk-darwin-arm64', 'claude') :
    path.resolve('node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude');
  try {
    return await new Promise<WorkerResult>((resolve) => {
      const child = utilityProcess.fork(path.join(__dirname, 'claude-worker.cjs'), [], { serviceName: 'Claude model access',
        env: childEnvironment('candidate', { home: directory, temporary: directory, executablePath: '/usr/bin:/bin' }), stdio: 'pipe' });
      child.stdout?.resume(); child.stderr?.resume();
      let childPid: number | undefined; let result: WorkerResult = { reason: 'unavailable' }; let stopped = false;
      const killGroup = () => { if (childPid) { try { process.kill(-childPid, 'SIGKILL'); } catch { /* confirmed gone or no authority */ } } };
      const stop = () => { stopped = true; result = { reason: 'unavailable' }; killGroup(); child.kill(); };
      signal.addEventListener('abort', stop, { once: true });
      const timer = setTimeout(stop, QUALIFICATION_LIMITS.wallMs + 5000);
      child.on('message', (message: { childPid?: number; result?: WorkerResult }) => {
        if (Number.isSafeInteger(message?.childPid) && message.childPid! > 1) childPid = message.childPid;
        if (stopped) killGroup();
        if (message?.result && !stopped) result = message.result;
      });
      child.once('exit', code => {
        clearTimeout(timer); signal.removeEventListener('abort', stop); killGroup();
        resolve(signal.aborted ? { reason: 'authentication_required' } : code === 0 ? result : { reason: 'unavailable' });
      });
      child.postMessage({ ...input, directory, executable });
      if (signal.aborted) stop();
    });
  } catch { return { reason: 'unavailable' }; }
  finally { await rm(directory, { recursive: true, force: true }); }
};
