import './window-titlebar.css';

export function WindowTitlebar({ title, settings = false }: { title: string; settings?: boolean }) {
  if (!navigator.userAgent.includes('Macintosh')) return null;
  return <div className={`window-titlebar${settings ? ' window-titlebar--settings' : ''}`} aria-hidden="true">{title}</div>;
}
