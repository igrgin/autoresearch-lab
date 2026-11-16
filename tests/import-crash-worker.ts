import { SafeRecording } from '../src/security/recording';
import { PrivateFiles } from '../src/security/private-files';
import { Sanitizer } from '../src/security/sanitizer';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProjectCatalog } from '../src/catalog/catalog';
import { DatasetImports } from '../src/importer/importer';
import type { ProjectRecord } from '../src/projects';
const [applicationData, projectId, source, importId, stage, mode] = process.argv.slice(2);
const catalog = new ProjectCatalog(applicationData);
const matcher = new Sanitizer();
const recording = new SafeRecording(new PrivateFiles(path.join(applicationData, 'import-security')), matcher, async () => {});
const imports = new DatasetImports(id => {
  const reply = catalog.handle({ kind: 'open', operationId: randomUUID(), projectId: id });
  if (!reply.ok) throw new Error('Project unavailable');
  return reply.value as ProjectRecord;
}, { recording, ownMetadata: () => ({ release: matcher.holdMatchingPolicy(), recording }), checkpoint: checkpoint => { if (checkpoint === stage) process.kill(process.pid, 'SIGKILL'); } });
async function run() {
  await recording.initialize();
  const started = await imports.handle({ kind: 'imports:start', operationId: importId, projectId, sourcePaths: [source], destinationName: 'killed', mode: mode === 'move' ? 'move' : 'copy' });
  if (!started.ok) throw new Error('Import rejected');
  const actualId = started.value.find(record => record.operationId === importId)!.importId;
  await imports.settled(actualId);
  if (mode === 'move') {
    const reply = await imports.handle({ kind: 'imports:list', operationId: randomUUID(), projectId });
    if (!reply.ok) throw new Error('Import unavailable');
    const record = reply.value[0];
    await imports.confirmPreparation(projectId, actualId, record.revision, randomUUID());
    await imports.settled(actualId);
  }
  imports.close(); catalog.close();
}
void run();
