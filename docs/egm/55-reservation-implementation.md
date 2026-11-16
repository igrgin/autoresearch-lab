# #55 implementation and qualification

This records implementation evidence, not an approved design specification.
Scope follows [the concepts brief](../designs/concepts_brief.md),
[#55](https://github.com/igrgin/autoresearch-lab/issues/55), the four final
[#16 decisions](https://github.com/igrgin/autoresearch-lab/issues/16#issuecomment-6866989482),
and [#73 release/recovery policy](https://github.com/igrgin/autoresearch-lab/issues/73#issuecomment-6867908218)
including its later regression clarification. No provider lifecycle operation is added.

## Delivered boundary

- [ProjectCatalog](../../src/catalog/catalog.ts) constructs the shared reservation
  owner on its existing registry connection. It resolves project histories from
  verified catalog identities. There is no caller-supplied database path.
- [ComputeReservations](../../src/compute/reservations.ts) uses `BEGIN IMMEDIATE`
  and database uniqueness constraints for active provider/instance, provider/GPU
  and run identities. Credential/account aliases and instance incarnation changes
  cannot create another namespace for the same instance. Disjoint GPU subsets
  still conflict; distinct instances with distinct devices can run concurrently.
- [Contracts](../../src/compute/contracts.ts) record actual ordered GPU UUIDs and
  observed ordinals, immutable grant/authority/episode/scope identities, mutable
  revision and independent held/stopping-unknown/released status. Runpod uses Pod
  ID; Vast uses canonical numeric contract ID. Unknown identity blocks acquisition.
- Both provider bindings use the same owner. The utility's internal `compute.*`
  port dispatches acquisition through those bindings. Ordinary main/preload
  renderer APIs gain no reservation mutation or proof-submission method.
- Execution must check `assertLaunchable` immediately before work admission,
  together with its own remote authority fence. Existing grants recovered by a
  new owner cannot authorize implicit Resume. Stop remains available; a new
  execution episode requires reconciliation/release and fresh acquisition.

## Release and recovery

The trusted `ReservationEvidenceSource` must attest the matching reservation,
project/run, authority episode, sealed process scope, provider/instance and old
execution incarnation. It must cover local agents/helpers, all remote ranks and
helpers, disabled mutation/future-launch authority and settled receipts. It may
instead attest irreversible authoritative destruction of the old incarnation,
while still proving local quiescence and fences. An inert read-only supervisor
is compatible with the disabled-authority proof.

The reservation owner validates and projects that evidence; a renderer or vendor
observation cannot submit it. Cancellation acknowledgment, parent exit, low load,
timeout, missing list entry, revoked access and restartable stopped containers
have no release conversion. Acceptance status is not an input: stopped work can
release with acceptance pending, but this owner does not authorize Resume or
settle that decision.

Release first commits the project quiescence/release intent, then atomically
marks the global instance and GPU reservations released. The intent itself
fences launch admission. A release attempt also inhibits local admission before
proof collection, including when project persistence fails. Failed writes/SIGKILL retain conservative ownership;
reconciliation retries the same release, grant and authority identities, using
the committed project proof even if its original collector is unavailable.
Missing project history blocks release. Released acquisition retries return
their old released record rather than silently reacquiring.

Schema v2 upgrades preserve v1 rows and Git bindings. SQLite takes a consistent
pre-upgrade backup including WAL data, syncs its file and directory, then applies
checksummed migrations in one transaction and validates SQLite integrity/foreign
keys before commit. Unknown versions/checksums fail without reset. See
[storage/rollback guidance](../BUILD.md).

## Validation and review

On macOS arm64 with Node 24.22.3, Electron 45.3.2 and embedded SQLite 3.54.1,
`npm run check` passed typecheck, lint, 38 catalog/reservation tests and 47
security tests (85 total; no failures or skips).
`npm run make` passed and produced the unsigned macOS arm64 application/ZIP.
`npm run smoke` passed, including `computeReservationPortAndRestart` and all
existing packaged UI/isolation/storage checks. `git diff --check` passed.
Final live rechecks found #55 open/assigned to `igrgin`, both native blockers
closed, and unchanged #16/#17/#19/#73 bodies/comments and provider amendments.

`npm run check` runs the [reservation suite](../../tests/reservations.test.ts)
through the existing Electron/native-SQLite test runner, alongside catalog and
security suites. Cases include independent-process acquisition races for both
providers, disjoint GPU conflicts, separate-instance success, duplicate/altered
identity retries, restart with unknown stopping, rejected partial/mismatched
proofs, acceptance-pending release, authoritative destruction, four SIGKILL
release boundaries, actual SQLite aborts of either release write, rollback of
the combined global/GPU transaction, missing project history and v1 migrations.

The [packaged smoke extension](../../scripts/reservation-smoke.mjs) exercises the
actual built utility's internal message port for both providers: acquire,
cross-project/alias conflict, stopping uncertainty, no-proof release rejection,
and process restart retaining both reservations. It uses a separate synthetic
profile and the existing smoke runner.

Self-review checked uniqueness keys, parameterized SQL, allowlisted projections,
expected-revision/idempotency behavior, launch fencing, release ordering,
transaction rollback, restart recovery, project-path validation and test-runner
integration. Archived review inputs and source captures are unchanged.

Qualification limits: there are no provider or execution adapters in this base
checkout. The production evidence source defaults to unknown, so unqualified
release fails closed. Provider assignment owners must use the shared internal
port; execution/lifecycle owners must supply truthful, durably fenced all-scope
proof and enforce remote admission. Synthetic attestations do not prove live GPU
termination, containment, provider access or power-loss/disk-full safety. No host
credentials, subscriptions, remote work or paid resources were used.

Integration overlap: `src/catalog/catalog.ts` (constructor/history access),
`src/catalog/storage.ts` (`openStore` optional migration sequence),
`src/coordinator.ts` (internal request union), test runner/webpack entries and
`scripts/smoke.mjs`. New public internal contracts live under `src/compute/`.
