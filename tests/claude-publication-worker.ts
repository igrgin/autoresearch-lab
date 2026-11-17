import { existsSync } from 'node:fs';
import path from 'node:path';
import { ClaudeSelectionStore, type SelectionCommand } from '../src/claude/store';
import { ClaudeFailure, failureReply } from '../src/claude/contracts';
const directory = process.argv[2], mode = process.argv[3];
const store = new ClaudeSelectionStore(directory);
process.parentPort.on('message', ({data}: {data: {id: string; selection: SelectionCommand}}) => {
  const command = data.selection;
  if (command.kind === 'save' || command.kind === 'save_run') {
    process.parentPort.postMessage({ queued: true });
    const deadline = Date.now() + 10_000;
    // Controlled blocking gate keeps the actual synchronous writer and its FIFO
    // barrier behind this operation while Electron main remains independently live.
    while (!existsSync(path.join(directory, 'commit-gate'))) {
      if (Date.now() >= deadline) throw new Error('Controlled gate expired');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  let reply;
  try { reply = { ok: true as const, value: store.handle(command) }; }
  catch (error) { reply = failureReply(error instanceof ClaudeFailure ? error.reason : 'unavailable', data.id); }
  if (command.kind === 'save' || command.kind === 'save_run') process.parentPort.postMessage({ committed: true, ok: reply.ok });
  if ((mode !== 'normal' && (command.kind === 'save' || command.kind === 'save_run')) || (mode === 'exit' && command.kind === 'barrier')) return;
  process.parentPort.postMessage({ id: data.id, reply });
});
process.on('exit', () => store.close());
process.parentPort.postMessage({ready:true});
