import { ProjectCatalog } from './catalog/catalog';
import type { ProjectRequest } from './projects';

// Main provides the OS application-data location; the utility coordinator is
// the sole writer for registry/history, project files and Git operations.
const applicationData = process.argv[2];
if (!applicationData) throw new Error('The workspace application-data location is missing.');
let catalog: ProjectCatalog | undefined;
try {
  catalog = new ProjectCatalog(applicationData);
} catch {
  process.parentPort.postMessage({ coordinator: 'failed', message: 'Workspace storage could not open. Check application-data folder permissions and free disk space. If this workspace was created by a newer app, reopen it with that version. Existing files were left intact.' });
  process.exitCode = 1;
  // Keep the message port alive until main receives the failure and terminates us.
}
if (catalog) {
  const activeCatalog = catalog;
  process.parentPort.on('message', ({ data }: { data: { id: string; request: ProjectRequest } }) => {
    process.parentPort.postMessage({ id: data.id, reply: activeCatalog.handle(data.request) });
  });
  process.parentPort.postMessage({ coordinator: 'ready', sqliteVersion: activeCatalog.sqliteVersion });
  process.on('exit', () => activeCatalog.close());
}
