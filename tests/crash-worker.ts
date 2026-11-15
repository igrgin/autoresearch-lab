import { ProjectCatalog } from '../src/catalog/catalog';
import type { CreateProject } from '../src/projects';

const [root, stage, payload] = process.argv.slice(2);
const input = JSON.parse(payload) as CreateProject;
const catalog = new ProjectCatalog(root, (checkpoint) => {
  if (checkpoint === stage) process.kill(process.pid, 'SIGKILL');
});
const reply = catalog.handle({ kind: 'create', operationId: input.requestId, input });
if (!reply.ok) throw new Error(reply.error.message);
catalog.close();
