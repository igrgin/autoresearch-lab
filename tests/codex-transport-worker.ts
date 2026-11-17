import { CodexStore } from '../src/codex/store';
import { codexStoreFailure } from '../src/codex/errors';
import type { CodexStoreCommand } from '../src/codex/contract';
declare const process: NodeJS.Process & { parentPort: { postMessage(value: unknown): void; on(event: 'message', callback: (event: { data: { id: string; codex: CodexStoreCommand } }) => void): void } };
const store = new CodexStore(process.argv[2]);
process.parentPort.on('message', ({ data }) => {
  let reply;
  try {
    reply = { ok: true, value: store.handle(data.codex) };
    if (['default', 'run_save'].includes(data.codex.kind) && process.argv[3] === 'rejected_reply') throw new Error('Controlled post-commit storage exception');
  }
  catch (error) { reply = codexStoreFailure(error, data.codex, data.id); }
  if (['default', 'run_save'].includes(data.codex.kind) && ['timeout', 'disconnect'].includes(process.argv[3])) {
    if (process.argv[3] === 'disconnect') { store.close(); process.exit(0); }
    return; // Deliberately drop a committed reply; real main's timer must expire.
  }
  process.parentPort.postMessage({ id: data.id, codexReply: reply });
});
process.on('exit', () => { try { store.close(); } catch { /* already closed in disconnect fixture */ } });
process.parentPort.postMessage({ ready: true });
