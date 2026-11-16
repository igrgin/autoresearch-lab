import { query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { ChildProcess } from 'node:child_process';
import { ClaudeFailure, ClaudeReason, QUALIFICATION_LIMITS } from './contracts';
import { intersectModels, readModels } from './discovery';
import { qualifyMessages } from './qualification';
import { sdkOptions } from './runtime';

// Private one-operation IPC; this utility has no renderer or credential-service port.
let started = false;
process.parentPort.on('message', async ({ data }: { data: {
  kind: 'discover' | 'qualify'; directory: string; executable: string; credentialId: string; key: string; modelId?: string;
} }) => {
  if (started) return;
  started = true;
  const controller = new AbortController(); let child: ChildProcess | undefined;
  const kill = () => { controller.abort(); if (child?.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ } } };
  process.once('exit', kill);
  // Parent also has an independent deadline and process-group cleanup.
  const timer = setTimeout(kill, QUALIFICATION_LIMITS.wallMs);
  let session: ReturnType<typeof query> | undefined;
  try {
    const api = await readModels(data.key, controller.signal);
    const options = sdkOptions(data.directory, data.executable, data.key, controller, data.modelId, next => {
      child = next;
      process.parentPort.postMessage({ childPid: next.pid });
    });
    // Keep input open during initialization/catalog discovery; no inference is
    // dispatched until the user-requested qualification explicitly releases it.
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    async function* input(): AsyncGenerator<SDKUserMessage> {
      await gate;
      if (!controller.signal.aborted) yield { type: 'user', session_id: '', parent_tool_use_id: null,
        message: { role: 'user', content: 'Return exactly the structured object {"status":"ok"}. This is a model access check.' } };
    }
    session = query({ prompt: input(), options });
    const sdk = await session.supportedModels();
    const catalog = intersectModels(api, sdk, data.credentialId);
    if (data.kind === 'discover') process.parentPort.postMessage({ result: { catalog } });
    else {
      if (!catalog.models.some(row => row.id === data.modelId)) throw new ClaudeFailure('unavailable_model');
      release();
      await qualifyMessages(session, data.modelId!);
      process.parentPort.postMessage({ result: { qualified: true } });
    }
  } catch (error) {
    const reason: ClaudeReason = error instanceof ClaudeFailure ? error.reason : 'unsupported_capability';
    process.parentPort.postMessage({ result: { reason } });
  } finally {
    clearTimeout(timer); kill(); session?.close();
    // Main waits for exit, then deletes the private incidental state directory.
    process.exit(0);
  }
});
