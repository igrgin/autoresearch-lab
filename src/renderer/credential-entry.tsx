import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CredentialEntry, CREDENTIAL_HELP, ENTRY_CATEGORIES, EntryMetadata, EntryReply } from '../security/entry-contract';
import './credential-entry.css';
import { WindowTitlebar } from './window-titlebar';

declare global { interface Window { credentialEntry: { save(entry: CredentialEntry): Promise<EntryReply>; list(): Promise<EntryMetadata[]>; replace(id: string, value: string): Promise<EntryReply>; revoke(id: string): Promise<EntryReply>; help(category: string): Promise<EntryReply>; copyHelp(category: string): Promise<EntryReply>; vastSession(id: string, value: string): Promise<EntryReply> } } }
const names: Record<string, string> = { runpod: 'Runpod', vast: 'Vast.ai', openai: 'OpenAI · Codex', anthropic: 'Anthropic · Claude', ssh_passphrase: 'SSH passphrase', model_download: 'Model download' };
function LockIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></svg>;
}
function VastSessionEntry({ id, disabled, notify }: { id: string; disabled: boolean; notify: (reply: EntryReply) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [sending, setSending] = useState(false);
  return <details className="retention-details"><summary>Vast.ai two-factor session</summary>
    <p>If Vast requests two-factor authentication, complete its supported tfa login externally and enter the provider-issued session credential here. Do not enter a password, OTP, recovery code, or TOTP seed. Session access ends at expiry or app restart; the session is never saved to disk. The API key stays in the encrypted vault.</p>
    <form autoComplete="off" onSubmit={async event => {
      event.preventDefault(); if (!input.current?.value || sending || disabled) return;
      setSending(true);
      try { notify(await window.credentialEntry.vastSession(id, input.current.value)); }
      catch { notify({ ok: false, message: 'Could not use the Vast session. Retry in Credential settings.' }); }
      finally { if (input.current) input.current.value = ''; setSending(false); }
    }}><label htmlFor="vast-session">Provider-issued session credential</label>
      <input id="vast-session" ref={input} type="password" autoComplete="off" spellCheck={false} maxLength={65536} required disabled={disabled || sending} />
      <button className="secondary" type="submit" disabled={disabled || sending}>{sending ? 'Using session…' : 'Use session for Vast discovery'}</button>
    </form>
  </details>;
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
  const historyBody = useRef<HTMLDivElement>(null);
  const [moreHistoryBelow, setMoreHistoryBelow] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [helpFailure, setHelpFailure] = useState<{ category: CredentialEntry['category']; inHistory: boolean }>();
  const [copyStatus, setCopyStatus] = useState<EntryReply>();
  useEffect(() => {
    const body = historyBody.current;
    if (!historyOpen || !body) return;
    const update = () => setMoreHistoryBelow(body.scrollTop + body.clientHeight < body.scrollHeight - 2);
    const observer = new ResizeObserver(update); observer.observe(body); update();
    body.addEventListener('scroll', update);
    return () => { observer.disconnect(); body.removeEventListener('scroll', update); };
  }, [historyOpen, helpFailure, copyStatus]);
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
  async function openHelp(helpCategory = active?.category || category) {
    setHelpFailure(undefined); setCopyStatus(undefined);
    try {
      const reply = await window.credentialEntry.help(helpCategory);
      if (!reply.ok) setHelpFailure({ category: helpCategory as CredentialEntry['category'], inHistory: historyOpen });
    } catch { setHelpFailure({ category: helpCategory as CredentialEntry['category'], inHistory: historyOpen }); }
  }
  async function copyHelpAddress(helpCategory: CredentialEntry['category']) {
    try { setCopyStatus(await window.credentialEntry.copyHelp(helpCategory)); }
    catch { setCopyStatus({ ok: false, message: 'Could not copy the address. Select and copy it manually.' }); }
  }
  const helpFailureNotice = (inHistory: boolean) => helpFailure?.inHistory === inHistory && <div className="credential-help-failure" role="alert">
    <div className="help-error-heading"><p>Could not open the {names[helpFailure.category]} credential page.</p><button className="secondary" type="button" onClick={() => void openHelp(helpFailure.category)}>Try again</button></div>
    <label><span className="address-instruction">Copy this address and open it in your browser:</span><span className="address-actions"><input aria-label="Credential page address" readOnly value={CREDENTIAL_HELP[helpFailure.category].url || ''} onFocus={event => event.currentTarget.select()} /><button className="secondary" type="button" onClick={() => void copyHelpAddress(helpFailure.category)}>{copyStatus?.ok ? 'Copied ✓' : 'Copy address'}</button></span></label>
    {copyStatus && <span className={copyStatus.ok ? 'visually-hidden' : undefined} role={copyStatus.ok ? 'status' : 'alert'}>{copyStatus.message}</span>}
  </div>;
  const guide = help.url ? <a href={help.url} className="guide-link" onClick={event => { event.preventDefault(); void openHelp(); }}>{help.title} <span aria-hidden="true">↗</span><span className="visually-hidden"> (opens in browser)</span></a> : null;
  const clearInput = () => { setFieldError(false); setRevealed(false); if (credential.current) credential.current.value = ''; setHasCredential(false); };
  const choose = (id: string) => { clearInput(); setSelected(id); setFeedback(undefined); setHelpFailure(undefined); setConfirmRevoke(false); };
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
  return <><WindowTitlebar title="Credential settings" settings /><main className="credentials" aria-busy={busy}>
    <header className="credentials-header">
      <div><div className="breadcrumb">Autoresearch Lab <span>/</span> Settings</div>
        <h1>Credential settings</h1><p>Manage access to your research integrations.</p></div>
      <span className="local-badge"><LockIcon /> On this Mac</span>
    </header>
    <div className="privacy-note"><LockIcon /><p><strong>Encrypted with macOS Keychain.</strong> Saved values cannot be revealed or included in project exports.</p></div>
    <div className="credentials-layout">
      <section className="saved-panel" aria-labelledby="saved-heading">
        <div className="panel-heading"><h2 id="saved-heading">Saved credentials {loaded && <span className="count">{currentEntries.length}</span>}</h2>
          {loaded && <button className="text-button" disabled={busy || storageFault} onClick={() => void refresh()}>Refresh list</button>}</div>
        <button className={`new-credential ${!selected ? 'is-selected' : ''}`} disabled={busy || storageFault} onClick={() => choose('')} aria-pressed={!selected}><span aria-hidden="true">＋</span> Add credential</button>
        {!loaded ? <div className="list-empty"><div className="empty-lock"><LockIcon /></div><p>Unlock to view credential names<br />and manage app access.</p><button className="secondary" disabled={busy} onClick={() => void refresh()}>{busy ? 'Unlocking…' : 'Unlock saved credentials'}</button></div> :
          currentEntries.length === 0 ? <div className="list-empty"><p>No saved credentials yet.<br />Add your first integration here.</p></div> :
            <ul className="credential-list">{currentEntries.map(entry => <li key={entry.id}><button className={`credential-row ${selected === entry.id ? 'is-selected' : ''}`} disabled={busy || storageFault} onClick={() => choose(entry.id)} aria-pressed={selected === entry.id}>
              <span className="integration-mark" aria-hidden="true">{(names[entry.category] || entry.category).slice(0, 1)}</span>
              <span className="row-copy"><strong>{entry.label || names[entry.category]}</strong><span>{names[entry.category]}</span><span className={`row-status ${entry.status !== 'active' ? 'is-revoked' : ''}`}>{entry.status === 'active' ? 'App access allowed' : 'App access revoked'}</span></span>
            </button></li>)}</ul>}
        {previousEntries.length > 0 && <div className="previous-versions"><button className="history-link" onClick={() => { setRevealed(false); setHelpFailure(undefined); setHistoryOpen(true); }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2" /></svg><span>Previous versions<small>All integrations</small></span><span className="history-count">{previousEntries.length}</span></button></div>}

        <p className="panel-footer">{loaded ? 'Manage credentials here; connect accounts separately.' : 'Saving a credential does not connect an account. Only its named integration can use it.'}</p>
      </section>
      <section className="entry-panel" aria-labelledby="entry-heading">
        <div className="entry-heading"><div><h2 id="entry-heading">{active ? 'Manage credential' : 'Add a credential'}</h2>
          <p>{active ? (active.status === 'active' ? 'Replace the value or revoke this app’s access.' : 'Save a replacement to restore this app’s access.') : 'Choose an integration and securely save its credential.'}</p></div>
          {active && <span className={`status-badge ${active.status !== 'active' ? 'revoked' : ''}`}>{active.status === 'active' ? 'App access allowed' : 'App access revoked'}</span>}
        </div>
        {feedback && <div className={`feedback ${feedback.error ? 'error' : 'success'}`} role={feedback.error ? 'alert' : 'status'}><span aria-hidden="true">{feedback.error ? '!' : '✓'}</span><div>{storageFault ? <><div className="storage-error-heading"><strong>Credential storage is unavailable.</strong><button className="error-retry" disabled={busy} onClick={() => void refresh()}>Retry credential storage</button></div><p>Editing is disabled. Unlock your login keychain in Keychain Access, then retry. If already unlocked, restart Autoresearch Lab.</p></> : <p>{feedback.message}</p>}</div></div>}
        {helpFailureNotice(false)}
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
              <div className="field"><label htmlFor="integration">Integration</label><select id="integration" value={category} onChange={event => { clearInput(); setHelpFailure(undefined); setCategory(event.target.value as CredentialEntry['category']); }}>
                {ENTRY_CATEGORIES.map(value => <option key={value} value={value}>{names[value]}</option>)}
              </select><p className="field-help">{help.hint}</p>{guide}</div>
              <div className="field"><label htmlFor="label">Label <span aria-hidden="true" className="optional">Optional</span></label><input id="label" aria-label="Label" value={label} maxLength={120} placeholder="e.g. Personal Runpod" aria-describedby="label-help" onChange={event => setLabel(event.target.value)} />
                <p className="field-help" id="label-help">A name you’ll recognize. Keep the credential value out of this label.</p></div>
            </>}
            <div className="field"><label htmlFor="credential">{active ? 'New credential value' : 'Credential'} {!storageFault && <span className="mask-note" aria-hidden="true">{revealed ? 'Visible for 15 seconds' : 'Hidden · reveal for 15 seconds'}</span>}</label><div className="secret-input"><input ref={credential} aria-label={active ? 'New credential value' : 'Credential'} id="credential" name="credential" type={revealed ? 'text' : 'password'} autoComplete="off" spellCheck={false} required maxLength={65536} placeholder={active ? 'Paste a replacement value' : category === 'runpod' ? 'Paste your Runpod API key' : 'Paste your credential'} aria-invalid={fieldError} aria-describedby={fieldError ? 'credential-error credential-help' : 'credential-help'} onChange={event => { setHasCredential(event.currentTarget.value.length > 0); setFieldError(false); }} /><button type="button" className="reveal-value" aria-pressed={revealed} disabled={busy || storageFault} onClick={() => setRevealed(value => !value)}>{revealed ? 'Hide entered value' : 'Show entered value'}</button></div>
              {fieldError && <p className="field-error" id="credential-error" role="alert">Enter a credential value before saving.</p>}
              <p className="field-help" id="credential-help">{active ? 'Replacing keeps the previous value encrypted to detect it in recorded activity. Issuer revocation is separate.' : 'Used only by its authorized integration. Cleared after saving.'}</p>
</div>
            {active && <details className="retention-details"><summary>Retention and removal limits</summary><p>The previous value stays encrypted so the app can detect it in recorded activity. The credential service removes it after trusted checks confirm old values are hidden and any exposure is contained. No user cleanup action or timeframe is available here.</p></details>}
            <div className="form-actions"><button className="primary" disabled={busy || storageFault} type="submit">{busy ? 'Saving…' : active ? (active.status === 'active' ? 'Replace credential' : 'Save and restore app access') : 'Save credential'}</button>
              {!active && <span>Will be saved securely on this Mac</span>}</div>
          </fieldset>
        </form>
        {active?.category === 'vast' && active.status === 'active' && <VastSessionEntry key={active.id} id={active.id} disabled={busy || storageFault} notify={notify} />}
        {active && <>
          {active.status === 'active' && <div className="revoke-section">
          <div><h3>Revoke app access</h3><p>Stops this app from using the credential.<br />Revoke it with the issuing service separately.</p></div><button className="danger-outline" disabled={busy || storageFault || active.status !== 'active'} onClick={() => setConfirmRevoke(true)}>Revoke access…</button></div>}
          <dialog ref={confirmation} className="revoke-dialog" aria-labelledby="revoke-title" aria-describedby="revoke-description" onCancel={event => { event.preventDefault(); setConfirmRevoke(false); }}>
            <div className="dialog-symbol" aria-hidden="true">!</div><h2 id="revoke-title">Revoke app access?</h2>
            <p id="revoke-description">This app will stop using <strong>{active.label || names[active.category]}</strong>. This does not revoke the credential with its issuing service.</p>
            <p className="dialog-note">You can restore app access later by saving a replacement.</p>
            <div className="dialog-actions"><button className="secondary" autoFocus disabled={busy} onClick={() => setConfirmRevoke(false)}>Cancel</button><button className="danger" disabled={busy} onClick={() => void revoke()}>Revoke app access</button></div>
          </dialog>
        </>}
      </section>
    </div>
    {previousEntries.length > 0 && <dialog ref={historyDialog} className="history-dialog" aria-labelledby="history-title" aria-describedby="history-purpose" onCancel={event => { event.preventDefault(); setHistoryOpen(false); }}>
      <header className="history-header"><h2 id="history-title">Previous credential versions</h2>
      <p className="history-scope">All integrations · read-only history</p></header>
      <div className="history-body" ref={historyBody} data-more-below={moreHistoryBelow}>
      <p id="history-purpose" className="history-purpose">Encrypted copies are kept to detect accidentally recorded secrets. This app cannot use these versions to authenticate.</p>
      {helpFailureNotice(true)}
      <p className="history-limits"><strong>Removal timeframe unavailable.</strong> No cleanup controls or progress view are available here.</p>
      <table><thead><tr><th>Previous credential</th><th>App access</th><th>Encrypted copy</th><th>Replaced on <span>(local time)</span></th></tr></thead><tbody>{previousEntries.map(entry => <tr key={entry.id}>
        <td><strong>{entry.label || names[entry.category]}</strong><span>{names[entry.category]}</span>{CREDENTIAL_HELP[entry.category as CredentialEntry['category']].url && <a className="guide-link" href={CREDENTIAL_HELP[entry.category as CredentialEntry['category']].url} onClick={event => { event.preventDefault(); void openHelp(entry.category); }}>Manage {names[entry.category]} <span className="nowrap">credentials <span aria-hidden="true">↗</span></span><span className="visually-hidden"> (opens in browser)</span></a>}</td><td><span className="history-revoked">App access revoked</span></td>
        <td><span className="history-retained">Retained</span><small>Record safety not verified</small></td><td><time dateTime={entry.replacedAt}><span>{new Date(entry.replacedAt!).toLocaleDateString(undefined, {year:'numeric', month:'short', day:'numeric'})}</span><span>{new Date(entry.replacedAt!).toLocaleTimeString(undefined, {hour:'2-digit',minute:'2-digit'})}</span></time></td>
      </tr>)}</tbody></table>
      <details className="history-retention-details"><summary>Retention and removal limits</summary><p>The credential service removes copies after trusted checks confirm old values have been hidden in recorded activity and any exposure is contained. These settings cannot start or track those checks.</p><p>Revoke old credentials with their issuer separately. This does not remove secrets from activity records.</p></details>
      </div><div className="dialog-actions">{moreHistoryBelow && <span className="history-scroll-note">More details below ↓</span>}<button className="primary" autoFocus onClick={() => setHistoryOpen(false)}>Close history</button></div>
    </dialog>}
  </main></>;
}
createRoot(document.getElementById('root')!).render(<CredentialSettings />);
