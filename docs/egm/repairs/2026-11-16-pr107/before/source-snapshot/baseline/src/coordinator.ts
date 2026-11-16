import { ClaudeSelectionStore, type SelectionCommand } from './claude/store';
import { ClaudeFailure, failureReply } from './claude/contracts';
import { CodexStore } from './codex/store';
import { codexStoreFailure, CodexFailure } from './codex/errors';
import type { CodexStoreCommand } from './codex/contract';
import type { ImportRequest } from './imports';
import { DatasetImports } from './importer/importer';
import { ConfigurationStore } from './configuration/store';
import type { ConfigurationRequest } from './configuration';
import { randomUUID } from 'node:crypto';
import type { ReservationRequest } from './compute/contracts';
import { ProjectCatalog } from './catalog/catalog';
import type { ProjectRequest } from './projects';
import { handleResearch, type ResearchRequest } from './research/host';
import type { Owner, ResearchEvent } from './research/contracts';
import type { Envelope, SafeRecord } from './security/recording';
import { SecurityError } from './security/common';

// Matching material stays in main's credential service. The database writer
// requests memory-only admission/rechecks on this private utility-process port.
const securityRequests = new Map<string, { resolve: (value: SafeRecord) => void; reject: () => void; timer: ReturnType<typeof setTimeout> }>();
function securityRequest(kind: 'admit' | 'receipt' | 'recheck', value: { meta: Envelope; raw: unknown } | { owner: Owner; event: ResearchEvent } | SafeRecord): Promise<SafeRecord> {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const fail = () => reject(new SecurityError('capture_failed'));
    const timer = setTimeout(() => { securityRequests.delete(id); fail(); }, 15_000);
    securityRequests.set(id, { resolve, reject: fail, timer });
    process.parentPort.postMessage({ channel: 'research_security', id, kind, value });
  });
}
const admission = {
  admit: (meta: Envelope, raw: unknown) => securityRequest('admit', { meta, raw }),
  admitReceipt: (owner: Owner, event: ResearchEvent) => securityRequest('receipt', {owner,event}),
  recheck: (record: SafeRecord) => securityRequest('recheck', record),
};
// Import inventories cross the policy boundary only as bounded pieces. This
// identity-only probe validates cached pieces against current matching and
// durable quarantine; it carries no source paths or inventory payload.
const metadataRequests = new Map<string, { resolve: (revision: string) => void; reject: () => void; timer: ReturnType<typeof setTimeout> }>();
function metadataRevision(meta: Envelope): Promise<string> {
  return new Promise((resolve, reject) => {
    const id = randomUUID(); const fail = () => reject(new SecurityError('capture_failed'));
    const timer = setTimeout(() => { metadataRequests.delete(id); fail(); }, 15_000);
    metadataRequests.set(id, { resolve, reject: fail, timer });
    process.parentPort.postMessage({ channel: 'import_metadata_revision', id, meta });
  });
}

