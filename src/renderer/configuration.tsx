import React, { useEffect, useState } from 'react';
import { ConfigurationCache, invalidateConfigurationCaches, onConfigurationCacheInvalidated } from './configuration-cache';
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

function useConfigurationCache(clear: () => void, setError: (message: string) => void) {
  const [cache] = useState(() => new ConfigurationCache());
  useEffect(() => {
    const invalidate = () => {
      cache.invalidate(); clear();
      setError('Saved choices were cleared because credential protection changed. Reload defaults or prepare again to revalidate them.');
    };
    const unsubscribe = window.lab.onConfigurationInvalidated(invalidate);
    const unsubscribeLocal = onConfigurationCacheInvalidated(invalidate);
    return () => { cache.invalidate(); unsubscribe(); unsubscribeLocal(); };
  }, [cache]);
  return cache;
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
  function clear() {
    setRecord(undefined); setValues({}); setBase(EMPTY_CHOICES); setBaseAvailable(false); setMessage(''); setBusy(false);
  }
  const cache = useConfigurationCache(clear, setError);
  async function load() {
    let generation = cache.begin(); clear(); setBusy(true); setError('');
    try {
      // Publish only after all revalidation finishes under this generation.
      const global = await window.lab.getGlobalDefaults();
      if (!cache.current(generation)) return;
      if (!global.ok) { invalidateConfigurationCaches(); generation = cache.begin(); setBusy(true); }
      const reply = projectId ? await window.lab.getProjectDefaults(projectId) : global;
      if (!cache.current(generation)) return;
      if (!reply.ok) { invalidateConfigurationCaches(); generation = cache.begin(); setBusy(true); }
      const recovery = reply.ok ? reply.value : value(await (projectId ? window.lab.recoverProjectDefaults(projectId) : window.lab.recoverGlobalDefaults()));
      if (!cache.current(generation)) return;
      setRecord(recovery);
      if (reply.ok) setValues(reply.value.values);
      if (global.ok && reply.ok) { setBase({ ...EMPTY_CHOICES, ...global.value.values }); setBaseAvailable(true); }
      if (!reply.ok) setError('Saved defaults are withheld. Enter clean replacement choices and save. Omitted project choices inherit global defaults; existing configurations stay unchanged.');
      else if (!global.ok) setError('Global defaults are unavailable. Inherited values cannot be displayed; explicit project choices can still be saved.');
      setRequestId(crypto.randomUUID());
    } catch (reason) { if (cache.current(generation)) { invalidateConfigurationCaches(); setError((reason as Error).message); } }
    finally { if (cache.current(generation)) setBusy(false); }
  }
  useEffect(() => { void load(); }, [projectId]); // Component is keyed by project identity.
  return <section className="defaults-settings" aria-label={projectId ? 'Project defaults' : 'Global defaults'}>
    <h2>{projectId ? 'Project defaults' : 'Global defaults'}</h2>
    <p>{projectId ? 'Inherit each global value or keep an explicit project choice. An empty explicit choice stays unset.' : 'Reusable choices for projects that inherit them. Leave a choice empty to select it during run setup.'} Changes apply to new configurations.</p>
    {error && <p className="error" role="alert">{error}</p>}
    <form onSubmit={async event => {
      event.preventDefault(); if (!record) return;
      const generation = cache.begin(); setBusy(true); setError(''); setMessage('');
      try {
        const input = { requestId, expectedRevision: record.revision, values };
        const saved = value(await (projectId ? window.lab.updateProjectDefaults(projectId, input) : window.lab.updateGlobalDefaults(input)));
        if (!cache.current(generation)) return;
        setRecord(saved); setValues(saved.values); setRequestId(crypto.randomUUID()); setMessage('Defaults saved. Existing configurations are unchanged.');
      } catch (reason) { if (cache.current(generation)) { invalidateConfigurationCaches(); setError((reason as Error).message); } }
      finally { if (cache.current(generation)) setBusy(false); }
    }}>
      {record && <ChoicesEditor scope={projectId ? 'Project' : 'Global'} values={values} base={base} baseAvailable={baseAvailable} disabled={busy} onChange={next => { setValues(next); setRequestId(crypto.randomUUID()); setMessage(''); }} />}
      <div className="configuration-actions"><button className="primary" disabled={busy || !record}>Save {projectId ? 'project' : 'global'} defaults</button><button type="button" className="secondary" disabled={busy} onClick={() => load()}>Reload defaults</button></div>
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
  function clear() { setDraft(undefined); setOverrides({}); setSnapshots([]); setSelected(undefined); setBusy(false); }
  const cache = useConfigurationCache(clear, setError);
  async function revalidate(read: () => Promise<{ draft?: ConfigurationDraft; snapshots?: ConfigurationSnapshot[]; selected?: ConfigurationSnapshot }>) {
    const generation = cache.begin(); clear(); setBusy(true); setError('');
    try {
      const next = await read();
      if (!cache.current(generation)) return;
      setDraft(next.draft); setSnapshots(next.snapshots ?? []); setSelected(next.selected); setRequestId(crypto.randomUUID());
    } catch (reason) { if (cache.current(generation)) { invalidateConfigurationCaches(); setError((reason as Error).message); } }
    finally { if (cache.current(generation)) setBusy(false); }
  }
  const refresh = () => revalidate(async () => ({ snapshots: value(await window.lab.listConfigurations(projectId)) }));
  const prepare = () => revalidate(async () => ({ draft: value(await window.lab.prepareConfiguration(projectId)), snapshots: value(await window.lab.listConfigurations(projectId)) }));
  useEffect(() => { void refresh(); }, [projectId]);
  return <div className="project-configurations">
    <details><summary>Project defaults</summary><DefaultsSettings projectId={projectId} /></details>
    <section aria-label="Run configurations"><h2>Run configurations</h2>
      <p>Save choices for a new run. Data, initialization, hardware, evaluation and stopping setup are still required before research can start.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="configuration-actions"><button type="button" className="secondary" disabled={busy} onClick={() => prepare()}>{draft ? 'Prepare again from defaults' : 'Prepare new configuration'}</button><button type="button" className="secondary" disabled={busy} onClick={() => refresh()}>Refresh saved configurations</button></div>
      {draft && <form aria-label="New run configuration" onSubmit={event => {
        event.preventDefault();
        void revalidate(async () => {
          const saved = value(await window.lab.saveConfiguration({ requestId, projectId, globalRevision: draft.globalRevision, projectRevision: draft.projectRevision, overrides }));
          return { selected: saved, snapshots: value(await window.lab.listConfigurations(projectId)) };
        });
      }}><ChoicesEditor scope="Run" values={overrides} base={draft.choices} disabled={busy} onChange={next => { setOverrides(next); setRequestId(crypto.randomUUID()); }} /><button className="primary" disabled={busy}>Save configuration</button></form>}
      <ul className="saved-configurations">{snapshots.map((snapshot, index) => <li key={snapshot.snapshotId}><button type="button" className="secondary" disabled={busy} onClick={() => revalidate(async () => ({
        selected: value(await window.lab.getConfiguration(projectId, snapshot.snapshotId)), snapshots: value(await window.lab.listConfigurations(projectId)),
      }))}>View saved configuration {snapshots.length - index}</button><span>{new Date(snapshot.createdAt).toLocaleString()} · Unprepared</span></li>)}</ul>
      {selected && <section aria-label="Saved configuration" className="saved-configuration"><h3>Saved configuration</h3><p>Unprepared · Choices are fixed. Later default changes leave these values unchanged.</p><ChoicesSummary draft={selected} /><details><summary>Configuration identity</summary><p>Snapshot: {selected.snapshotId}</p><p>Run: {selected.runId}</p></details></section>}
    </section>
  </div>;
}
