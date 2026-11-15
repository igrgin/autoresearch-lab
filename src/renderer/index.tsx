import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ShellBridge } from '../shell';
import './style.css';

declare global { interface Window { lab: ShellBridge } }

const pages = {
  Projects: { title: 'Your research starts here', description: 'Projects will bring together your task, dataset, and research runs.', empty: 'No projects yet', hint: 'Project creation will be available in a future update.' },
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
    <aside>
      <div className="brand"><span className="brand-mark">A</span><div>Autoresearch Lab<small>Personal research workspace</small></div></div>
      <nav aria-label="Workspace">{(Object.keys(pages) as (keyof typeof pages)[]).map((name) =>
        <button key={name} aria-current={page === name ? 'page' : undefined} onClick={() => setPage(name)}>{name}</button>)}</nav>
      <div className="workspace-status" role="status">{status}</div>
    </aside>
    <main>
      <header><p className="eyebrow">Workspace / {page}</p><h1>{content.title}</h1><p>{content.description}</p></header>
      <section className="empty-state" aria-label={page}>
        <div className="empty-mark" aria-hidden="true">{page === 'Projects' ? '◇' : page === 'Runs' ? '↗' : '▦'}</div>
        <h2>{content.empty}</h2><p>{content.hint}</p>
      </section>
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
