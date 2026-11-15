import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CredentialEntry, CREDENTIAL_HELP, ENTRY_CATEGORIES, EntryMetadata, EntryReply } from '../security/entry-contract';
import './credential-entry.css';

declare global { interface Window { credentialEntry: { save(entry: CredentialEntry): Promise<EntryReply>; list(): Promise<EntryMetadata[]>; replace(id: string, value: string): Promise<EntryReply>; revoke(id: string): Promise<EntryReply>; help(category: string): Promise<EntryReply> } } }
const names: Record<string, string> = { runpod: 'Runpod', vast: 'Vast.ai', openai: 'OpenAI · Codex', anthropic: 'Anthropic · Claude', ssh_passphrase: 'SSH passphrase', model_download: 'Model download' };
function LockIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></svg>;
}
function CredentialSettings() {
  const [category, setCategory] = useState<CredentialEntry['category']>('runpod');
  const [label, setLabel] = useState('');
  const [feedback, setFeedback] = useState<{ message: string; error: boolean }>();
  const [entries, setEntries] = useState<EntryMetadata[]>([]);
  const [selected, setSelected] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hasCredential, setHasCredential] = useState(false);
  const [fieldError, setFieldError] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [storageFault, setStorageFault] = useState(false);
  const confirmation = useRef<HTMLDialogElement>(null);
  const historyDialog = useRef<HTMLDialogElement>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  useEffect(() => {
    if (historyOpen) historyDialog.current?.showModal(); else if (historyDialog.current?.open) historyDialog.current.close();
  }, [historyOpen]);
  useEffect(() => {
    const dialog = confirmation.current;
    if (confirmRevoke) dialog?.showModal(); else if (dialog?.open) dialog.close();
  }, [confirmRevoke]);
  const credential = useRef<HTMLInputElement>(null);
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (!revealed) return;
    const hide = () => setRevealed(false);
    const timer = setTimeout(hide, 15_000);
    window.addEventListener('blur', hide);
    return () => { clearTimeout(timer); window.removeEventListener('blur', hide); };
  }, [revealed]);
  const currentEntries = entries.filter(entry => !entry.supersededById).sort((a, b) =>
    (a.label || names[a.category]).localeCompare(b.label || names[b.category], undefined, { sensitivity: 'base', numeric: true }));
  const previousEntries = entries.filter(entry => entry.supersededById);
  const active = entries.find(entry => entry.id === selected);
  const help = CREDENTIAL_HELP[(active?.category || category) as CredentialEntry['category']];
  async function openHelp() {
    try { const reply = await window.credentialEntry.help(active?.category || category); if (!reply.ok) notify(reply); }
    catch { notify({ ok: false, message: 'Could not open the credential guide. Check your default browser.' }); }
  }
  const guide = help.url ? <a href={help.url} className="guide-link" onClick={event => { event.preventDefault(); void openHelp(); }}>{help.title} <span aria-hidden="true">↗</span><span className="visually-hidden"> (opens in browser)</span></a> : null;
  const clearInput = () => { setFieldError(false); setRevealed(false); if (credential.current) credential.current.value = ''; setHasCredential(false); };
  const choose = (id: string) => { clearInput(); setSelected(id); setFeedback(undefined); setConfirmRevoke(false); };
  const notify = (reply: EntryReply) => setFeedback({ message: reply.message, error: !reply.ok });
  async function refresh() {
    setBusy(true); setFeedback(undefined);
    try {
      const items = await window.credentialEntry.list(); setEntries(items); setLoaded(true); setStorageFault(false);
      if (selected && !items.some(entry => entry.id === selected)) choose('');
    } catch { clearInput(); setStorageFault(true); setFeedback({ message: 'Credential storage is unavailable. Changes are disabled until access is restored.', error: true }); }
    finally { setBusy(false); }
  }
  async function revoke() {
    if (!active) return;
    setBusy(true); clearInput();
    try {
      const reply = await window.credentialEntry.revoke(active.id); notify(reply);
      if (reply.ok) { setEntries(await window.credentialEntry.list()); setConfirmRevoke(false); }
    } catch { setFeedback({ message: 'Could not revoke app access. Check credential storage and try again.', error: true }); }
    finally { setBusy(false); }
  }
  return <main className="credentials" aria-busy={busy}>
    <header className="credentials-header">
      <div><div className="breadcrumb">Autoresearch Lab <span>/</span> Settings</div>
        <h1>Credential settings</h1><p>Manage access to your research integrations.</p></div>
      <span className="local-badge"><LockIcon /> On this Mac</span>
    </header>
    <div className="privacy-note"><LockIcon /><p><strong>Encrypted with macOS Keychain.</strong> Stored values are never shown or included in project exports.</p></div>
    <div className="credentials-layout">
      <section className="saved-panel" aria-labelledby="saved-heading">
        <div className="panel-heading"><h2 id="saved-heading">Saved credentials {loaded && <span className="count">{currentEntries.length}</span>}</h2>
          {loaded && <button className="text-button" disabled={busy} onClick={() => void refresh()}>Refresh</button>}</div>
        <button className={`new-credential ${!selected ? 'is-selected' : ''}`} disabled={busy || storageFault} onClick={() => choose('')} aria-pressed={!selected}><span aria-hidden="true">＋</span> Add credential</button>
        {!loaded ? <div className="list-empty"><div className="empty-lock"><LockIcon /></div><p>Unlock to view credential names<br />and manage app access.</p><button className="secondary" disabled={busy} onClick={() => void refresh()}>{busy ? 'Unlocking…' : 'Unlock saved credentials'}</button></div> :
          currentEntries.length === 0 ? <div className="list-empty"><p>No saved credentials yet.<br />Add your first integration here.</p></div> :
            <ul className="credential-list">{currentEntries.map(entry => <li key={entry.id}><button className={`credential-row ${selected === entry.id ? 'is-selected' : ''}`} disabled={busy || storageFault} onClick={() => choose(entry.id)} aria-pressed={selected === entry.id}>
              <span className="integration-mark" aria-hidden="true">{(names[entry.category] || entry.category).slice(0, 1)}</span>
              <span className="row-copy"><strong>{entry.label || names[entry.category]}</strong><span>{names[entry.category]}</span><span className={`row-status ${entry.status !== 'active' ? 'is-revoked' : ''}`}>{entry.status === 'active' ? 'App access allowed' : 'App access revoked'}</span></span>
            </button></li>)}</ul>}
        {previousEntries.length > 0 && <div className="previous-versions"><button className="history-link" onClick={() => { setRevealed(false); setHistoryOpen(true); }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2" /></svg><span>View previous versions ({previousEntries.length})<small>All integrations</small></span></button></div>}

        <p className="panel-footer">{loaded ? 'Manage credentials here; connect accounts separately.' : 'Saving a credential does not connect an account. Only its named integration can use it.'}</p>
      </section>
      <section className="entry-panel" aria-labelledby="entry-heading">
        <div className="entry-heading"><div><h2 id="entry-heading">{active ? 'Manage credential' : 'Add a credential'}</h2>
          <p>{active ? (active.status === 'active' ? 'Replace the value or revoke this app’s access.' : 'Save a replacement to restore this app’s access.') : 'Choose an integration and securely save its credential.'}</p></div>
          {active && <span className={`status-badge ${active.status !== 'active' ? 'revoked' : ''}`}>{active.status === 'active' ? 'App access allowed' : 'App access revoked'}</span>}
        </div>
        {feedback && <div className={`feedback ${feedback.error ? 'error' : 'success'}`} role={feedback.error ? 'alert' : 'status'}><span aria-hidden="true">{feedback.error ? '!' : '✓'}</span><div><p>{feedback.message}</p>{storageFault && <><ul className="recovery-steps"><li>If your login keychain is locked, unlock it in Keychain Access.</li><li>If it is already unlocked, restart Autoresearch Lab and retry.</li></ul><button className="error-retry" disabled={busy} onClick={() => void refresh()}>Retry credential storage</button></>}</div></div>}
        <form noValidate autoComplete="off" onSubmit={async event => {
          event.preventDefault(); if (!credential.current || busy || storageFault) return;
          if (!hasCredential) { setFieldError(true); setFeedback(undefined); credential.current.focus(); return; }
          setBusy(true); setFeedback(undefined);
          try {
            const reply = active ? await window.credentialEntry.replace(active.id, credential.current.value) :
              await window.credentialEntry.save({ category, label: label.trim() || names[category], value: credential.current.value });
            clearInput(); notify(reply);
            if (reply.ok) {
              const items = await window.credentialEntry.list(); setEntries(items); setLoaded(true); setStorageFault(false);
              const added = items.find(entry => !entries.some(old => old.id === entry.id) && entry.status === 'active');
              if (added) setSelected(added.id);
            }
          } catch { clearInput(); setFeedback({ message: 'Credential storage is unavailable. Unlock your macOS Keychain and try again.', error: true }); }
          finally { setBusy(false); }
        }}>
          <fieldset disabled={busy || storageFault}>
            {active ? <dl className="credential-metadata"><div><dt>Integration</dt><dd data-testid="saved-integration">{names[active.category]}</dd>{guide}</div><div><dt>Label</dt><dd data-testid="saved-label">{active.label || names[active.category]}</dd></div></dl> : <>
              <div className="field"><label htmlFor="integration">Integration</label><select id="integration" value={category} onChange={event => { clearInput(); setCategory(event.target.value as CredentialEntry['category']); }}>
                {ENTRY_CATEGORIES.map(value => <option key={value} value={value}>{names[value]}</option>)}
              </select><p className="field-help">{help.hint}</p>{guide}</div>
              <div className="field"><label htmlFor="label">Label <span aria-hidden="true" className="optional">Optional</span></label><input id="label" aria-label="Label" value={label} maxLength={120} placeholder="e.g. Personal Runpod" aria-describedby="label-help" onChange={event => setLabel(event.target.value)} />
                <p className="field-help" id="label-help">A name you’ll recognize. Keep the credential value out of this label.</p></div>
            </>}
            <div className="field"><label htmlFor="credential">{active ? 'New credential value' : 'Credential'} <span className="mask-note" aria-hidden="true">{revealed ? 'Visible for 15 seconds' : 'Hidden while typing'}</span></label><div className="secret-input"><input ref={credential} aria-label={active ? 'New credential value' : 'Credential'} id="credential" name="credential" type={revealed ? 'text' : 'password'} autoComplete="off" spellCheck={false} required maxLength={65536} placeholder={active ? 'Paste a replacement value' : category === 'runpod' ? 'Paste your Runpod API key' : 'Paste your credential'} aria-invalid={fieldError} aria-describedby={fieldError ? 'credential-error credential-help' : 'credential-help'} onChange={event => { setHasCredential(event.currentTarget.value.length > 0); setFieldError(false); }} /><button type="button" className="reveal-value" aria-pressed={revealed} disabled={busy || storageFault} onClick={() => setRevealed(value => !value)}>{revealed ? 'Hide entered value' : 'Show entered value'}</button></div>
              {fieldError && <p className="field-error" id="credential-error" role="alert">Enter a credential value before saving.</p>}
              <p className="field-help" id="credential-help">{active ? (active.status === 'active' ? 'Issuer revocation is separate. The app retains encrypted old values for secret checks and removes them after verified cleanup.' : 'Restores app access. The app manages verified cleanup of encrypted old values; issuer revocation remains separate.') : 'Used only by its authorized integration. Cleared after saving.'}</p></div>
            <div className="form-actions"><button className="primary" disabled={busy || storageFault} type="submit">{busy ? 'Saving…' : active ? (active.status === 'active' ? 'Replace credential' : 'Save and restore app access') : 'Save credential'}</button>
              {!active && <span>Will be saved securely on this Mac</span>}</div>
          </fieldset>
        </form>
        {active && <>
          {active.status === 'active' && <div className="revoke-section">
          <div><h3>Revoke app access</h3><p>Stops this app from using the credential.<br />Revoke it with the issuing service separately.</p></div><button className="danger-outline" disabled={busy || storageFault || active.status !== 'active'} onClick={() => setConfirmRevoke(true)}>Revoke access…</button></div>}
          <dialog ref={confirmation} className="revoke-dialog" aria-labelledby="revoke-title" aria-describedby="revoke-description" onCancel={event => { event.preventDefault(); setConfirmRevoke(false); }}>
            <div className="dialog-symbol" aria-hidden="true">!</div><h2 id="revoke-title">Revoke app access?</h2>
            <p id="revoke-description">This app will stop using <strong>{active.label || names[active.category]}</strong>. The credential stays valid with its issuing service until you revoke it there.</p>
            <p className="dialog-note">You can restore app access later by saving a replacement.</p>
            <div className="dialog-actions"><button className="secondary" autoFocus disabled={busy} onClick={() => setConfirmRevoke(false)}>Cancel</button><button className="danger" disabled={busy} onClick={() => void revoke()}>Revoke app access</button></div>
          </dialog>
        </>}
      </section>
    </div>
    {previousEntries.length > 0 && <dialog ref={historyDialog} className="history-dialog" aria-labelledby="history-title" aria-describedby="history-purpose" onCancel={event => { event.preventDefault(); setHistoryOpen(false); }}>
      <h2 id="history-title">Previous credential versions</h2>
      <p className="history-scope">All integrations · read-only history</p>
      <p id="history-purpose" className="history-purpose">Old values stay encrypted to find and hide accidental secrets in activity records.</p>
      <p className="history-cleanup">Cleanup is handled by the app’s credential service, outside these settings. It removes retained values only after record checks and any exposure response are verified.</p>
      <table><thead><tr><th>Previous credential</th><th>App access</th><th>Retention</th><th>Replaced on <span>(local time)</span></th></tr></thead><tbody>{previousEntries.map(entry => <tr key={entry.id}>
        <td><strong>{entry.label || names[entry.category]}</strong><span>{names[entry.category]}</span></td><td><span className="history-revoked">Revoked</span></td>
        <td><span className="history-retained">Retained</span><small>Cleanup unverified</small></td><td><time dateTime={entry.replacedAt}>{new Date(entry.replacedAt!).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time></td>
      </tr>)}</tbody></table>
      <p className="history-issuer">Revocation here applies only to this app. A replaced credential may remain valid with its issuer until you revoke it there.</p>
      <div className="dialog-actions"><button className="primary" autoFocus onClick={() => setHistoryOpen(false)}>Close history</button></div>
    </dialog>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<CredentialSettings />);
