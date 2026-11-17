import { ConfigurationStore } from './configuration/store';
import type { ConfigurationRequest } from './configuration';
import { randomUUID } from 'node:crypto';
import type { ReservationRequest } from './compute/contracts';
import { ProjectCatalog } from './catalog/catalog';
import type { ProjectRequest } from './projects';
import { handleResearch, type ResearchRequest } from './research/host';
import { ResearchSecurityClient } from './research/security-port';
import type { Envelope, SafeRecord } from './security/recording';
import { SecurityError } from './security/common';

// Matching material stays in main's credential service. The database writer
// requests memory-only admission/rechecks on this private utility-process port.
const admission = new ResearchSecurityClient(message => process.parentPort.postMessage(message));

// Main provides the OS application-data location; the utility coordinator is
// the sole writer for registry/history, project files and Git operations.
const applicationData = process.argv[2];
if (!applicationData) throw new Error('The workspace application-data location is missing.');
let catalog: ProjectCatalog | undefined;
let configurations: ConfigurationStore;
const configurationAdmissions = new Map<string, (allowed: boolean) => void>();
function admitConfiguration(configurationRequestId: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => { configurationAdmissions.delete(id); reject(new Error('Admission unavailable')); }, 15_000);
    configurationAdmissions.set(id, allowed => {
      clearTimeout(timer); configurationAdmissions.delete(id);
      if (allowed) resolve(); else reject(new Error('Admission rejected'));
    });
    process.parentPort.postMessage({ configurationAdmissionId: id, configurationRequestId, value });
  });
}
try {
  catalog = new ProjectCatalog(applicationData);
  configurations = new ConfigurationStore(applicationData, catalog);
} catch {
  catalog?.close(); catalog = undefined;
  process.parentPort.postMessage({ coordinator: 'failed', message: 'Workspace storage could not open. Check application-data folder permissions and free disk space. If this workspace was created by a newer app, reopen it with that version. Existing files were left intact.' });
  process.exitCode = 1;
  // Keep the message port alive until main receives the failure and terminates us.
}
if (catalog) {
  const activeCatalog = catalog;
  process.parentPort.on('message', async ({ data }: { data: { channel?: string; id: string; request: ProjectRequest | ResearchRequest | ReservationRequest; configuration?: ConfigurationRequest; configurationAdmissionId?: string; allowed?: boolean; record?: SafeRecord; ok?: boolean } }) => {
    if (data.configurationAdmissionId) { configurationAdmissions.get(data.configurationAdmissionId)?.(data.allowed === true); return; }
    if (data.configuration) { process.parentPort.postMessage({ id: data.id, configurationReply: await configurations.handleAdmitted(data.configuration, value => admitConfiguration(data.id, value)) }); return; }
    if (data.channel === 'research_security') {
      admission.receive({channel:'research_security',id:data.id,ok:data.ok===true,record:data.record});
      return;
    }
    if (data.channel === 'research') {
      void handleResearch(activeCatalog, admission, data.request as ResearchRequest).then(reply =>
        process.parentPort.postMessage({ channel: 'research', id: data.id, reply }));
      return;
    }
    const reply = data.request?.kind?.startsWith('compute.') ? activeCatalog.reservations.handle(data.request as ReservationRequest) : activeCatalog.handle(data.request as ProjectRequest);
    process.parentPort.postMessage({ id: data.id, reply });
  });
  process.parentPort.postMessage({ coordinator: 'ready', sqliteVersion: activeCatalog.sqliteVersion });
  process.on('exit', () => { configurations.close(); activeCatalog.close(); });
}
