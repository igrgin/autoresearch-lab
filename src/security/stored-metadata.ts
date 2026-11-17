import { createHash } from 'node:crypto';
import { assertId, POLICY_REVISION, SecurityError } from './common';
import type { CapturePath, SafeRecording, Envelope } from './recording';
import type { SafeValue } from './sanitizer';

// External stores retain their own records. A stable record-scoped security
// envelope lets the shared policy quarantine them without copying their bodies
// into another store. These scopes grant no research/execution authority.
export function storedMetadataEnvelope(identity: { recordId: string; projectId: string }, source: CapturePath): Envelope {
  const { recordId, projectId } = identity;
  assertId(recordId); assertId(projectId);
  const bytes = createHash('sha256').update(`stored-metadata/1:${source}:${projectId}:${recordId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  const securityId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return { projectId, runId: securityId, actionId: recordId, operationId: securityId,
    eventId: securityId, producerId: securityId, streamId: securityId, sequence: 0, source, kind: 'activity', status: 'completed' };
}
export async function recheckStoredMetadata(recording: Pick<SafeRecording, 'recheck'>,
  identity: { recordId: string; projectId: string }, body: unknown, source: CapturePath): Promise<void> {
  const checked = await recording.recheck({ contractVersion: { major: 1, minor: 0 }, policyRevision: POLICY_REVISION,
    envelope: storedMetadataEnvelope(identity, source),
    body: body as SafeValue, coverage: 'complete' });
  if (checked.coverage !== 'complete' || JSON.stringify(checked.body) !== JSON.stringify(body)) throw new SecurityError('capture_failed');
}
