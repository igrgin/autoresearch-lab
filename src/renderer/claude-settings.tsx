import { useMetadataState } from './metadata-state';
import React, { useEffect, useRef, useState } from 'react';
import type { ClaudeCatalog, ClaudeChoice, ClaudeReply, ClaudeReason, ClaudeSettings, RunAgentSnapshot } from '../claude/contracts';
import type { ProjectRecord } from '../projects';

class DisplayFailure extends Error {
  constructor(readonly reason: ClaudeReason, message: string) { super(message); }
}
function value<T>(reply: ClaudeReply<T>): T {
  if (!reply.ok) throw new DisplayFailure(reply.error.reason, reply.error.message);
  return reply.value;
}
export function ClaudeSettingsPanel({ runConfiguration = false }: { runConfiguration?: boolean }) {
  const [settings, setSettings] = useMetadataState<ClaudeSettings>();
  const [defaultRevision, setDefaultRevision] = useState<number>();
  const [credentialId, setCredentialId] = useMetadataState('');
  const [modelId, setModelId] = useMetadataState('');
  const [catalog, setCatalog] = useMetadataState<ClaudeCatalog>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useMetadataState('');
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [projectId, setProjectId] = useState('');
  const [snapshots, setSnapshots] = useMetadataState<RunAgentSnapshot[]>([]);
  const pendingRun = useRef<{ key: string; runId: string; snapshotId: string } | undefined>(undefined);
  const pendingDefault = useRef<{ key: string; requestId: string } | undefined>(undefined);
  const lastSavedRun = useRef<string | undefined>(undefined);
  useEffect(() => window.lab.onMetadataInvalidated(() => {
    // Keep uncertain operation identities, discard the cached model payload.
    if (pendingDefault.current) pendingDefault.current.key = '';
    if (pendingRun.current) pendingRun.current.key = '';
    lastSavedRun.current = undefined;
  }), []);
  function withholdMetadata(error: unknown, saved = false): boolean {
    if (!(error instanceof DisplayFailure) || error.reason !== 'capture_failed') return false;
    setSettings(undefined); setDefaultRevision(undefined); setCredentialId(''); setModelId(''); setCatalog(undefined); setSnapshots([]);
    setMessage(saved ? 'The choice was saved, but its metadata is withheld.' : ''); setError(error.message);
    return true;
  }
  async function load() {
    try {
      const next = value(await window.lab.claude.settings()); setSettings(next); setDefaultRevision(next.selection?.revision ?? 0);
      setCredentialId(current => current || next.selection?.credentialId || next.credentials.find(c => c.status === 'active')?.id || '');
      setModelId(current => current || next.selection?.modelId || '');
      if (pendingDefault.current?.key === '') pendingDefault.current = undefined; // Authoritative current revision read after publication is quiescent.
    } catch (error) {
      if (!withholdMetadata(error)) throw error;
      const recovery = value(await window.lab.claude.recovery());
      setSettings({ selection: null, credentials: recovery.credentials }); setDefaultRevision(recovery.revision);
      if (pendingDefault.current?.key === '') pendingDefault.current = undefined;
      setError('The saved Claude default is withheld by credential protection. Choose a clean API key and model explicitly to replace it.');
    }
  }
  useEffect(() => {
    void load().catch(error => { if (!withholdMetadata(error)) setError('Unlock credential storage and reload settings.'); });
    if (runConfiguration) void window.lab.listProjects().then(reply => { if (reply.ok) setProjects(reply.value.projects.filter(p => p.availability === 'ready').map(p => p.project)); });
  }, [runConfiguration]);
  useEffect(() => {
    let current = true;
    setSnapshots([]);
    if (projectId) void window.lab.claude.runInputs(projectId).then(reply => { if (current) { setSnapshots(value(reply)); if (pendingRun.current?.key === '') pendingRun.current = undefined; } }).catch(error => { if (current && !withholdMetadata(error)) setError('Saved run agent settings are unavailable.'); });
    return () => { current = false; };
  }, [projectId]);
  async function act(work: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await work(); } catch (error) { if (!withholdMetadata(error)) setError(error instanceof Error ? error.message : 'Claude settings are unavailable.'); }
    finally { setBusy(false); }
  }
  const choice: ClaudeChoice = { integration: 'claude', credentialId, modelId };
  const runKey = JSON.stringify({ projectId, choice });
  const supported = !!catalog?.models.some(m => m.id === modelId) && catalog.credentialId === credentialId;
  return <section className="detail-panel claude-settings" aria-label={runConfiguration ? 'Run agent configuration' : 'Claude settings'} aria-busy={busy}>
    <h2>{runConfiguration ? 'Run agent configuration' : 'Claude authentication and model'}</h2>
    <p>Use an Anthropic API key saved on this Mac. Model discovery does not prove inference access.</p>
    <button className="secondary" disabled={busy} onClick={() => void window.lab.claude.openCredentials()}>Manage API keys</button>{' '}
    <button className="secondary" disabled={busy} onClick={() => void act(load)}>Reload credentials</button>
    {error && <p className="error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {settings?.selection && <p>Saved default: <code>{settings.selection.modelId}</code>. Refresh models to validate current access.</p>}
    <label htmlFor="claude-credential">Anthropic API key reference</label>
    <select id="claude-credential" disabled={busy} value={credentialId} onChange={event => { setCredentialId(event.target.value); setCatalog(undefined); setModelId(''); setMessage(''); }}>
      <option value="">Choose a saved API key</option>{settings?.credentials.map(c => <option key={c.id} value={c.id} disabled={c.status !== 'active'}>{c.label || 'Anthropic API key'}{c.status !== 'active' ? ' (revoked)' : ''}</option>)}
    </select>
    <button className="secondary" disabled={busy || !credentialId} onClick={() => void act(async () => {
      setCatalog(undefined); const next = value(await window.lab.claude.discover(credentialId)); setCatalog(next);
      setMessage(next.models.length ? 'Authenticated catalog refreshed. Choose a model explicitly.' : 'No supported models are available for this credential and worker.');
    })}>Refresh Claude models</button>
    <label htmlFor="claude-model">Canonical Claude model</label>
    <select id="claude-model" disabled={busy || !catalog} value={modelId} onChange={event => { setModelId(event.target.value); setMessage(''); }}>
      <option value="">Choose a supported model</option>{modelId && !supported && <option value={modelId} disabled>{modelId} {catalog ? '(unavailable)' : '(requires validation)'}</option>}
      {catalog?.models.map(m => <option key={m.id} value={m.id}>{m.id}{m.lifecycle === 'deprecated' ? ' (deprecated)' : ''}</option>)}
    </select>
    {catalog && modelId && !supported && <p className="error" role="alert">The selected Claude model is unavailable in this authenticated catalog. Choose another model explicitly; the saved choice was preserved.</p>}
    {catalog && <p>Observed {new Date(catalog.observedAt).toLocaleString()}. Choices expire after 15 minutes and after app restart. A saved model is never replaced automatically.</p>}
    {!runConfiguration && <button className="primary" disabled={busy || !supported || defaultRevision === undefined} onClick={() => void act(async () => {
      if (defaultRevision === undefined) return;
      if (pendingDefault.current?.key === '') throw new Error('Reload credentials to reconcile the prior save before changing choices.');
      const revision = defaultRevision;
      const key = JSON.stringify({ choice, revision });
      if (pendingDefault.current?.key !== key) pendingDefault.current = { key, requestId: crypto.randomUUID() };
      const saved = value(await window.lab.claude.save(choice, revision, pendingDefault.current.requestId));
      pendingDefault.current = undefined;
      setDefaultRevision(saved.revision);
      setSettings(current => current ? { ...current, selection: saved } : { selection: saved, credentials: [] });
      setMessage('Claude default saved. Only the canonical model and credential reference are stored.');
      try { await load(); } catch (error) { if (!withholdMetadata(error, true)) setError('The default was saved, but its display could not refresh. Use Reload credentials to refresh it.'); }
    })}>Save Claude default</button>}
    <p>The optional access check sends a small API request (up to 3 turns, 45 seconds, estimated $0.05 budget). The SDK estimate is not a hard billing cap.</p>
    <button className="secondary" disabled={busy || !supported} onClick={() => void act(async () => {
      const result = value(await window.lab.claude.qualify(choice)); setMessage(`Access check passed for ${result.modelId} at ${new Date(result.checkedAt).toLocaleString()}.`);
    })}>Run bounded API access check</button>
    {runConfiguration && <>
      <label htmlFor="claude-project">Project for run configuration</label>
      <select id="claude-project" disabled={busy} value={projectId} onChange={event => setProjectId(event.target.value)}><option value="">Choose a project</option>{projects.map(p => <option key={p.projectId} value={p.projectId}>{p.name}</option>)}</select>
      <p>Save the agent portion of a new run configuration. Remaining run setup and execution will become available with research preparation.</p>
      <button className="primary" disabled={busy || !supported || !projectId} onClick={() => void act(async () => {
        if (pendingRun.current?.key === '') throw new Error('Refresh saved configurations to reconcile the prior save before changing choices.');
        const key = runKey;
        if (pendingRun.current?.key !== key) pendingRun.current = { key, runId: crypto.randomUUID(), snapshotId: crypto.randomUUID() };
        value(await window.lab.claude.saveRunInput({ projectId, runId: pendingRun.current.runId, snapshotId: pendingRun.current.snapshotId, choice }));
        pendingRun.current = undefined;
        lastSavedRun.current = key;
        setMessage('Run agent configuration saved. Future default changes leave this choice unchanged.');
        try { setSnapshots(value(await window.lab.claude.runInputs(projectId))); }
        catch (error) { if (!withholdMetadata(error, true)) { setSnapshots([]); setError('The configuration was saved, but the list could not refresh. Use Refresh saved configurations to retry the read.'); } }
      })}>{lastSavedRun.current === runKey ? 'Save another run agent configuration' : 'Save run agent configuration'}</button>
      <button className="secondary" disabled={busy || !projectId} onClick={() => void act(async () => {
        try { setSnapshots(value(await window.lab.claude.runInputs(projectId))); if (pendingRun.current?.key === '') pendingRun.current = undefined; }
        catch (error) { if (!withholdMetadata(error)) { setSnapshots([]); setError('Saved configurations could not refresh. Retry the refresh without saving another configuration.'); } }
      })}>Refresh saved configurations</button>
      <ul aria-label="Saved run agent configurations">{snapshots.map(s => <li key={s.snapshotId}><code>{s.modelId}</code> — run {s.runId} · saved {new Date(s.createdAt).toLocaleString()}</li>)}</ul>
    </>}
  </section>;
}
