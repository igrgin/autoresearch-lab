import { createHash, randomUUID } from 'node:crypto';
import type { AcquireReservation, Provider, ReleaseEvidence, Reservation } from '../src/compute/contracts';

export function allocation(projectId: string, provider: Provider = 'runpod', instanceId = provider === 'runpod' ? 'fixture-pod' : '1234'): AcquireReservation {
  const hex = createHash('sha256').update(provider + instanceId).digest('hex').slice(0, 32);
  const uuid = `GPU-${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return { operationId: randomUUID(), reservationId: randomUUID(), projectId, runId: randomUUID(), authorityId: randomUUID(), episodeId: randomUUID(), scopeId: randomUUID(),
    allocation: { provider, instanceId, incarnationId: 'fixture-incarnation', accountId: 'fixture-account', identityStatus: 'verified', gpuIds: [{ uuid, ordinal: 0 }] } };
}
// A synthetic trusted all-scope attestation. It is not live termination evidence.
export function quiescence(r: Reservation): ReleaseEvidence {
  return { evidenceId: randomUUID(), schemaVersion: 1, grantRevision: 1,
    reservationId: r.reservationId, projectId: r.projectId, runId: r.runId, authorityId: r.authorityId, episodeId: r.episodeId, scopeId: r.scopeId,
    provider: r.allocation.provider, instanceId: r.allocation.instanceId, incarnationId: r.allocation.incarnationId,
    futureLaunches: 'fenced', mutationAuthority: 'disabled', receipts: 'settled', localAgents: 'stopped', localHelpers: 'absent',
    remote: { kind: 'scope', coverage: 'all_application_work', workers: 'stopped' }, attemptIds: [randomUUID()] };
}
