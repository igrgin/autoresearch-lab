import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ShellBridge } from '../shell';
import type { ProjectRecord, ProjectReply, WorkspaceProjects } from '../projects';
import './style.css';

declare global { interface Window { lab: ShellBridge } }

function Icon({ name, size = 20 }: { name: 'folder' | 'plus' | 'search' | 'refresh' | 'arrow' | 'check' | 'runs' | 'compute'; size?: number }) {
  const paths = {
    folder: <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />,
    plus: <path d="M12 5v14M5 12h14" />,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 7a7 7 0 0 1 11-2l3 3M4 16l3 3a7 7 0 0 0 11-2" /></>,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    check: <path d="m5 12 4 4L19 6" />,
    runs: <path d="m8 5 11 7-11 7Z" />,
    compute: <><rect x="4" y="4" width="16" height="6" rx="2" /><rect x="4" y="14" width="16" height="6" rx="2" /><path d="M8 7h.01M8 17h.01" /></>,
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

const folderSuggestion = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
const validFolder = (name: string) => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(name);

function Projects() {
  const [workspace, setWorkspace] = useState<WorkspaceProjects>();
  const [name, setName] = useState('');
  const [folderName, setFolderName] = useState('');
  const [folderEdited, setFolderEdited] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [opened, setOpened] = useState<ProjectRecord>();
  const [creating, setCreating] = useState(true);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('name');
  const [message, setMessage] = useState('');
  const nameInput = useRef<HTMLInputElement>(null);

  async function refresh() {
    const reply = await window.lab.listProjects();
    if (!reply.ok) throw new Error(reply.error.message);
    setWorkspace(reply.value);
    setOpened((current) => current && reply.value.projects.some((entry) => entry.project.projectId === current.projectId && entry.availability === 'ready') ? current : undefined);
  }
  useEffect(() => { void refresh().catch((reason: Error) => setError(reason.message)); }, []);

  async function act(action: () => Promise<ProjectReply<ProjectRecord>>) {
    setBusy(true); setError(''); setMessage('');
    try {
      const reply = await action();
      if (reply.ok) {
        setOpened(reply.value); setCreating(false);
        setMessage(`${reply.value.name} is open.`);
      } else setError(reply.error.message);
      await refresh();
    } catch { setError('The workspace is unavailable. Restart the app and refresh the project list before retrying.'); }
    finally { setBusy(false); }
  }

  function newProject() {
    setCreating(true); setName(''); setFolderName(''); setFolderEdited(false);
    setRequestId(crypto.randomUUID()); setError(''); setMessage('');
    requestAnimationFrame(() => nameInput.current?.focus());
  }

  async function showFiles() {
    if (!opened) return;
    setBusy(true); setError('');
    try {
      const reply = await window.lab.revealProject(opened.projectId);
      if (!reply.ok) setError(reply.error.message);
      else setMessage('Project folder opened in Finder.');
    } catch { setError('The project folder could not open. Restore the original folder and retry.'); }
    finally { setBusy(false); }
  }

  const entries = workspace?.projects || [];
  const filtered = entries.filter(({ project }) => `${project.name} ${project.location.split('/').pop()}`.toLowerCase().includes(query.toLowerCase().trim())).sort((a, b) => sort === 'newest' ? b.project.createdAt.localeCompare(a.project.createdAt) || a.project.name.localeCompare(b.project.name) : a.project.name.localeCompare(b.project.name));
  const showCreate = creating || !opened;
  const canCreate = !!name.trim() && validFolder(folderName) && !!workspace && !busy;

  return <>
    <header className="page-header"><div><p className="eyebrow">Workspace / Projects</p><h1>Your research projects</h1><p>Create a workspace for your next idea, or pick up where you left off.</p></div>
      {showCreate ? opened && <button className="secondary" onClick={() => { setCreating(false); setError(''); }} disabled={busy}>Cancel creation</button> : <button className="primary" onClick={newProject} disabled={busy}><Icon name="plus" size={18} />New project</button>}
    </header>
    <div className="sr-only" aria-live="polite">{message}</div>
    {error && <div className="error" role="alert"><strong>Unable to complete that action</strong><p>{error}</p><button onClick={() => setError('')}>Dismiss</button></div>}
    <div className="project-layout" aria-busy={busy}>
      <section aria-label="Saved projects" className="saved-projects">
        <div className="section-heading"><h2>Saved projects <span className="count">{entries.length}</span></h2><button className="icon-button" aria-label="Refresh projects" title="Refresh projects" disabled={busy || refreshing} onClick={async () => {
          setRefreshing(true); setError('');
          try { await refresh(); setMessage('Project list refreshed.'); } catch (reason) { setError((reason as Error).message); } finally { setRefreshing(false); }
        }}><Icon name="refresh" size={16} />{refreshing ? 'Refreshing…' : 'Refresh'}</button></div>
        <div className="list-tools"><label className="search-field"><span className="sr-only">Search projects</span><Icon name="search" size={18} /><input type="search" placeholder="Search projects" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <label className="sort-field"><span className="sr-only">Sort projects</span><select aria-label="Sort projects" value={sort} onChange={(event) => setSort(event.target.value)}><option value="name">Name A–Z</option><option value="newest">Newest first</option></select></label></div>
        {!workspace ? <div className="list-empty"><p>Loading your projects…</p></div> : !entries.length ? <div className="list-empty"><span className="empty-icon"><Icon name="folder" size={28} /></span><h3>No projects yet</h3><p>Give your research a home.<br />Create a project using the form beside this list.</p></div> : !filtered.length ? <div className="list-empty"><h3>No matching projects</h3><p>Try another project name or folder.</p><button className="secondary" onClick={() => setQuery('')}>Clear search</button></div> :
          <div className="project-list">{filtered.map(({ project, availability, problem }) => {
            const current = opened?.projectId === project.projectId;
            return <article className={`project-row${current ? ' is-current' : ''}`} key={project.projectId} aria-label={project.name}>
              <span className="project-symbol"><Icon name="folder" size={22} /></span><div className="project-summary"><div className="project-title"><h3>{project.name}</h3></div><p title={project.location}>projects/{project.location.split('/').pop()}</p>
                {availability !== 'ready' && <p className="project-problem">{availability === 'incomplete' ? 'Creation incomplete' : 'Project unavailable'}</p>}
                {problem && <p className="project-recovery">{problem}</p>}</div>
              {current ? <span className="opened-status"><Icon name="check" size={16} />Opened</span> : <button className="open-button" disabled={busy} onClick={() => void act(() => availability === 'incomplete' ? window.lab.recoverProject(project.projectId) : window.lab.openProject(project.projectId))}>{availability === 'incomplete' ? 'Retry creation' : <>Open<Icon name="arrow" size={16} /></>}</button>}
            </article>;
          })}</div>}
        <div className="workspace-location"><div><Icon name="folder" size={16} /><strong>Workspace location</strong><button className="text-button" disabled={!workspace} onClick={async () => {
          try { const reply = await window.lab.copyWorkspaceLocation(); if (!reply.ok) throw new Error(reply.error.message); setCopied(true); setMessage('Workspace location copied.'); }
          catch { setError('The workspace path could not be copied. You can select and copy the displayed path.'); }
        }}>{copied ? 'Copied' : 'Copy path'}</button></div><p>{workspace?.projectsFolder || 'Opening workspace…'}</p></div>
      </section>
      {!showCreate && opened ? <section className="detail-panel" aria-label="Open project">
        <div className="panel-eyebrow"><span className="status-dot" />Current project</div>
        <span className="large-project-symbol"><Icon name="folder" size={30} /></span><h2>{opened.name}</h2>
        <p className="project-ready"><Icon name="check" size={16} />Project opened successfully</p>
        <p className="panel-description">Your project files and Git repository are ready. You can switch projects from the list.</p>
        <button className="primary show-files" disabled={busy} onClick={() => void showFiles()}><Icon name="folder" size={18} />Show files in Finder</button>
        <div className="project-facts"><span>Project folder</span><p title={opened.location}>projects/{opened.location.split('/').pop()}</p><span>Repository</span><p><span className="status-dot" />Local Git repository connected</p></div>
        <details className="technical-details"><summary>Project details</summary><dl><dt>Project identity</dt><dd>{opened.projectId}</dd><dt>Files</dt><dd>{opened.location}</dd><dt>Git repository</dt><dd>{opened.repository}</dd></dl></details>
        <div className="scope-note">Task setup and research runs will be available in a future update.</div>
      </section> : <section className="create-panel" aria-label="Create project">
        <div className="panel-eyebrow">A home for your research</div><h2>Create a project</h2><p className="panel-description">Each project has its own folder and Git repository.</p>
        <form onSubmit={(event) => { event.preventDefault(); if (canCreate) void act(() => window.lab.createProject({ requestId, name, folderName })); }}>
          <div className="field-label"><label htmlFor="project-name">Project name</label><span>Required</span></div><input ref={nameInput} id="project-name" required maxLength={120} placeholder="e.g. Image research" value={name} disabled={busy} aria-describedby="name-hint" onChange={(event) => {
            setName(event.target.value); setRequestId(crypto.randomUUID());
            if (!folderEdited) setFolderName(folderSuggestion(event.target.value));
          }} /><p className="field-hint" id="name-hint">A display name to recognize your project.</p>
          <div className="field-label"><label htmlFor="folder-name">Folder name</label><span>{folderEdited ? 'Custom' : 'Auto-suggested'}</span></div><input id="folder-name" required maxLength={80} pattern="[a-zA-Z0-9]([a-zA-Z0-9_]|-)*" placeholder="image-research" value={folderName} disabled={busy} aria-describedby="folder-hint" aria-invalid={!!folderName && !validFolder(folderName)} onChange={(event) => {
            setFolderEdited(true); setFolderName(event.target.value); setRequestId(crypto.randomUUID());
          }} /><p className={`field-hint${folderName && !validFolder(folderName) ? ' invalid-hint' : ''}`} id="folder-hint">Suggested from your project name. Edit if needed.<br />Use letters, numbers, hyphens or underscores; start with a letter or number.</p>
          {folderEdited && <button type="button" className="text-button reset-folder" disabled={busy} onClick={() => { setFolderEdited(false); setFolderName(folderSuggestion(name)); setRequestId(crypto.randomUUID()); }}>Use suggested folder name</button>}
          <div className="destination"><span>Will be saved in your workspace</span><p>projects/<strong>{folderName || 'your-project'}</strong></p></div>
          <button className="primary create-button" type="submit" disabled={!canCreate}>{busy ? 'Creating project…' : <><Icon name="plus" size={18} />Create project</>}</button>
          <p className="safe-creation"><Icon name="check" size={14} />Existing folders are never overwritten.</p>
        </form>
      </section>}
    </div>
  </>;
}

const pages = {
  Projects: { title: 'Your research projects', description: '', empty: '', hint: '' },
  Runs: { title: 'Research runs', description: 'Follow experiments, results, and agent activity across your projects.', empty: 'No runs yet', hint: 'Runs will appear here after you create a project and start research.' },
  Compute: { title: 'Your compute', description: 'Connect existing cloud GPU instances for your research.', empty: 'No connected instances', hint: 'Provider connections will be available in a future update.' },
};

function App() {
  const [page, setPage] = useState<keyof typeof pages>('Projects');
  const [status, setStatus] = useState('Opening workspace…');
  useEffect(() => {
    window.lab.getStatus().then(() => setStatus('Workspace ready')).catch(() => setStatus('Workspace unavailable. Please restart the app.'));
  }, []);
  const content = pages[page];
  return <div className="workspace">
    <aside className="workspace-sidebar">
      <div className="brand"><span className="brand-mark">A</span><div>Autoresearch Lab<small>Personal research workspace</small></div></div>
      <p className="nav-label">WORKSPACE</p><nav aria-label="Workspace">{(Object.keys(pages) as (keyof typeof pages)[]).map((name) =>
        <button key={name} aria-current={page === name ? 'page' : undefined} onClick={() => setPage(name)}><Icon name={name === 'Projects' ? 'folder' : name === 'Runs' ? 'runs' : 'compute'} size={19} />{name}{name !== 'Projects' && <span className="soon-label" aria-hidden="true">Soon</span>}</button>)}</nav>
      <div className="workspace-status" role="status"><span className="status-dot" />{status}</div>
    </aside>
    <main>{page === 'Projects' ? <Projects /> : <><header className="page-header"><div><p className="eyebrow">Workspace / {page}</p><h1>{content.title}</h1><p>{content.description}</p></div></header><section className="empty-state" aria-label={page}><span className="empty-icon"><Icon name={page === 'Runs' ? 'runs' : 'compute'} size={28} /></span><h2>{content.empty}</h2><p>{content.hint}</p></section></>}</main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
