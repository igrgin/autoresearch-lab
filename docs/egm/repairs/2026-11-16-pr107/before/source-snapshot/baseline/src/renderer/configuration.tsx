import React, { useEffect, useState } from 'react';
import { CHOICE_KEYS, EMPTY_CHOICES, type ChoiceOverrides, type ConfigurationDraft, type ConfigurationReply, type ConfigurationSnapshot, type DefaultsRecovery, type RunChoices } from '../configuration';

function value<T>(reply: ConfigurationReply<T>): T {
  if (!reply.ok) throw new Error(reply.error.message);
  return reply.value;
}
const labels = { agent: 'Research agent', trainingDurationSeconds: 'Training duration', objective: 'Research objective' };
function choiceText(key: keyof RunChoices, choices: RunChoices): string {
  if (key === 'agent') return choices.agent ? `${choices.agent.integration === 'codex' ? 'Codex' : 'Claude'} · ${choices.agent.model || 'model not selected'}` : 'Not selected';
  if (key === 'trainingDurationSeconds') return choices.trainingDurationSeconds === null ? 'Not selected' : `${choices.trainingDurationSeconds} seconds`;
  return choices.objective || 'Not selected';
}
function ChoicesSummary({ draft }: { draft: ConfigurationDraft }) {
  return <dl className="choices-summary">{CHOICE_KEYS.map(key => <React.Fragment key={key}><dt>{labels[key]} <small>{draft.origins[key].level} {draft.origins[key].revision === null ? 'choice' : `revision ${draft.origins[key].revision}`}</small></dt><dd>{choiceText(key, draft.choices)}</dd></React.Fragment>)}</dl>;
}
function ChoicesEditor({ scope, values, base, baseAvailable = true, disabled, onChange }: {
  scope: 'Global' | 'Project' | 'Run'; values: ChoiceOverrides; base: RunChoices; baseAvailable?: boolean; disabled: boolean; onChange: (values: ChoiceOverrides) => void;
}) {
  const effective = { ...base, ...values };
  function change(key: keyof RunChoices, next: RunChoices[keyof RunChoices]) { onChange({ ...values, [key]: next }); }
  return <div className="choices-editor">{CHOICE_KEYS.map(key => {
    const explicit = scope === 'Global' || Object.hasOwn(values, key);
    const prefix = `${scope} ${labels[key].toLowerCase()}`;
    return <fieldset key={key} disabled={disabled}><legend>{labels[key]}</legend>
      {scope !== 'Global' && <label className="choice-mode">Value source<select aria-label={`${prefix} source`} value={explicit ? 'explicit' : 'inherit'} onChange={event => {
        if (event.target.value === 'explicit') onChange({ ...values, [key]: base[key] });
        else { const next = { ...values }; delete next[key]; onChange(next); }
      }}><option value="inherit">{scope === 'Project' ? 'Inherit global default' : 'Use project default'}</option><option value="explicit">{scope === 'Project' ? 'Explicit project choice' : 'Choose for this run'}</option></select></label>}
      {!explicit ? <p className="inherited-choice">{baseAvailable ? `Inherited: ${choiceText(key, base)}` : 'Inherited value unavailable. Review global defaults.'}</p> : key === 'agent' ? <>
        <label>Integration<select aria-label={`${prefix} integration`} value={effective.agent?.integration || ''} onChange={event => change('agent', event.target.value ? { integration: event.target.value as 'codex' | 'claude', model: null } : null)}><option value="">Not selected</option><option value="codex">Codex</option><option value="claude">Claude</option></select></label>
        {effective.agent && <label>Model ID<input aria-label={`${prefix} model`} maxLength={160} pattern="[a-zA-Z0-9]([a-zA-Z0-9._:]|/|-)*" placeholder="Select later, or enter a model ID" value={effective.agent.model || ''} onChange={event => change('agent', { integration: effective.agent!.integration, model: event.target.value || null })} /></label>}
      </> : key === 'trainingDurationSeconds' ? <label>Seconds per experiment<input aria-label={`${prefix} seconds`} type="number" min={1} step={1} max={Number.MAX_SAFE_INTEGER} placeholder="Not selected" value={effective.trainingDurationSeconds ?? ''} onChange={event => change(key, event.target.value === '' ? null : Number(event.target.value))} /></label>
        : <label>Objective<input aria-label={`${prefix}`} maxLength={2000} placeholder="Not selected" value={effective.objective || ''} onChange={event => change(key, event.target.value || null)} /></label>}
    </fieldset>;
  })}</div>;
}

