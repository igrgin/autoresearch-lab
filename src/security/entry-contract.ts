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

export interface EntryMetadata { id: string; label: string; category: string; status: string }
