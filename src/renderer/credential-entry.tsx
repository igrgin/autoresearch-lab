import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CredentialEntry, ENTRY_CATEGORIES, EntryMetadata, EntryReply } from '../security/entry-contract';
import './style.css';

declare global { interface Window { credentialEntry: { save(entry: CredentialEntry): Promise<EntryReply>; list(): Promise<EntryMetadata[]>; replace(id: string, value: string): Promise<EntryReply>; revoke(id: string): Promise<EntryReply> } } }
function CredentialSettings() {
  const [category, setCategory] = useState<CredentialEntry['category']>('runpod');
  const [label, setLabel] = useState('');
  const [message, setMessage] = useState('Credentials stay on this Mac. Moving a project requires authentication again.');
  const [entries, setEntries] = useState<EntryMetadata[]>([]);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  return <main style={{ padding: 28 }}>
    <h1>Credential settings</h1>
    <p><button type="button" onClick={async () => {
      try { setEntries(await window.credentialEntry.list()); setMessage('Credential storage unlocked.'); }
      catch { setMessage('Credential storage is unavailable. Unlock the Keychain and try again.'); }
    }}>Unlock saved credentials</button></p>
    <p><label>Saved credential <select value={selected} onChange={event => setSelected(event.target.value)}>
      <option value="">New credential</option>{entries.map(entry => <option key={entry.id} value={entry.id}>{entry.label || entry.category} ({entry.status})</option>)}
    </select></label></p>
    {selected && <p><button type="button" disabled={busy} onClick={async () => {
      setBusy(true);
      try { const result = await window.credentialEntry.revoke(selected); setMessage(result.message); setEntries(await window.credentialEntry.list()); }
      catch { setMessage('Credential storage is unavailable.'); } finally { setBusy(false); }
    }}>Revoke app access</button></p>}
    <form autoComplete="off" onSubmit={async event => {
      event.preventDefault(); const form = event.currentTarget;
      const input = form.elements.namedItem('credential') as HTMLInputElement;
      setBusy(true);
      try {
        const result = selected ? await window.credentialEntry.replace(selected, input.value) : await window.credentialEntry.save({ category, label, value: input.value });
        setMessage(result.message); input.value = ''; setEntries(await window.credentialEntry.list()); setSelected('');
      } catch { setMessage('Credential storage is unavailable. Unlock the Keychain and try again.'); input.value = ''; }
      finally { setBusy(false); }
    }}>
      <p><label>Integration <select disabled={!!selected} value={category} onChange={event => setCategory(event.target.value as CredentialEntry['category'])}>
        {ENTRY_CATEGORIES.map(value => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}
      </select></label></p>
      <p><label>Label <input disabled={!!selected} value={label} maxLength={120} onChange={event => setLabel(event.target.value)} /></label></p>
      <p><label>Credential <input name="credential" type="password" autoComplete="off" required maxLength={65536} /></label></p>
      <button disabled={busy} type="submit">{busy ? 'Saving…' : selected ? 'Replace credential' : 'Save credential'}</button>
    </form>
    <p role="status">{message}</p>
  </main>;
}
createRoot(document.getElementById('root')!).render(<CredentialSettings />);