export function DefaultsSettings({ projectId }: { projectId?: string }) {
  const [record, setRecord] = useState<DefaultsRecovery>();
  const [values, setValues] = useState<ChoiceOverrides>({});
  const [base, setBase] = useState<RunChoices>(EMPTY_CHOICES);
  const [baseAvailable, setBaseAvailable] = useState(true);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function load() {
    setBusy(true); setError(''); setMessage(''); setRecord(undefined); setValues({}); setBase(EMPTY_CHOICES); setBaseAvailable(false);
    try {
      // A withheld global body must not prevent editing this project's own
      // defaults. Never substitute empty choices as a supposedly known parent.
      const global = await window.lab.getGlobalDefaults();
      if (global.ok) { setBase({ ...EMPTY_CHOICES, ...global.value.values }); setBaseAvailable(true); }
      const reply = projectId ? await window.lab.getProjectDefaults(projectId) : global;
      if (reply.ok) {
        setRecord(reply.value); setValues(reply.value.values);
        if (!global.ok) setError('Global defaults are unavailable. Inherited values cannot be displayed; explicit project choices can still be saved.');
      } else {
        const recovery = value(await (projectId ? window.lab.recoverProjectDefaults(projectId) : window.lab.recoverGlobalDefaults()));
        setRecord(recovery);
        setError('Saved defaults are withheld. Enter clean replacement choices and save. Omitted project choices inherit global defaults; existing configurations stay unchanged.');
      }
      setRequestId(crypto.randomUUID());
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, [projectId]); // Component is keyed by project identity.
  return <section className="defaults-settings" aria-label={projectId ? 'Project defaults' : 'Global defaults'}>
    <h2>{projectId ? 'Project defaults' : 'Global defaults'}</h2>
    <p>{projectId ? 'Inherit each global value or keep an explicit project choice. An empty explicit choice stays unset.' : 'Reusable choices for projects that inherit them. Leave a choice empty to select it during run setup.'} Changes apply to new configurations.</p>
    {error && <p className="error" role="alert">{error}</p>}
    <form onSubmit={async event => {
      event.preventDefault(); if (!record) return;
      setBusy(true); setError(''); setMessage('');
      try {
        const input = { requestId, expectedRevision: record.revision, values };
        const saved = value(await (projectId ? window.lab.updateProjectDefaults(projectId, input) : window.lab.updateGlobalDefaults(input)));
        setRecord(saved); setValues(saved.values); setRequestId(crypto.randomUUID()); setMessage('Defaults saved. Existing configurations are unchanged.');
      } catch (reason) { setError((reason as Error).message); }
      finally { setBusy(false); }
    }}>
      {record && <ChoicesEditor scope={projectId ? 'Project' : 'Global'} values={values} base={base} baseAvailable={baseAvailable} disabled={busy} onChange={next => { setValues(next); setRequestId(crypto.randomUUID()); setMessage(''); }} />}
      <div className="configuration-actions"><button className="primary" disabled={busy || !record}>Save {projectId ? 'project' : 'global'} defaults</button><button type="button" className="secondary" disabled={busy} onClick={() => void load()}>Reload defaults</button></div>
    </form>
    {message && <p role="status">{message}</p>}
  </section>;
}

export function ProjectConfigurations({ projectId }: { projectId: string }) {
  const [draft, setDraft] = useState<ConfigurationDraft>();
  const [overrides, setOverrides] = useState<ChoiceOverrides>({});
  const [snapshots, setSnapshots] = useState<ConfigurationSnapshot[]>([]);
  const [selected, setSelected] = useState<ConfigurationSnapshot>();
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function refresh() { setSnapshots(value(await window.lab.listConfigurations(projectId))); }
  useEffect(() => { void refresh().catch(reason => setError((reason as Error).message)); }, [projectId]);
  async function prepare() {
    setBusy(true); setError('');
    try {
      setDraft(value(await window.lab.prepareConfiguration(projectId))); setOverrides({}); setRequestId(crypto.randomUUID()); setSelected(undefined);
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="project-configurations">
    <details><summary>Project defaults</summary><DefaultsSettings projectId={projectId} /></details>
    <section aria-label="Run configurations"><h2>Run configurations</h2>
      <p>Save choices for a new run. Data, initialization, hardware, evaluation and stopping setup are still required before research can start.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="configuration-actions"><button type="button" className="secondary" disabled={busy} onClick={() => void prepare()}>{draft ? 'Prepare again from defaults' : 'Prepare new configuration'}</button><button type="button" className="secondary" disabled={busy} onClick={() => { setError(''); void refresh().catch(reason => setError((reason as Error).message)); }}>Refresh saved configurations</button></div>
      {draft && <form aria-label="New run configuration" onSubmit={async event => {
        event.preventDefault(); setBusy(true); setError('');
        try {
          const saved = value(await window.lab.saveConfiguration({ requestId, projectId, globalRevision: draft.globalRevision, projectRevision: draft.projectRevision, overrides }));
          setSelected(saved); setDraft(undefined); await refresh();
        } catch (reason) { setError((reason as Error).message); }
        finally { setBusy(false); }
      }}><ChoicesEditor scope="Run" values={overrides} base={draft.choices} disabled={busy} onChange={next => { setOverrides(next); setRequestId(crypto.randomUUID()); }} /><button className="primary" disabled={busy}>Save configuration</button></form>}
      <ul className="saved-configurations">{snapshots.map((snapshot, index) => <li key={snapshot.snapshotId}><button type="button" className="secondary" disabled={busy} onClick={async () => {
        setBusy(true); setError('');
        try { setSelected(value(await window.lab.getConfiguration(projectId, snapshot.snapshotId))); }
        catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
      }}>View saved configuration {snapshots.length - index}</button><span>{new Date(snapshot.createdAt).toLocaleString()} · Unprepared</span></li>)}</ul>
      {selected && <section aria-label="Saved configuration" className="saved-configuration"><h3>Saved configuration</h3><p>Unprepared · Choices are fixed. Later default changes leave these values unchanged.</p><ChoicesSummary draft={selected} /><details><summary>Configuration identity</summary><p>Snapshot: {selected.snapshotId}</p><p>Run: {selected.runId}</p></details></section>}
    </section>
  </div>;
}
