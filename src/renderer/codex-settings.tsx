import React, { useEffect, useState } from 'react';
import type { AgentSnapshot, ChooseAgent, CodexReply, CodexView, ModelCatalog } from '../codex/contract';
import type { ProjectRecord } from '../projects';
import type { ShellBridge } from '../shell';
declare global { interface Window { lab: ShellBridge } }

function value<T>(reply: CodexReply<T>): T {
  if (!reply.ok) throw new Error(`${reply.error.code}: ${reply.error.message}`);
  return reply.value;
}
function ModelPicker({ catalog, choice, onChange, busy }: { catalog?: ModelCatalog; choice: ChooseAgent; onChange: (choice: ChooseAgent) => void; busy: boolean }) {
  const model = catalog?.models.find(model => model.model === choice.model);
  return <>
    <label htmlFor="codex-model">Codex model</label><select id="codex-model" disabled={busy || !catalog} value={choice.model} onChange={event => {
      const model = catalog?.models.find(model => model.model === event.target.value);
      onChange({ model: event.target.value, effort: model?.defaultEffort ?? '' });
    }}><option value="">Choose a model</option>{choice.model && !model && <option value={choice.model}>{choice.model} — {catalog ? 'unavailable' : 'saved; refresh to check'}</option>}{catalog?.models.map(model => <option key={model.model} value={model.model}>{model.displayName} ({model.model})</option>)}</select>
    <label htmlFor="codex-effort">Reasoning effort</label><select id="codex-effort" value={choice.effort} disabled={busy || !model} onChange={event => onChange({ ...choice, effort: event.target.value })}>
      <option value="">Choose an effort</option>{choice.effort && !model?.efforts.includes(choice.effort) && <option value={choice.effort}>{choice.effort} — saved</option>}{model?.efforts.map(effort => <option key={effort} value={effort}>{effort}</option>)}
    </select>
    {model && <p>Input modalities: {model.inputModalities.join(', ')}.</p>}
    {catalog && <p>Catalog refreshed {new Date(catalog.observedAt).toLocaleString()}. {catalog.models.length} visible models.</p>}
    <p>Catalog membership does not confirm API access. The first intended research action will establish access for that request. No inference request is sent here.</p>
    {catalog && choice.model && !model && <p role="alert">model_unavailable: Your saved model is absent from this catalog. Choose another model explicitly.</p>}
  </>;
}
const emptyChoice = { model: '', effort: '' };
export function CodexSettings() {
  const [view, setView] = useState<CodexView>();
  const [credential, setCredential] = useState('');
  const [choice, setChoice] = useState<ChooseAgent>(emptyChoice);
  const [catalog, setCatalog] = useState<ModelCatalog>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function refresh(initial = false) {
    const next = value(await window.lab.codex.settings()); setView(next);
    setCredential(next.settings.credentialRef ?? '');
    if (initial) setChoice(next.settings.defaultAgent ?? emptyChoice);
  }
  useEffect(() => { void refresh(true).catch(error => setError(error.message)); }, []);
  async function act(work: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await work(); } catch (error) { setError(error instanceof Error ? error.message : 'Codex settings are unavailable.'); }
    finally { setBusy(false); }
  }
  return <>
    <header className="page-header"><div><p className="eyebrow">Workspace / Settings</p><h1>Codex settings</h1><p>Authenticate with your OpenAI Platform API key and choose a research model.</p></div></header>
    <section className="detail-panel codex-panel" aria-label="Codex settings" aria-busy={busy}>
      <h2>OpenAI API authentication</h2><p>API billing is separate from ChatGPT subscriptions. Credentials are entered in a dedicated trusted window.</p>
      <div className="path-actions"><button disabled={busy} onClick={() => void act(() => window.lab.codex.credentials())}>Manage API keys</button><button disabled={busy} onClick={() => void act(() => refresh())}>Refresh saved keys</button></div>
      <label htmlFor="codex-credential">OpenAI credential</label><select id="codex-credential" value={credential} disabled={busy} onChange={event => { setCredential(event.target.value); setCatalog(undefined); }}><option value="">Choose a saved API key</option>{view?.credentials.map(entry => <option key={entry.id} value={entry.id} disabled={entry.status !== 'active'}>{entry.label} ({entry.status})</option>)}</select>
      <button className="primary" disabled={busy || !credential} onClick={() => void act(async () => {
        setCatalog(undefined); setCatalog(value(await window.lab.codex.authenticate(credential))); await refresh();
        setMessage('API-key state confirmed by Codex. Inference access remains unverified.');
      })}>{busy ? 'Working…' : 'Authenticate and load models'}</button>
      <h2>Default research model</h2>
      {view?.settings.defaultAgent && <p>Saved default: <strong>{view.settings.defaultAgent.model}</strong> / {view.settings.defaultAgent.effort}.</p>}
      <ModelPicker catalog={catalog} choice={choice} onChange={setChoice} busy={busy} />
      <button className="primary" disabled={busy || !catalog || !choice.model || !choice.effort} onClick={() => void act(async () => {
        value(await window.lab.codex.saveDefault({ model: choice.model, effort: choice.effort })); await refresh();
        setMessage('Default model saved. Existing run selections keep their recorded choices.');
      })}>Save default model</button>
      <p>Authentication and model availability are rechecked when saving. A missing or rejected selection is reported without switching models.</p>
      {error && <p className="error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
      <details><summary>Authentication diagnostics</summary><p>Authentication bodies, login responses and native diagnostics are excluded from recording.</p><ul>{view?.diagnostics.map(item => <li key={item.operationId}>{item.observedAt}: {item.code}</li>)}</ul></details>
    </section>
  </>;
}

