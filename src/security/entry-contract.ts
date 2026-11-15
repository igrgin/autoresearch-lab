// Write-only credential-entry contract. Ordinary shell preload never imports this API.
export const ENTRY_CATEGORIES = ['runpod', 'vast', 'openai', 'anthropic', 'ssh_passphrase', 'model_download'] as const;
export interface CredentialEntry { category: typeof ENTRY_CATEGORIES[number]; label: string; value: string }
export interface EntryReply { ok: boolean; message: string }
export function validEntry(input: unknown): input is CredentialEntry {
  if (!input || typeof input !== 'object') return false;
  const entry = input as CredentialEntry;
  return Object.keys(entry).length === 3 && ENTRY_CATEGORIES.includes(entry.category) &&
    typeof entry.label === 'string' && entry.label.length <= 120 && typeof entry.value === 'string' &&
    entry.value.length > 0 && entry.value.length <= 64 * 1024;
}

export interface EntryMetadata { id: string; label: string; category: string; status: string; supersededById?: string; replacedAt?: string }

// Fixed documentation destinations only; entry IPC never accepts a URL.
export const CREDENTIAL_HELP: Record<typeof ENTRY_CATEGORIES[number], { hint: string; title: string; url?: string }> = {
  runpod: { hint: 'Use a restricted, read-only Runpod API key.', title: 'Manage or revoke at Runpod', url: 'https://console.runpod.io/user/credentials' },
  vast: { hint: 'Use a Vast.ai API key with instance_read access.', title: 'Manage or revoke at Vast.ai', url: 'https://cloud.vast.ai/manage-keys/' },
  openai: { hint: 'Use an OpenAI Platform API key for Codex inference.', title: 'OpenAI API key guide', url: 'https://developers.openai.com/api/docs/quickstart' },
  anthropic: { hint: 'Use an Anthropic API key for the Claude integration.', title: 'Manage Anthropic API keys', url: 'https://platform.claude.com/settings/keys' },
  ssh_passphrase: { hint: 'Enter the passphrase for your selected SSH identity, not the private key file.', title: 'SSH passphrase' },
  model_download: { hint: 'Use a read-only token for the selected model repository.', title: 'Model access token guide', url: 'https://huggingface.co/docs/hub/en/security-tokens' },
};
