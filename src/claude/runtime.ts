import { spawn, ChildProcess } from 'node:child_process';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { childEnvironment } from '../security/operations';
import { QUALIFICATION_LIMITS } from './contracts';

// macOS seatbelt prevents the SDK subprocess reading host auth, projects/vaults,
// inspecting other processes, or executing helpers. No untrusted code runs here.
export function sandboxProfile(directory: string, executable: string): string {
  const literal = (value: string) => JSON.stringify(value);
  return `(version 1)(deny default)
    (allow process-fork)(allow process-exec (literal ${literal(executable)}))
    (allow sysctl-read)(allow mach-lookup)
    (deny mach-lookup (global-name "com.apple.securityd") (global-name "com.apple.securityd.system"))
    (allow file-ioctl)(allow network-bind)(allow network-outbound)(allow network-inbound (local unix-socket))
    (allow file-read-metadata)
    (allow file-read-data (vnode-type DIRECTORY))
    (allow file-read* (literal "/") (subpath "/System") (subpath "/usr/lib") (subpath "/usr/share")
      (subpath "/Library/Apple") (subpath "/private/var/db/timezone") (literal "/dev/urandom") (literal "/dev/null")
      (literal "/private/etc/resolv.conf") (literal "/private/etc/hosts")
      (literal ${literal(executable)}) (subpath ${literal(directory)}))
    (allow file-write* (subpath ${literal(directory)}) (literal "/dev/null"))`;
}

export function sdkOptions(directory: string, executable: string, key: string, abortController: AbortController,
  model: string | undefined, onChild: (child: ChildProcess) => void): Options {
  const env = { ...childEnvironment('claude', { home: directory, temporary: directory, executablePath: '/usr/bin:/bin' }, key),
    CLAUDE_CONFIG_DIR: directory, CLAUDE_CODE_TMPDIR: directory, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1', CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: '1' };
  return { cwd: directory, env, pathToClaudeCodeExecutable: executable, abortController,
    tools: [], mcpServers: {}, strictMcpConfig: true, settingSources: [], plugins: [], agents: {},
    extraArgs: { bare: null, 'disable-slash-commands': null },
    settings: { disableAllHooks: true }, systemPrompt: 'Perform only the application model-access check. Do not inspect files or run commands.',
    permissionMode: 'dontAsk', canUseTool: async () => ({ behavior: 'deny', message: 'Tools are unavailable during model qualification.' }),
    persistSession: false, includePartialMessages: false, model,
    maxTurns: QUALIFICATION_LIMITS.maxTurns, maxBudgetUsd: QUALIFICATION_LIMITS.maxBudgetUsd,
    outputFormat: { type: 'json_schema', schema: { type: 'object', properties: { status: { const: 'ok', type: 'string' } }, required: ['status'], additionalProperties: false } },
    stderr: () => { /* Never forward raw native diagnostics. */ },
    spawnClaudeCodeProcess: options => {
      const child = spawn('/usr/bin/sandbox-exec', ['-p', sandboxProfile(directory, executable), executable, ...options.args], {
        // SDK adds only its own protocol/version variables to the explicit env.
        cwd: directory, env: options.env, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
      });
      child.stderr?.resume(); // bounded discard; SDK messages travel only over stdout
      onChild(child);
      return child;
    },
  };
}
