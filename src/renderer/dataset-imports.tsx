import { useMetadataState } from './metadata-state';
import React, { useEffect, useRef, useState } from 'react';
import type { ImportAction, ImportRecord, ImportSelection } from '../imports';

const working = (record: ImportRecord) => ['inventorying', 'copying', 'verifying', 'publishing', 'cleaning'].includes(record.state);
export function DatasetImportPanel({ projectId }: { projectId: string }) {
  const [records, setRecords] = useMetadataState<ImportRecord[]>([]);
  const [selection, setSelection] = useMetadataState<ImportSelection | null>(null);
  const [destination, setDestination] = useMetadataState('local-data');
  const [mode, setMode] = useState<'copy' | 'move'>('copy');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const hasActiveImport = records.some(working);
  function withhold(message: string) {
    setRecords([]); setSelection(null); setDestination('local-data'); setError(message);
  }
  useEffect(() => {
    let disposed = false;
    async function refresh() {
      try {
        const reply = await window.lab.listImports(projectId);
        if (disposed) return;
        if (reply.ok) setRecords(reply.value); else withhold(reply.error.message);
      } catch { if (!disposed) withhold('Import storage is unavailable. Reopen the project and retry.'); }
    }
    void refresh();
    const timer = hasActiveImport ? setInterval(() => void refresh(), 500) : undefined;
    return () => { disposed = true; clearInterval(timer); };
  }, [projectId, hasActiveImport]);
  async function select(kind: 'directory' | 'files') {
    try { const result = await window.lab.selectImportSource(kind); if (result) { setSelection(result); setMode('copy'); requestId.current = crypto.randomUUID(); setError(''); } }
    catch { setError('Could not select the source. Try the file picker again.'); }
  }
  async function action(record: ImportRecord, action: ImportAction) {
    setBusy(true); setError('');
    try { const reply = await window.lab.importAction(projectId, record.importId, record.revision, action); if (reply.ok) setRecords(reply.value); else withhold(reply.error.message); }
    catch { withhold('Import action was not confirmed. Refresh the project before retrying.'); }
    finally { setBusy(false); }
  }
  return <section className="dataset-imports" aria-label="Local dataset imports">
    <h3>Local dataset</h3><p>Copy selected files into this project. Byte import is followed by task and split preparation before research can start.</p>
    <div className="import-actions"><button className="secondary" disabled={busy} onClick={async () => { try { const reply = await window.lab.listImports(projectId); if (reply.ok) { setRecords(reply.value); setError(''); } else withhold(reply.error.message); } catch { withhold('Import storage is unavailable. Reopen the project.'); } }}>Refresh imports</button><button className="secondary" disabled={busy} onClick={() => void select('directory')}>Choose dataset directory</button><button className="secondary" disabled={busy} onClick={() => void select('files')}>Choose dataset files</button></div>
    {selection && <form onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError('');
      try {
        const reply = await window.lab.startImport(projectId, { requestId: requestId.current, selectionId: selection.selectionId, destinationName: destination, mode });
        if (reply.ok) { setRecords(reply.value); setSelection(null); requestId.current = crypto.randomUUID(); } else withhold(reply.error.message);
      } catch { withhold('Import request was not confirmed. Refresh before starting another import; its intent may already be saved.'); }
      finally { setBusy(false); }
    }}>
      <p>{selection.directory ? 'One directory selected. All contained files will be imported.' : `${selection.fileCount} files selected.`} Supported bytes: JPEG/PNG, CSV/JSONL and text. Decoding, labels and split checks follow during preparation.</p>
      <label>Dataset folder name<input aria-label="Dataset folder name" required pattern="[a-zA-Z0-9]([a-zA-Z0-9_]|-){0,79}" maxLength={80} value={destination} onChange={event => { setDestination(event.target.value); requestId.current = crypto.randomUUID(); }} /></label>
      <p>Project location: <code>dataset/{destination}/files</code>. Existing destinations are preserved.</p>
      <label>Import policy<select aria-label="Import policy" value={mode} onChange={event => { setMode(event.target.value as 'copy' | 'move'); requestId.current = crypto.randomUUID(); }}><option value="copy">Copy — keep source files</option>{selection.directory && <option value="move">Move — remove matching source files after confirmed preparation</option>}</select></label>
      {mode === 'move' && <p role="note">Move copies and verifies first. Source files will be removed only after layout, interpretation and splits are confirmed by preparation. Changed/new entries stay at the source. That preparation step is not available yet.</p>}
      <button type="submit" className="primary" disabled={busy}>Start {mode} import</button>
    </form>}
    {error && <p role="alert">{error}</p>}
    <div aria-live="polite">{records.map(record => <article className="import-record" key={record.importId}>
      <strong>{record.destination}</strong><p>{record.bytesUsable ? 'Byte import complete' : record.state === 'partial' ? 'Partial import' : record.state === 'discarded' ? 'Staging discarded' : `Import ${record.state}`}{record.state === 'cleanup_pending' && ' · source cleanup pending'}</p>
      {record.state !== 'discarded' && <><progress aria-label={`Import progress ${record.destination}`} value={record.completedBytes} max={Math.max(1, record.totalBytes)} /><p>{record.completedFiles}/{record.totalFiles} files copied · {record.completedBytes}/{record.totalBytes} bytes copied{record.failedFiles > 0 && ` · ${record.failedFiles} unfinished files`}</p></>}
      {record.state === 'cleanup_pending' && <p>{record.remainingSourceFiles} inventoried source files remain; changed or new entries may also remain.</p>}
      {record.problem && <p>{record.problem}</p>}
      {record.bytesUsable && <p>Research readiness: task, layout, interpretation and splits still require preparation.</p>}
      <div className="import-actions">{working(record) && !record.bytesUsable && <button disabled={busy} onClick={() => void action(record, 'cancel')}>Cancel import</button>}
      {record.state === 'partial' && <><button disabled={busy} onClick={() => void action(record, 'retry')}>Retry import</button><button disabled={busy} onClick={() => void action(record, 'discard')}>Discard staging</button></>}
      {record.state === 'cleanup_pending' && record.preparationRef && <button disabled={busy} onClick={() => void action(record, 'retry_cleanup')}>Retry source cleanup</button>}</div>
    </article>)}</div>
  </section>;
}