export function RunAgentSettings() {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [projectId, setProjectId] = useState('');
  const [snapshot, setSnapshot] = useState<AgentSnapshot | null>(null);
  const [choice, setChoice] = useState<ChooseAgent>(emptyChoice);
  const [catalog, setCatalog] = useState<ModelCatalog>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    void window.lab.listProjects().then(reply => {
      if (!reply.ok) throw new Error(reply.error.message);
      setProjects(reply.value.projects.filter(entry => entry.availability === 'ready').map(entry => entry.project));
    }).catch(error => setError(error.message));
  }, []);
  async function act(work: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await work(); } catch (error) { setError(error instanceof Error ? error.message : 'Run agent configuration is unavailable.'); }
    finally { setBusy(false); }
  }
  return <section className="detail-panel codex-panel" aria-label="Run agent configuration" aria-busy={busy}>
    <h2>Agent for your next run</h2><p>Save the Codex portion of a project's run configuration. Full run preparation and execution will be available in a future update.</p>
    <label htmlFor="agent-project">Research project</label><select id="agent-project" value={projectId} disabled={busy} onChange={event => {
      const id = event.target.value; setProjectId(id); setSnapshot(null); setChoice(emptyChoice); setCatalog(undefined);
      if (id) void act(async () => {
        const saved = value(await window.lab.codex.runSelection(id)); setSnapshot(saved);
        const defaults = value(await window.lab.codex.settings());
        setChoice(saved?.agent ?? defaults.settings.defaultAgent ?? emptyChoice);
      });
    }}><option value="">Choose a project</option>{projects.map(project => <option key={project.projectId} value={project.projectId}>{project.name}</option>)}</select>
    {projectId && <>
      {snapshot && <p>Saved selection (revision {snapshot.revision}): <strong>{snapshot.agent.model}</strong> / {snapshot.agent.effort}. Inference access unverified.</p>}
      <button disabled={busy} onClick={() => void act(async () => { setCatalog(undefined); setCatalog(value(await window.lab.codex.models())); })}>Refresh Codex models</button>
      <ModelPicker catalog={catalog} choice={choice} onChange={setChoice} busy={busy} />
      <button className="primary" disabled={busy || !catalog || !choice.model || !choice.effort} onClick={() => void act(async () => {
        const saved = value(await window.lab.codex.saveRunSelection(projectId, snapshot?.revision ?? 0, { model: choice.model, effort: choice.effort }));
        setSnapshot(saved); setMessage('Run agent selection saved. Only the model settings and a credential reference are recorded.');
      })}>Save run agent selection</button>
      <button disabled={busy} onClick={() => void act(async () => {
        const saved = value(await window.lab.codex.runSelection(projectId)); setSnapshot(saved); setChoice(saved?.agent ?? emptyChoice); setCatalog(undefined);
      })}>Reload saved selection</button>
    </>}
    {error && <p className="error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  </section>;
}
