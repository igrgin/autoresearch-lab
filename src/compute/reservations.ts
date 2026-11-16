import type Database from 'better-sqlite3';
import { ReservationError, type AcquireReservation, type Provider, type ReleaseEvidence, type ReleaseIntent, type Reservation, type ReservationEvidenceSource, type ReservationReply, type ReservationRequest } from './contracts';

export const reservationRegistrySql = `CREATE TABLE compute_reservations (
  reservation_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL REFERENCES projects(project_id), run_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('runpod','vast')), instance_id TEXT NOT NULL,
  payload TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0),
  state TEXT NOT NULL CHECK(state IN ('held','stopping_unknown','released')),
  created_at TEXT NOT NULL, release_intent TEXT
);
CREATE UNIQUE INDEX compute_instance_exclusive ON compute_reservations(provider, instance_id) WHERE state != 'released';
CREATE UNIQUE INDEX compute_run_exclusive ON compute_reservations(run_id) WHERE state != 'released';
CREATE TABLE compute_reservation_gpus (
  reservation_id TEXT NOT NULL REFERENCES compute_reservations(reservation_id),
  provider TEXT NOT NULL, gpu_uuid TEXT NOT NULL, ordinal INTEGER NOT NULL,
  active INTEGER NOT NULL CHECK(active IN (0,1)), PRIMARY KEY(reservation_id, gpu_uuid)
);
CREATE UNIQUE INDEX compute_gpu_exclusive ON compute_reservation_gpus(provider, gpu_uuid) WHERE active = 1;`;
export const reservationHistorySql = `CREATE TABLE compute_release_intents (
  reservation_id TEXT PRIMARY KEY, release_id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL REFERENCES project_identity(project_id), intent TEXT NOT NULL
);`;
export type ReleaseCheckpoint = 'before_project_intent' | 'project_intent' | 'before_global_release' | 'global_release';
export interface ReservationOptions {
  evidence?: ReservationEvidenceSource;
  checkpoint?: (stage: ReleaseCheckpoint) => void;
}
type Row = { payload: string; revision: number; state: Reservation['state']; created_at: string; release_intent: string | null };
type ProjectHistory = <T>(projectId: string, operation: (db: Database.Database) => T) => T;
function fail(code: ConstructorParameters<typeof ReservationError>[0]): never { throw new ReservationError(code); }
function id(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) fail('invalid_input');
}
function opaque(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) fail('invalid_input');
}
function revision(value: number) { if (!Number.isSafeInteger(value) || value < 1) fail('invalid_input'); }
function normalize(input: AcquireReservation): AcquireReservation {
  if (!input || typeof input !== 'object' || !input.allocation) fail('invalid_input');
  const { operationId, reservationId, projectId, runId, authorityId, episodeId, scopeId, allocation: a } = input;
  for (const value of [operationId, reservationId, projectId, runId, authorityId, episodeId, scopeId]) id(value);
  if (a.provider !== 'runpod' && a.provider !== 'vast') fail('invalid_input');
  opaque(a.instanceId); opaque(a.accountId); opaque(a.incarnationId);
  if (a.provider === 'vast' && !/^[1-9][0-9]*$/.test(a.instanceId)) fail('invalid_input');
  if (a.identityStatus !== 'verified' || !Array.isArray(a.gpuIds) || !a.gpuIds.length || a.gpuIds.length > 256) fail('invalid_input');
  const gpuIds = a.gpuIds.map((gpu) => {
    // NVIDIA GPU/MIG UUID, including the legacy MIG parent/GI/CI form. Counts,
    // display names and CUDA ordinals cannot masquerade as durable identities.
    if (!gpu || typeof gpu.uuid !== 'string' || !/^(?:(?:GPU|MIG)-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|MIG-GPU-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/[0-9]+\/[0-9]+)$/.test(gpu.uuid) || !Number.isSafeInteger(gpu.ordinal) || gpu.ordinal < 0) fail('invalid_input');
    return { uuid: gpu.uuid, ordinal: gpu.ordinal };
  });
  if (new Set(gpuIds.map((g) => g.uuid)).size !== gpuIds.length || new Set(gpuIds.map((g) => g.ordinal)).size !== gpuIds.length) fail('invalid_input');
  return { operationId, reservationId, projectId, runId, authorityId, episodeId, scopeId,
    allocation: { provider: a.provider, instanceId: a.instanceId, incarnationId: a.incarnationId, accountId: a.accountId, identityStatus: 'verified', gpuIds } };
}
function record(row: Row): Reservation {
  return { ...JSON.parse(row.payload), recordKind: 'reservation', schemaVersion: 1, owner: 'reservation_coordinator', grantRevision: 1,
    revision: row.revision, state: row.state, createdAt: row.created_at, release: row.release_intent ? JSON.parse(row.release_intent) : null };
}

