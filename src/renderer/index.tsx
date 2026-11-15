import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ShellBridge } from '../shell';
import type { ProjectRecord, ProjectReply, WorkspaceProjects } from '../projects';
import './style.css';

declare global { interface Window { lab: ShellBridge } }

const pages = {
  Projects: { title: 'Your research projects', description: 'Create a project folder and repository, or reopen an existing project.', empty: 'No projects yet', hint: 'Create your first project above.' },
  Runs: { title: 'Research runs', description: 'Follow experiments, results, and agent activity across your projects.', empty: 'No runs yet', hint: 'Runs will appear here after you create a project and start research.' },
  Compute: { title: 'Your compute', description: 'Connect existing cloud GPU instances for your research.', empty: 'No connected instances', hint: 'Provider connections will be available in a future update.' },
};

function Projects() {
  const [workspace, setWorkspace] = useState<WorkspaceProjects>();
  const [name, setName] = useState('');
  const [folderName, setFolderName] = useState('');
  const [folderEdited, setFolderEdited] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [opened, setOpened] = useState<ProjectRecord>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function refresh() {
    const reply = await window.lab.listProjects();
    if (!reply.ok) throw new Error(reply.error.message);
    setWorkspace(reply.value);
  }
  useEffect(() => { void refresh().catch((reason: Error) => setError(reason.message)); }, []);

  async function act(action: () => Promise<ProjectReply<ProjectRecord>>) {
    setBusy(true); setError(''); setOpened(undefined);
    try {
      const reply = await action();
      if (reply.ok) {
        setOpened(reply.value);
      } else setError(reply.error.message);
      await refresh();
    } catch { setError('The workspace is unavailable. Restart the app and refresh the project list before retrying.'); }
    finally { setBusy(false); }
  }

  return <>
    <form className="project-form" onSubmit={(event) => {
      event.preventDefault();
      void act(() => window.lab.createProject({ requestId, name, folderName }));
    }}>
      <h2>Create a project</h2>
      <div className="form-fields">
        <label>Project name<input required maxLength={120} value={name} disabled={busy} onChange={(event) => {
          setName(event.target.value); setRequestId(crypto.randomUUID());
          if (!folderEdited) setFolderName(event.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80));
        }} /></label>
        <label>Folder name<input required maxLength={80} pattern="[a-zA-Z0-9]([a-zA-Z0-9_]|-)*" value={folderName} disabled={busy} onChange={(event) => {
          setFolderEdited(true); setFolderName(event.target.value); setRequestId(crypto.randomUUID());
        }} /></label>
        <button className="primary" type="submit" disabled={busy || !workspace}>{busy ? 'Working…' : 'Create project'}</button>
      </div>
      {workspace && <p className="location">Projects folder: {workspace.projectsFolder}</p>}
      <p className="form-hint">Each project gets its own folder and Git repository. Existing folders are preserved.</p>
    </form>
    {error && <p className="error" role="alert">{error}</p>}
    {opened && <section className="project-details" aria-label="Open project">
      <p className="eyebrow">Open project</p><h2>{opened.name}</h2>
      <dl><dt>Project identity</dt><dd>{opened.projectId}</dd><dt>Files</dt><dd>{opened.location}</dd><dt>Git repository</dt><dd>{opened.repository}</dd></dl>
      <p>Project files and repository are ready. Task setup and research runs will be available in a future update.</p>
    </section>}
    <section aria-label="Saved projects" className="saved-projects">
      <div className="list-header"><h2>Saved projects</h2><button disabled={busy} onClick={() => { setError(''); void refresh().catch((reason: Error) => setError(reason.message)); }}>Refresh projects</button></div>
      {!workspace ? <p>Loading projects…</p> : workspace.projects.length === 0 ? <div className="empty-state"><h2>No projects yet</h2><p>Create your first project above.</p></div> :
        workspace.projects.map(({ project, availability, problem }) => <article className="project-card" key={project.projectId}>
          <div><h3>{project.name}</h3><p className="location">{project.location}</p><p>{availability === 'ready' ? 'Ready to open' : availability === 'incomplete' ? 'Creation incomplete' : 'Project unavailable'}</p>{problem && <p>{problem}</p>}</div>
          <button disabled={busy} onClick={() => void act(() => availability === 'incomplete' ? window.lab.recoverProject(project.projectId) : window.lab.openProject(project.projectId))}>{availability === 'incomplete' ? 'Retry creation' : 'Open'}</button>
        </article>)}
    </section>
  </>;
}

function App() {
  const [page, setPage] = useState<keyof typeof pages>('Projects');
  const [status, setStatus] = useState('Opening workspace…');
  useEffect(() => {
    window.lab.getStatus().then(() => setStatus('Workspace ready')).catch(() => setStatus('Workspace unavailable. Please restart the app.'));
  }, []);
  const content = pages[page];
  return <div className="workspace">
    <aside>
      <div className="brand"><span className="brand-mark">A</span><div>Autoresearch Lab<small>Personal research workspace</small></div></div>
      <nav aria-label="Workspace">{(Object.keys(pages) as (keyof typeof pages)[]).map((name) =>
        <button key={name} aria-current={page === name ? 'page' : undefined} onClick={() => setPage(name)}>{name}</button>)}</nav>
      <div className="workspace-status" role="status">{status}</div>
    </aside>
    <main>
      <header><p className="eyebrow">Workspace / {page}</p><h1>{content.title}</h1><p>{content.description}</p></header>
      {page === 'Projects' ? <Projects /> : <section className="empty-state" aria-label={page}>
        <div className="empty-mark" aria-hidden="true">{page === 'Runs' ? '↗' : '▦'}</div>
        <h2>{content.empty}</h2><p>{content.hint}</p>
      </section>}
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
