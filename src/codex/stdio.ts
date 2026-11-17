import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { PrivateFiles } from '../security/private-files';
import { childEnvironment } from '../security/operations';
import type { AuthMethod, AuthRpc } from './catalog';
import { CodexFailure, rpcFailure } from './errors';

export const CODEX_SHA256 = '739cda86e15d30a6e2b40cf8dcbbfb988aaf48b305b27065573bb8e9fd41d002';
const MAX_FRAME = 2 * 1024 * 1024;
const active = new Set<StdioAuthRpc>();
export function stopCodexAuthentication(): void { for (const rpc of active) rpc.terminate(); }
// This transport has no thread/turn/tool methods. #46 must add its own qualified execution boundary.
export class StdioAuthRpc implements AuthRpc {
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: NodeJS.Timeout }>();
  private nextId = 1;
  private buffer = '';
  private total = 0;
  private stopped = false;
  private readonly decoder = new TextDecoder('utf-8', { fatal: true });
  private readonly exited: Promise<void>;
  private readonly deadline: NodeJS.Timeout;
  constructor(private readonly child: ChildProcessWithoutNullStreams, signal: AbortSignal) {
    active.add(this);
    this.exited = new Promise(resolve => child.once('close', () => { this.terminate(); resolve(); }));
    this.deadline = setTimeout(() => this.terminate(), 30_000);
    const abort = () => this.terminate();
    signal.addEventListener('abort', abort, { once: true });
    void this.exited.then(() => signal.removeEventListener('abort', abort));
    child.on('error', () => this.terminate());
    child.stdin.on('error', () => this.terminate());
    child.stderr.on('data', () => { /* auth diagnostics excluded by construction; drain, never spool */ });
    child.stdout.on('data', (chunk: Buffer) => {
      if (this.stopped) return;
      try {
        this.total += chunk.length;
        if (this.total > 16 * MAX_FRAME) throw new Error();
        this.buffer += this.decoder.decode(chunk, { stream: true });
        let newline: number;
        while ((newline = this.buffer.indexOf('\n')) >= 0) {
          if (newline > MAX_FRAME) throw new Error();
          const line = this.buffer.slice(0, newline); this.buffer = this.buffer.slice(newline + 1);
          if (line.trim()) this.receive(JSON.parse(line));
        }
        if (Buffer.byteLength(this.buffer) > MAX_FRAME) throw new Error();
      } catch { this.terminate(new CodexFailure('incompatible_version')); }
    });
    if (signal.aborted) this.terminate();
  }
  static async start(executable: string, privateRoot: string, signal: AbortSignal): Promise<StdioAuthRpc> {
    try {
      // Verify the exact distributed runtime before it can receive a credential.
      if (createHash('sha256').update(await readFile(executable)).digest('hex') !== CODEX_SHA256) throw new CodexFailure('incompatible_version');
      const home = path.join(privateRoot, 'home'); const state = path.join(privateRoot, 'state');
      const temporary = path.join(privateRoot, 'tmp'); const work = path.join(privateRoot, 'work');
      for (const directory of [privateRoot, home, state, temporary, work]) await new PrivateFiles(directory).prepare();
      if (signal.aborted) throw new CodexFailure('authentication_required');
      const env = { ...childEnvironment('codex', { home, temporary, executablePath: '/usr/bin:/bin' }), CODEX_HOME: state };
      const child = spawn(executable, ['-c', 'cli_auth_credentials_store="ephemeral"', '-c', 'model_provider="openai"',
        '-c', 'forced_login_method="api"', '-c', 'otel.log_user_prompt=false', 'app-server', '--listen', 'stdio://'],
      { env, cwd: work, stdio: 'pipe', detached: true });
      return new StdioAuthRpc(child, signal);
    } catch (error) { throw error instanceof CodexFailure ? error : new CodexFailure('unavailable'); }
  }
  private receive(message: unknown) {
    if (!message || typeof message !== 'object') throw new Error();
    const value = message as { id?: unknown; method?: unknown; result?: unknown; error?: unknown };
    if (typeof value.method === 'string') {
      if (value.id !== undefined) this.child.stdin.write(JSON.stringify({ id: value.id, error: { code: -32601, message: 'This client does not support server requests.' } }) + '\n');
      return; // no native notifications, login diagnostics or raw history enter application capture
    }
    if (typeof value.id !== 'number') throw new Error();
    const waiting = this.pending.get(value.id);
    if (!waiting) throw new Error();
    this.pending.delete(value.id); clearTimeout(waiting.timer);
    if (value.error) waiting.reject(rpcFailure(value.error));
    else if (Object.hasOwn(value, 'result')) waiting.resolve(value.result);
    else waiting.reject(new CodexFailure('incompatible_version'));
  }
  request(method: AuthMethod, params: unknown): Promise<unknown> {
    if (!['initialize', 'config/read', 'account/login/start', 'account/read', 'model/list'].includes(method)) return Promise.reject(new CodexFailure('invalid_input'));
    if (this.stopped) return Promise.reject(new CodexFailure('unavailable'));
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => this.terminate(), 10_000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  notifyInitialized(): void {
    if (this.stopped) throw new CodexFailure('unavailable');
    this.child.stdin.write('{"method":"initialized"}\n');
  }
  terminate(error = new CodexFailure('unavailable')): void {
    if (this.stopped) return;
    this.stopped = true; active.delete(this); clearTimeout(this.deadline); this.buffer = '';
    for (const waiting of this.pending.values()) { clearTimeout(waiting.timer); waiting.reject(error); }
    this.pending.clear(); this.child.stdin.destroy();
    // Auth/catalog processes cannot execute tools. Kill their owned process group on failure/revocation/quit.
    if (this.child.pid) { try { process.kill(-this.child.pid, 'SIGKILL'); } catch { /* already exited */ } }
  }
  async close(): Promise<void> { this.terminate(); await this.exited; }
}