export class ComputeReservations {
  private readonly inhibited: Set<string>;
  constructor(private readonly db: Database.Database, private readonly history: ProjectHistory, private readonly options: ReservationOptions = {}) {
    // Existing grants never authorize an implicit Resume after utility/app
    // restart. Reconcile and release the old episode, then explicitly acquire
    // a fresh reservation. This does not revise pending release journal IDs.
    this.inhibited = new Set((db.prepare("SELECT reservation_id FROM compute_reservations WHERE state != 'released'").all() as { reservation_id: string }[]).map(r => r.reservation_id));
  }

  handle(request: ReservationRequest): ReservationReply {
    let operationId = '';
    try {
      if (!request || typeof request !== 'object') fail('invalid_input');
      id(request.operationId); operationId = request.operationId;
      switch (request.kind) {
        case 'compute.acquire':
          if (request.input?.operationId !== operationId) fail('invalid_input');
          return { ok: true, value: this.forProvider(request.input.allocation?.provider).acquire(request.input) };
        case 'compute.list': return { ok: true, value: this.list() };
        case 'compute.stopping': return { ok: true, value: this.markStopping(request.reservationId, request.expectedRevision) };
        case 'compute.assert_launchable': return { ok: true, value: this.assertLaunchable(request.reservationId, request.expectedRevision) };
        case 'compute.release': return { ok: true, value: this.release(request.reservationId, request.expectedRevision, request.releaseId) };
        default: fail('invalid_input');
      }
    } catch (error) {
      const safe = error instanceof ReservationError ? error : new ReservationError('unavailable', 'unknown');
      return { ok: false, error: { code: safe.code, origin: safe.origin, operationId, message: safe.message, effect: safe.effect, retry: safe.retry } };
    }
  }

  // Both provider integrations use the same owner and transactions. Binding the
  // provider prevents one adapter's payload from silently selecting another.
  forProvider(provider: Provider) {
    if (provider !== 'runpod' && provider !== 'vast') fail('invalid_input');
    return Object.freeze({ acquire: (input: AcquireReservation) => {
      if (input?.allocation?.provider !== provider) fail('invalid_input');
      return this.acquire(input);
    } });
  }

