// Trusted coordinator/adapter port. Never expose release evidence or acquisition
// through ordinary renderer IPC. Credentials and vendor responses stay out of it.
export type Provider = 'runpod' | 'vast';
export interface Allocation {
  provider: Provider;
  instanceId: string; // Runpod Pod ID or Vast contract ID, never host/IP/name.
  incarnationId: string;
  accountId: string; // Access metadata, excluded from the uniqueness key.
  identityStatus: 'verified';
  gpuIds: { uuid: string; ordinal: number }[]; // Ordered selected devices.
}
export interface AcquireReservation {
  operationId: string;
  reservationId: string;
  projectId: string;
  runId: string;
  authorityId: string;
  episodeId: string;
  scopeId: string; // Sealed all-application process scope, not just training parent.
  allocation: Allocation;
}
export interface Reservation extends AcquireReservation {
  recordKind: 'reservation';
  schemaVersion: 1;
  owner: 'reservation_coordinator';
  grantRevision: 1;
  revision: number;
  state: 'held' | 'stopping_unknown' | 'released';
  createdAt: string;
  release: ReleaseIntent | null;
}
export interface ProofIdentity {
  reservationId: string;
  projectId: string;
  runId: string;
  authorityId: string;
  episodeId: string;
  scopeId: string;
  provider: Provider;
  instanceId: string;
  incarnationId: string;
  grantRevision: 1;
}
export interface ReleaseEvidence extends ProofIdentity {
  evidenceId: string;
  schemaVersion: 1;
  // Producer must durably fence the entire episode before issuing this proof.
  futureLaunches: 'fenced' | 'unknown';
  mutationAuthority: 'disabled' | 'unknown';
  receipts: 'settled' | 'unknown';
  localAgents: 'stopped' | 'absent' | 'running' | 'unknown';
  localHelpers: 'stopped' | 'absent' | 'running' | 'unknown';
  remote: { kind: 'scope'; coverage: 'all_application_work' | 'partial'; workers: 'stopped' | 'absent' | 'running' | 'unknown' }
    | { kind: 'destroyed'; source: 'authoritative_incarnation_destruction'; irreversible: boolean };
  attemptIds: string[]; // Includes every admitted attempt; empty during preparation.
}
export interface ReleaseIntent {
  releaseId: string;
  expectedRevision: number;
  evidence: ReleaseEvidence;
}
// Only trusted execution/provider evidence collectors implement this interface.
// Ack, parent exit, utilization, timeout, list omission and access failure have
// no conversion to ReleaseEvidence. Unknown evidence retains the reservation.
export interface ReservationEvidenceSource {
  inspect(reservation: Readonly<Reservation>): ReleaseEvidence | null;
}
export type ReservationRequest =
  | { kind: 'compute.acquire'; operationId: string; input: AcquireReservation }
  | { kind: 'compute.list'; operationId: string }
  | { kind: 'compute.stopping' | 'compute.assert_launchable'; operationId: string; reservationId: string; expectedRevision: number }
  | { kind: 'compute.release'; operationId: string; reservationId: string; expectedRevision: number; releaseId: string };
export type ReservationReply = { ok: true; value: Reservation | Reservation[] }
  | { ok: false; error: { code: ReservationCode; origin: 'reservation_coordinator'; operationId: string; message: string; effect: 'none' | 'unknown'; retry: 'after_reconcile' } };
export type ReservationCode = 'invalid_input' | 'conflict' | 'idempotency_conflict' | 'not_found' | 'unavailable';
export class ReservationError extends Error {
  readonly origin = 'reservation_coordinator';
  readonly retry = 'after_reconcile';
  constructor(readonly code: ReservationCode, readonly effect: 'none' | 'unknown' = 'none') {
    super({ invalid_input: 'Invalid reservation request or unverified allocation.', conflict: 'Compute or run authority is already reserved, or its revision changed.',
      idempotency_conflict: 'This identity already belongs to different reservation details.', not_found: 'Reservation or project not found.',
      unavailable: 'Application work is not proved stopped or durable release is unavailable. Keep the reservation and reconcile.' }[code]);
  }
}
