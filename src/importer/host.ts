import type { ImportRecord, ImportRequest } from '../imports';
import type { ProjectReply } from '../projects';
import type { SafeRecording } from '../security/recording';
import { recheckStoredMetadata } from '../security/stored-metadata';

export async function requestImport(request: ImportRequest,
  dispatch: (request: ImportRequest) => Promise<ProjectReply<ImportRecord[]>>,
  security: { initialize(): Promise<void>; recording: Pick<SafeRecording, 'recheck'>; assertSafeConfiguration(value: unknown): void }): Promise<ProjectReply<ImportRecord[]>> {
  try {
    await security.initialize();
    const reply = await dispatch(request);
    let unsafe = false;
    if (reply.ok) for (const record of reply.value) {
      try { await recheckStoredMetadata(security.recording, { recordId: record.importId, projectId: record.projectId }, record, 'file_name'); }
      catch { unsafe = true; } // Contain every affected record, then withhold the reply.
    }
    if (unsafe) throw new Error('Unsafe retained import metadata');
    security.assertSafeConfiguration(reply);
    return reply;
  } catch {
    return { ok: false, error: { code: 'unavailable', origin: 'dataset_import', operationId: request.operationId,
      message: 'Import records were withheld by credential protection. Review credential exposure and retained metadata before retrying.',
      effect: request.kind === 'imports:list' ? 'none' : 'unknown', retry: 'after_reconcile' } };
  }
}