  acquire(input: AcquireReservation): Reservation {
    const payload = normalize(input);
    // Resolve an actual catalog-owned project, not an arbitrary history path.
    try { this.history(payload.projectId, () => {}); }
    catch { throw new ReservationError('unavailable'); }
    return this.db.transaction(() => {
      const previous = this.db.prepare('SELECT * FROM compute_reservations WHERE operation_id = ? OR reservation_id = ?').all(payload.operationId, payload.reservationId) as Row[];
      if (previous.length) {
        if (previous.length !== 1 || previous[0].payload !== JSON.stringify(payload)) fail('idempotency_conflict');
        return record(previous[0]); // Released retries never reacquire.
      }
      if (this.db.prepare("SELECT 1 FROM compute_reservations WHERE state != 'released' AND ((provider = ? AND instance_id = ?) OR run_id = ?)")
        .get(payload.allocation.provider, payload.allocation.instanceId, payload.runId)) fail('conflict');
      for (const gpu of payload.allocation.gpuIds) {
        if (this.db.prepare('SELECT 1 FROM compute_reservation_gpus WHERE provider = ? AND gpu_uuid = ? AND active = 1').get(payload.allocation.provider, gpu.uuid)) fail('conflict');
      }
      this.db.prepare("INSERT INTO compute_reservations VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'held', ?, NULL)")
        .run(payload.reservationId, payload.operationId, payload.projectId, payload.runId, payload.allocation.provider, payload.allocation.instanceId, JSON.stringify(payload), new Date().toISOString());
      for (const gpu of payload.allocation.gpuIds) this.db.prepare('INSERT INTO compute_reservation_gpus VALUES (?, ?, ?, ?, 1)').run(payload.reservationId, payload.allocation.provider, gpu.uuid, gpu.ordinal);
      return this.get(payload.reservationId);
    }).immediate();
  }

  get(reservationId: string): Reservation {
    id(reservationId);
    const row = this.db.prepare('SELECT * FROM compute_reservations WHERE reservation_id = ?').get(reservationId) as Row | undefined;
    if (!row) fail('not_found');
    return record(row);
  }

  list(): Reservation[] { return (this.db.prepare('SELECT * FROM compute_reservations ORDER BY created_at, reservation_id').all() as Row[]).map(record); }

  // Execution must recheck this gate before admitting work. A project release
  // intent is already a durable fence even if the registry write has not landed.
  assertLaunchable(reservationId: string, expectedRevision: number): Reservation {
    revision(expectedRevision);
    const current = this.get(reservationId);
    if (current.state !== 'held' || current.revision !== expectedRevision || this.inhibited.has(reservationId)) fail('conflict');
    try {
      this.history(current.projectId, (history) => {
        if (history.prepare('SELECT 1 FROM compute_release_intents WHERE reservation_id = ?').get(reservationId)) fail('conflict');
      });
    } catch (error) {
      if (error instanceof ReservationError) throw error;
      throw new ReservationError('unavailable');
    }
    return current;
  }

  markStopping(reservationId: string, expectedRevision: number): Reservation {
    revision(expectedRevision);
    return this.db.transaction(() => {
      const current = this.get(reservationId);
      if (current.state === 'stopping_unknown' && current.revision === expectedRevision + 1) return current;
      if (current.revision !== expectedRevision || current.state === 'released') fail('conflict');
      // Do not revise the identity that a committed project release intent uses.
      if (current.state === 'held') {
        this.history(current.projectId, (history) => {
          if (history.prepare('SELECT 1 FROM compute_release_intents WHERE reservation_id = ?').get(reservationId)) fail('conflict');
        });
        this.db.prepare("UPDATE compute_reservations SET state = 'stopping_unknown', revision = revision + 1 WHERE reservation_id = ?").run(reservationId);
      }
      return this.get(reservationId);
    }).immediate();
  }

