import { useMetadataEpoch, useMetadataState } from './metadata-state';
import { useEffect, useRef, useState } from 'react';
import type { Reported, VastCredentialChoice, VastDiscovery } from '../providers/vast-contract';
import './vast-compute.css';

function reported<T extends string | number>(field: Reported<T>): string {
  return field.availability === 'available' ? String(field.value) : 'Unavailable';
}
export function VastCompute() {
  const [choices, setChoices] = useMetadataState<VastCredentialChoice[]>([]);
  const [selected, setSelected] = useMetadataState('');
  const [result, setResult] = useMetadataState<VastDiscovery>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [stale, setStale] = useState(false);
  const selection = useRef('');
  async function loadChoices() {
    try {
      const reply = await window.lab.listVastCredentials();
      if (!reply.ok) { setError(reply.error.message); setStale(true); return; }
      setChoices(reply.value);
      if (!reply.value.some(choice => choice.id === selection.current)) {
        const id = reply.value[0]?.id ?? ''; selection.current = id; setSelected(id); setResult(undefined); setStale(false);
      }
      setSelected(reply.value.find(choice => choice.id === selection.current)?.id ?? reply.value[0]?.id ?? '');
      setLoaded(true);
    } catch { setError('Credential settings could not be reached. Unlock storage and retry.'); setStale(true); }
  }
  const epoch = useMetadataEpoch();
  const policyRevision = window.lab.metadataRevision();
  const loadedRevision = useRef<number>(undefined);
  useEffect(() => {
    // A failed barrier clears metadata, but must not create an automatic retry
    // loop. Reload once for each confirmed policy change; focus stays explicit.
    if (loadedRevision.current !== policyRevision) {
      loadedRevision.current = policyRevision;
      void loadChoices();
    }
    const refresh = () => { void loadChoices(); };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [epoch, policyRevision]);
  async function discover() {
    if (!selected || busy) return;
    const id = selected; setBusy(true); setError(''); setStale(!!result);
    try {
      const reply = await window.lab.discoverVast(id);
      if (selection.current !== id) return;
      if (reply.ok) { setResult(reply.value); setStale(false); }
      else { setError(reply.error.message); setStale(true); }
    } catch { setError('Discovery could not be completed. Retry; the last successful list has been kept.'); setStale(true); }
    finally { setBusy(false); }
  }
  return <>
    <header className="page-header"><div><p className="eyebrow">Workspace / Compute</p><h1>Your compute</h1><p>Discover existing running Vast.ai instances.</p></div></header>
    <section className="vast-connection" aria-label="Vast.ai connection">
      <h2>Connect Vast.ai</h2><p>Save an API key with instance_read access in Credential settings, then select it here.</p>
      <div className="vast-actions"><label htmlFor="vast-credential">Vast.ai credential</label>
        <select id="vast-credential" value={selected} disabled={busy || !choices.length} onChange={event => {
          selection.current = event.target.value; setSelected(event.target.value); setResult(undefined); setError(''); setStale(false);
        }}><option value="" disabled>Select a saved credential</option>{choices.map(choice => <option key={choice.id} value={choice.id}>{choice.label || 'Vast.ai credential'}</option>)}</select>
        <button className="primary" disabled={!selected || busy} onClick={() => void discover()}>{busy ? 'Discovering…' : result ? 'Refresh instances' : 'Connect and discover'}</button>
        <button className="secondary" onClick={() => { void window.lab.openVastSettings().catch(() => setError('Could not open Credential settings. Use the application menu.')); }}>Credential settings</button>
        <button className="text-button" disabled={busy} onClick={() => void loadChoices()}>Reload credentials</button>
      </div>
      <p>Discovery is read only. Running status does not verify SSH access, CUDA devices, or readiness for research. Manage instance lifecycle at Vast.ai.</p>
    </section>
    {error && <div className="error" role="alert">{error}</div>}
    {busy && <p role="status">Reading all pages from Vast.ai…</p>}
    {result && <section className="vast-results" aria-label="Discovered Vast.ai instances">
      <p role="status">{stale ? 'Last successful list — stale. Current discovery is unconfirmed.' : 'Discovery complete.'} Last received <time dateTime={result.receivedAt}>{new Date(result.receivedAt).toLocaleString()}</time>.</p>
      {!result.instances.length ? <div className="empty-state"><h2>{stale ? 'Last scan found no running instances' : 'No running Vast.ai instances'}</h2><p>{stale ? 'Retry discovery to establish the current result.' : 'The complete scan found no visible instances with actual status running for this credential.'}</p></div> :
        <ul className="vast-instance-list">{result.instances.map(instance => <li key={instance.canonicalKey}>
          <h2>Vast.ai instance {instance.resourceId}</h2><p>{reported(instance.label)}</p>
          <dl><div><dt>Canonical identity</dt><dd>{instance.canonicalKey}</dd></div>
            <div><dt>Actual state</dt><dd>{reported(instance.actualState)}</dd></div><div><dt>Intended state</dt><dd>{reported(instance.intendedState)}</dd></div>
            <div><dt>Contract state</dt><dd>{reported(instance.contractState)}</dd></div><div><dt>Next contract state</dt><dd>{reported(instance.nextContractState)}</dd></div>
            <div><dt>Advertised GPUs</dt><dd>{reported(instance.hardware.gpuCount)} · {reported(instance.hardware.gpuModel)}</dd></div>
            <div><dt>Effective CPU cores</dt><dd>{reported(instance.hardware.effectiveCpuCores)}</dd></div><div><dt>Advertised disk (GB)</dt><dd>{reported(instance.hardware.diskGb)}</dd></div>
            <div><dt>GPU memory</dt><dd>Unavailable — provider units unverified</dd></div>
            <div><dt>SSH, GPU inventory, execution</dt><dd>Not verified</dd></div></dl>
        </li>)}</ul>}
    </section>}
    {!result && !busy && <section className="empty-state" aria-label="Compute"><h2>No connected instances</h2><p>{loaded && !choices.length ? 'Add a Vast.ai credential in Credential settings to connect an account.' : 'Select a credential and connect to discover running instances.'}</p></section>}
  </>;
}
