import { CLAUDE_CODE_VERSION, ClaudeFailure } from './contracts';

// This pinned binary advertises its compiled-in catalogs even with tools: [].
// They grant no Skill/Agent tool access. Filesystem/custom additions are denied.
export const BUILTIN_AGENTS = ['claude', 'Explore', 'general-purpose', 'Plan', 'statusline-setup'];
export const BUILTIN_PLUGINS = ['cc-plugin-agents-md', 'cc-plugin-privacy', 'cc-plugin-plugin-authoring'];
export function checkSurface(m: Record<string, unknown>): void {
  if (m.apiKeySource !== 'ANTHROPIC_API_KEY' || m.claude_code_version !== CLAUDE_CODE_VERSION || m.permissionMode !== 'dontAsk' ||
      !Array.isArray(m.tools) || m.tools.some(t => t !== 'StructuredOutput') ||
      !Array.isArray(m.mcp_servers) || m.mcp_servers.length || !Array.isArray(m.skills) || m.skills.length ||
      !Array.isArray(m.plugins) || m.plugins.some(p => !p || !BUILTIN_PLUGINS.includes(p.name) || p.path !== 'builtin' || p.source !== `${p.name}@builtin`) ||
      (Array.isArray(m.agents) && m.agents.some(a => !BUILTIN_AGENTS.includes(a)))) throw new ClaudeFailure('unsupported_capability');
}

// Raw SDK messages stay in the trusted worker. Only this fixed verdict crosses IPC.
export async function qualifyMessages(messages: AsyncIterable<unknown>, selected: string): Promise<void> {
  let initialized = false;
  for await (const raw of messages) {
    if (!raw || typeof raw !== 'object') throw new ClaudeFailure('qualification_failed');
    const m = raw as Record<string, unknown>;
    if (m.type === 'system' && m.subtype === 'init') {
      if (m.model !== selected) throw new ClaudeFailure('model_mismatch');
      checkSurface(m);
      initialized = true;
    }
    if (m.type === 'assistant') {
      const message = m.message as { model?: unknown; content?: { type?: unknown; name?: unknown }[] } | undefined;
      if (message?.model && message.model !== selected) throw new ClaudeFailure('model_mismatch');
      if (message?.content?.some(block => block.type === 'tool_use' && block.name !== 'StructuredOutput')) throw new ClaudeFailure('unsupported_capability');
      if (m.error === 'authentication_failed') throw new ClaudeFailure('authentication_required');
      if (m.error === 'model_not_found') throw new ClaudeFailure('unavailable_model');
      if (['oauth_org_not_allowed', 'account_on_hold', 'verification_required', 'billing_error'].includes(String(m.error))) throw new ClaudeFailure('unauthorized_model');
    }
    if (m.type === 'result') {
      if (!initialized || m.subtype !== 'success' || m.is_error !== false) throw new ClaudeFailure('qualification_failed');
      const output = m.structured_output as Record<string, unknown> | undefined;
      if (!output || Object.keys(output).length !== 1 || output.status !== 'ok') throw new ClaudeFailure('qualification_failed');
      const usage = m.modelUsage;
      if (!usage || typeof usage !== 'object' || !Object.keys(usage).length || Object.keys(usage).some(id => id !== selected)) throw new ClaudeFailure('model_mismatch');
      return;
    }
  }
  throw new ClaudeFailure('qualification_failed');
}