  release(reservationId: string, expectedRevision: number, releaseId: string): Reservation {
    revision(expectedRevision); id(releaseId);
    const current = this.get(reservationId);
    if (current.state === 'released') {
      if (current.release?.releaseId !== releaseId || current.release.expectedRevision !== expectedRevision) fail('conflict');
      return current;
    }
    if (current.revision !== expectedRevision) fail('conflict');
    // Inhibit local admission even if proof collection/project persistence fails.
    // On restart the constructor inhibits every previously granted episode.
    this.inhibited.add(reservationId);
    try {
      // Recovery first reuses durable project evidence, including after a crash
      // before the registry write. Never require a new release/authority ID.
      const intent = this.history(current.projectId, (history) => {
        const saved = history.prepare('SELECT intent FROM compute_release_intents WHERE reservation_id = ?').get(reservationId) as { intent: string } | undefined;
        if (saved) {
          const intent = JSON.parse(saved.intent) as ReleaseIntent;
          if (intent.releaseId !== releaseId || intent.expectedRevision !== expectedRevision) fail('conflict');
          this.validateEvidence(current, intent.evidence);
          return intent;
        }
        const evidence = this.options.evidence?.inspect(structuredClone(current));
        if (!evidence) fail('unavailable');
        const intent: ReleaseIntent = { releaseId, expectedRevision, evidence: this.validateEvidence(current, evidence) };
        this.options.checkpoint?.('before_project_intent');
        history.prepare('INSERT INTO compute_release_intents VALUES (?, ?, ?, ?)').run(reservationId, releaseId, current.projectId, JSON.stringify(intent));
        return intent;
      });
      this.options.checkpoint?.('project_intent');
      this.options.checkpoint?.('before_global_release');
      this.db.transaction(() => {
        const latest = this.get(reservationId);
        if (latest.state === 'released' && JSON.stringify(latest.release) === JSON.stringify(intent)) return;
        if (latest.revision !== expectedRevision || latest.state === 'released') fail('conflict');
        this.db.prepare("UPDATE compute_reservations SET state = 'released', revision = revision + 1, release_intent = ? WHERE reservation_id = ?")
          .run(JSON.stringify(intent), reservationId);
        this.db.prepare('UPDATE compute_reservation_gpus SET active = 0 WHERE reservation_id = ?').run(reservationId);
      }).immediate();
      this.options.checkpoint?.('global_release');
      return this.get(reservationId);
    } catch (error) {
      if (error instanceof ReservationError) throw error;
      // Never include vendor/SQL/filesystem exception contents in the port.
      throw new ReservationError('unavailable', 'unknown');
    }
  }

  private validateEvidence(r: Reservation, e: ReleaseEvidence): ReleaseEvidence {
    if (!e || e.schemaVersion !== 1 || e.grantRevision !== 1) fail('unavailable');
    id(e.evidenceId);
    for (const key of ['reservationId', 'projectId', 'runId', 'authorityId', 'episodeId', 'scopeId'] as const) if (e[key] !== r[key]) fail('unavailable');
    for (const key of ['provider', 'instanceId', 'incarnationId'] as const) if (e[key] !== r.allocation[key]) fail('unavailable');
    if (e.futureLaunches !== 'fenced' || e.mutationAuthority !== 'disabled' || e.receipts !== 'settled' ||
      !['stopped', 'absent'].includes(e.localAgents) || !['stopped', 'absent'].includes(e.localHelpers) || !Array.isArray(e.attemptIds)) fail('unavailable');
    e.attemptIds.forEach(id);
    if (new Set(e.attemptIds).size !== e.attemptIds.length) fail('invalid_input');
    if (e.remote?.kind === 'scope') {
      if (e.remote.coverage !== 'all_application_work' || !['stopped', 'absent'].includes(e.remote.workers)) fail('unavailable');
    } else if (e.remote?.kind !== 'destroyed' || e.remote.source !== 'authoritative_incarnation_destruction' || e.remote.irreversible !== true) fail('unavailable');
    // Explicit projection: unexpected vendor bodies/credentials never persist.
    return { evidenceId: e.evidenceId, schemaVersion: 1, grantRevision: 1,
      reservationId: r.reservationId, projectId: r.projectId, runId: r.runId, authorityId: r.authorityId, episodeId: r.episodeId, scopeId: r.scopeId,
      provider: r.allocation.provider, instanceId: r.allocation.instanceId, incarnationId: r.allocation.incarnationId,
      futureLaunches: 'fenced', mutationAuthority: 'disabled', receipts: 'settled', localAgents: e.localAgents, localHelpers: e.localHelpers,
      remote: e.remote.kind === 'scope' ? { kind: 'scope', coverage: 'all_application_work', workers: e.remote.workers }
        : { kind: 'destroyed', source: 'authoritative_incarnation_destruction', irreversible: true }, attemptIds: [...e.attemptIds] };
  }
}
