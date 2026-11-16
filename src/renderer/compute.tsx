import React, { useEffect, useState } from 'react';
import type { Discovery, Inspection, RunpodCredential } from '../providers/contract';
import './compute.css';

export function Compute() {
  const [credentials, setCredentials] = useState<RunpodCredential[]>([]);
  const [selected, setSelected] = useState('');
  const [storageError, setStorageError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Discovery>();
  const [lastGood, setLastGood] = useState<Discovery>();
  const [detail, setDetail] = useState<Inspection>();
  const [failure, setFailure] = useState('');
  async function refreshCredentials() {
    try {
      const reply = await window.lab.runpodCredentials();
      if (!reply.ok) { setStorageError(reply.message); setCredentials([]); setSelected(''); setResult(undefined); setLastGood(undefined); setDetail(undefined); return; }
      setStorageError(''); setCredentials(reply.credentials);
      setSelected(current => {
        if (reply.credentials.some(entry => entry.id === current)) return current;
        setResult(undefined); setLastGood(undefined); setDetail(undefined);
        return reply.credentials[0]?.id ?? '';
      });
    } catch { setStorageError('Credential access is unavailable. Open Credential settings and retry.'); }
  }
  useEffect(() => {
    void refreshCredentials();
    const refresh = () => { void refreshCredentials(); };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);
  async function discover() {
    setBusy(true); setFailure(''); setDetail(undefined);
    try {
      const next = await window.lab.discoverRunpod(selected); setResult(next);
      if (next.complete) setLastGood(next);
    } catch { setFailure('Discovery could not finish. Retry to obtain a current observation.'); }
    finally { setBusy(false); }
  }
  async function inspect(resourceId: string) {
    setBusy(true); setFailure(''); setDetail(undefined);
    try { setDetail(await window.lab.inspectRunpod(selected, resourceId)); }
    catch { setFailure('Pod details could not be refreshed. Retry discovery.'); }
    finally { setBusy(false); }
  }
  const stale = !!lastGood && (!result?.complete || !!failure);
  const shown = stale ? lastGood : result;
  return <section className="compute" aria-label="Compute" aria-busy={busy}>
    <header className="page-header"><div><p className="eyebrow">Workspace / Compute</p><h1>Your compute</h1>
      <p>Discover your existing running Runpod GPU Pods.</p></div></header>
    <section className="compute-connection" aria-labelledby="runpod-heading">
      <h2 id="runpod-heading">Runpod account</h2>
      <p>Use an API key with account:read and pods:read permissions. Provider lifecycle remains manual.</p>
      <div className="compute-actions"><button className="secondary" onClick={() => void window.lab.openCredentialSettings().catch(() => setStorageError('Could not open Credential settings. Retry from the application menu.'))}>Credential settings</button>
        <button className="secondary" disabled={busy} onClick={() => void refreshCredentials()}>Refresh credentials</button></div>
      {storageError && <p className="error" role="alert">{storageError}</p>}
      {credentials.length > 0 ? <div className="compute-actions"><label>Runpod credential<select aria-label="Runpod credential" disabled={busy} value={selected} onChange={event => {
        setSelected(event.target.value); setResult(undefined); setLastGood(undefined); setDetail(undefined); setFailure('');
      }}>{credentials.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select></label>
        <button className="primary" disabled={busy || !selected} onClick={() => void discover()}>{busy ? 'Checking Runpod…' : result ? 'Refresh Pods' : 'Connect and discover'}</button></div> :
        <p>Save a Runpod API key in Credential settings, then refresh credentials.</p>}
    </section>
    <p className="compute-limits">Discovery reports provider state and allocation only. SSH/SFTP access, physical GPU identities, usable VRAM, and execution compatibility require remote preflight. No research readiness is established here.</p>
    {failure && <p className="error" role="alert">{failure}</p>}
    {result?.error && <div className="error" role="alert"><strong>Discovery incomplete</strong><p>{result.error.message}</p>
      {result.error.retryAt && <p>Retry no earlier than {new Date(result.error.retryAt).toLocaleString()}.</p>}
      <p>{result.pages} complete pages received. Missing Pods do not prove deletion.</p></div>}
    {stale && <p role="status">Showing the last complete discovery from {new Date(lastGood.receivedAt).toLocaleString()}. Current access and state are unknown.</p>}
    {!result && !failure && <div className="empty-state"><h2>No connected instances</h2><p>Choose a saved Runpod credential and connect to discover Pods.</p></div>}
    {shown?.complete && !shown.items.length && !stale && <div className="empty-state"><h2>No running GPU Pods</h2><p>All {shown.pages} pages were read successfully. No running standalone GPU Pods were returned for this account.</p></div>}
    {shown && <div className="compute-observations"><p>Account: <code>{shown.accountId ?? 'Not verified'}</code> · {shown.complete ? 'Complete discovery' : 'Partial discovery'} · Received {new Date(shown.receivedAt).toLocaleString()}</p>
      {shown.items.length > 0 && <ul className="compute-pods">{shown.items.map(pod => <li key={`${pod.identity.provider}:${pod.identity.resourceId}`}>
        <h3>Pod <code>{pod.identity.resourceId}</code></h3><p>Reported state: <strong>{pod.reportedState}</strong> · {pod.allocation?.gpuCount} × {pod.allocation?.gpuType}</p>
        <p>System RAM: {pod.allocation?.systemRamGb == null ? 'Unknown' : `${pod.allocation.systemRamGb} GB`} · vCPUs: {pod.allocation?.vcpuCount ?? 'Unknown'} · Host-reported CUDA: {pod.cudaVersion ?? 'Unknown'}</p>
        <p>GPU UUIDs and usable VRAM: not observed. SSH and execution: unverified.</p>
        <button className="secondary" disabled={busy || !selected} onClick={() => void inspect(pod.identity.resourceId)}>Refresh details for {pod.identity.resourceId}</button>
      </li>)}</ul>}</div>}
    {detail && (detail.ok ? <section className="compute-connection" aria-label="Pod detail"><h2>Pod {detail.instance.identity.resourceId}</h2>
      <p>Reported state: {detail.instance.reportedState} · Received {new Date(detail.instance.receivedAt).toLocaleString()}</p>
      <p>{detail.instance.capabilities.find(item => item.name === 'direct_ssh')?.reason === 'endpoint_reported_unverified' ? 'Direct SSH endpoint reported; authentication and SFTP have not been tested.' : 'No direct SSH endpoint reported in this detail response.'}</p>
      <p>Execution and physical GPU inventory remain unverified. Refresh details again before later assignment or reconnection.</p></section> : <p className="error" role="alert">{detail.error.message}</p>)}
  </section>;
}
