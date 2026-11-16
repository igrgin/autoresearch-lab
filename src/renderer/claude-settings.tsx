import React, { useEffect, useRef, useState } from 'react';
import type { ClaudeCatalog, ClaudeChoice, ClaudeReply, ClaudeSettings, RunAgentSnapshot } from '../claude/contracts';
import type { ProjectRecord } from '../projects';

function value<T>(reply: ClaudeReply<T>): T {
  if (!reply.ok) throw new Error(reply.error.message);
  return reply.value;
}
export function ClaudeSettingsPanel({ runConfiguration = false }: { runConfiguration?: boolean }) {
  const [settings, setSettings] = useState<ClaudeSettings>();
  const [credentialId, setCredentialId] = useState('');
  const [modelId, setModelId] = useState('');
  const [catalog, setCatalog] = useState<ClaudeCatalog>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [projectId, setProjectId] = useState('');
  const [snapshots, setSnapshots] = useState<RunAgentSnapshot[]>([]);
  const pendingRun = useRef<{ key: string; runId: string; snapshotId: string } | undefined>(undefined);
  async function load() {
    const next = value(await window.lab.claude.settings()); setSettings(next);
    setCredentialId(current => current || next.selection?.credentialId || next.credentials.find(c => c.status === 'active')?.id || '');
    setModelId(current => current || next.selection?.modelId || '');
  }
  useEffect(() => {
    void load().catch(() => setError('Unlock credential storage and reload settings.'));
    if (runConfiguration) void window.lab.listProjects().then(reply => { if (reply.ok) setProjects(reply.value.projects.filter(p => p.availability === 'ready').map(p => p.project)); });
  }, [runConfiguration]);
  useEffect(() => {
    let current = true;
    setSnapshots([]);
    if (projectId) void window.lab.claude.runInputs(projectId).then(reply => { if (current) setSnapshots(value(reply)); }).catch(() => { if (current) setError('Saved run agent settings are unavailable.'); });
    return () => { current = false; };
  }, [projectId]);
  async function act(work: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await work(); } catch (error) { setError(error instanceof Error ? error.message : 'Claude settings are unavailable.'); }
    finally { setBusy(false); }
  }
  const choice: ClaudeChoice = { integration: 'claude', credentialId, modelId };
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
    {!runConfiguration && <button className="primary" disabled={busy || !supported} onClick={() => void act(async () => {
      value(await window.lab.claude.save(choice, settings?.selection?.revision ?? 0)); await load(); setMessage('Claude default saved. Only the canonical model and credential reference are stored.');
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
        const key = JSON.stringify({ projectId, choice });
        if (pendingRun.current?.key !== key) pendingRun.current = { key, runId: crypto.randomUUID(), snapshotId: crypto.randomUUID() };
        value(await window.lab.claude.saveRunInput({ projectId, runId: pendingRun.current.runId, snapshotId: pendingRun.current.snapshotId, choice }));
        pendingRun.current = undefined;
        setSnapshots(value(await window.lab.claude.runInputs(projectId))); setMessage('Run agent configuration saved. Future default changes leave this choice unchanged.');
      })}>Save run agent configuration</button>
      <ul aria-label="Saved run agent configurations">{snapshots.map(s => <li key={s.snapshotId}><code>{s.modelId}</code> — run {s.runId} · saved {new Date(s.createdAt).toLocaleString()}</li>)}</ul>
    </>}
  </section>;
}