// Main provides the OS application-data location; the utility coordinator is
// the sole writer for registry/history, project files and Git operations.
const applicationData = process.argv[2];
if (!applicationData) throw new Error('The workspace application-data location is missing.');
let catalog: ProjectCatalog | undefined;
let configurations: ConfigurationStore;
const configurationAdmissions = new Map<string, (allowed: boolean) => void>();
function admitConfiguration(value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => { configurationAdmissions.delete(id); reject(new Error('Admission unavailable')); }, 15_000);
    configurationAdmissions.set(id, allowed => {
      clearTimeout(timer); configurationAdmissions.delete(id);
      if (allowed) resolve(); else reject(new Error('Admission rejected'));
    });
    process.parentPort.postMessage({ configurationAdmissionId: id, value });
  });
}
let codex: CodexStore;
let agentSettings: ClaudeSelectionStore;
try {
  catalog = new ProjectCatalog(applicationData);
  configurations = new ConfigurationStore(applicationData, catalog);
  codex = new CodexStore(applicationData);
  agentSettings = new ClaudeSelectionStore(applicationData);
} catch {
  catalog?.close(); catalog = undefined;
  process.parentPort.postMessage({ coordinator: 'failed', message: 'Workspace storage could not open. Check application-data folder permissions and free disk space. If this workspace was created by a newer app, reopen it with that version. Existing files were left intact.' });
  process.exitCode = 1;
  // Keep the message port alive until main receives the failure and terminates us.
}
if (catalog) {
  const activeCatalog = catalog;
  const admissions = new Map<string, (allowed: boolean) => void>();
  const imports = new DatasetImports(projectId => {
    const reply = activeCatalog.handle({ kind: 'open', operationId: randomUUID(), projectId });
    if (!reply.ok || !('projectId' in reply.value)) throw new Error('Project unavailable');
    return reply.value;
  }, { recording: { ...admission, metadataRevision }, admitNames: names => new Promise(resolve => {
    const id = randomUUID();
    const timer = setTimeout(() => { admissions.delete(id); resolve(false); }, 15000);
    admissions.set(id, allowed => { clearTimeout(timer); admissions.delete(id); resolve(allowed); });
    process.parentPort.postMessage({ importAdmissionId: id, names });
  }) });

  process.parentPort.on('message', async ({ data }: { data: { channel?: string; id: string; request: ProjectRequest | ResearchRequest | ReservationRequest | ImportRequest; importAdmissionId?: string; allowed?: boolean; configuration?: ConfigurationRequest; configurationAdmissionId?: string; codex?: CodexStoreCommand; selection?: SelectionCommand; record?: SafeRecord; revision?: string; ok?: boolean } }) => {
    if (data.channel === 'import_metadata_revision') {
      const pending = metadataRequests.get(data.id); if (!pending) return;
      clearTimeout(pending.timer); metadataRequests.delete(data.id);
      if (data.ok && typeof data.revision === 'string' && data.revision.length > 0 && data.revision.length <= 200) pending.resolve(data.revision);
      else pending.reject();
      return;
    }
    if (data.importAdmissionId) { admissions.get(data.importAdmissionId)?.(data.allowed === true); return; }
    if (data.selection) {
      let selectionReply;
      try { selectionReply = { ok: true, value: agentSettings.handle(data.selection) }; }
      catch (error) { selectionReply = failureReply(error instanceof ClaudeFailure ? error.reason : 'unavailable', data.id); }
      // A reply transport failure after commit is handled as unknown in main.
      process.parentPort.postMessage({ id: data.id, selectionReply });

      return;
    }
    if (data.codex) {
      let codexReply;
      try {
        if ('projectId' in data.codex) {
          const project = activeCatalog.handle({ kind: 'open', operationId: data.id, projectId: data.codex.projectId });
          if (!project.ok) throw new CodexFailure('unavailable');
        }
        codexReply = { ok: true as const, value: codex.handle(data.codex) };
      } catch (error) { codexReply = codexStoreFailure(error, data.codex, data.id); }
      process.parentPort.postMessage({ id: data.id, codexReply });

      return;
    }
    if (data.configurationAdmissionId) { configurationAdmissions.get(data.configurationAdmissionId)?.(data.allowed === true); return; }
    if (data.configuration) { process.parentPort.postMessage({ id: data.id, configurationReply: await configurations.handleAdmitted(data.configuration, admitConfiguration) }); return; }
    if (data.channel === 'research_security') {
      const pending = securityRequests.get(data.id); if (!pending) return;
      clearTimeout(pending.timer); securityRequests.delete(data.id);
      if (data.ok && data.record) pending.resolve(data.record); else pending.reject();
      return;
    }
    if (data.channel === 'research') {
      void handleResearch(activeCatalog, admission, data.request as ResearchRequest).then(reply =>
        process.parentPort.postMessage({ channel: 'research', id: data.id, reply }));
      return;
    }
    const reply = data.request?.kind?.startsWith('compute.') ? activeCatalog.reservations.handle(data.request as ReservationRequest) : data.request?.kind?.startsWith('imports:') ? await imports.handle(data.request as ImportRequest) : activeCatalog.handle(data.request as ProjectRequest);
    process.parentPort.postMessage({ id: data.id, reply });
  });
  process.parentPort.postMessage({ coordinator: 'ready', sqliteVersion: activeCatalog.sqliteVersion });
  process.on('exit', () => { agentSettings.close(); codex.close(); imports.close(); configurations.close(); activeCatalog.close(); });
}
