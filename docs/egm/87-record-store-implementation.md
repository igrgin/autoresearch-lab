# #87 implementation and verification record

This implementation follows the live [#87 requirements](https://github.com/igrgin/autoresearch-lab/issues/87), [#86 retention decision](https://github.com/igrgin/autoresearch-lab/issues/86#issuecomment-6859457307), the four final #16 decisions, #17/#21 safe admission, and both #54/#73 decisions and their recovery amendments. It does not publish a new design decision.

## Delivered boundary

- [Contracts](../../src/research/contracts.ts) distinguish immutable configuration, prepared inputs, candidates, attempts, execution outcomes, final validation, metric samples, user-only assessments, acceptance revisions, owner-supplied counter snapshots, hardware, actions, controls, artifacts, activity and collection gaps. Full tested commit/tree identities and comparator/base references are retained. Rejected, failed, interrupted and pending records do not become interchangeable outcomes.
- [ResearchStore](../../src/research/store.ts) uses a project-bound `.lab/research.sqlite` alongside the existing catalog identity database. The existing identity schema is unchanged. The new store has an independent checksummed initial schema, WAL/FULL durability, private file permissions, an identity marker that blocks recreation of a lost database, and rejection of unknown schemas/project bindings and linked database files. Future migrations need the existing backup/migration workflow.
- [ProjectCatalog.research](../../src/catalog/catalog.ts) resolves and revalidates the registered project; callers cannot choose a storage path. Catalog shutdown closes its research handles. [The coordinator](../../src/coordinator.ts) handles private `channel: research` requests via [handleResearch](../../src/research/host.ts); it remains the physical writer. Logical owners receive `bind(owner).ingest(event)` ports from trusted host wiring. These ports are not renderer/agent authentication credentials. No renderer write route is added.
- Main's existing credential service supplies memory-only safe admission and current-policy rechecks through a private utility-process round trip. Matching material stays in main. SafeRecording's file capture and the new memory admission share the same filter and incident fences; research ingestion does not create a second unbounded file replica. Unknown/unsupported evidence remains inspectable and cannot advance acceptance.

## Ingestion and reads

Event insertion, source conflicts, projections, detail eviction/gaps and contiguous replay cursors commit in one transaction before acknowledgment. Duplicate sanitized source content retains its original ingestion ordinal. Changed event/stream positions, conflicting record revisions, multiple terminal outcomes, selection forks, causal gaps and incompatible evidence remain explicit. Projections are rebuilt from source evidence without a timestamp winner. Newly discovered conflicting evidence withdraws dependent projections while preserving the earlier source decisions. There is no remote process creation or exactly-once execution claim.

Streams start at sequence zero and preserve their identity across replay; a new stream starts at zero. `causedBy` names source-event prerequisites. Owners must include relevant causal receipts and keep stream sequencing project-scoped. Missing references/causes remain pending until their original facts arrive. Mutable revisions require the previous revision; decision resolution preserves the original identity, comparator, policy and tested result. The store consumes protected evaluator declarations and owner-supplied stopping-counter snapshots; it does not implement ranking or increment counters from callbacks.

`inspect(runId)` identifies its snapshot by the greatest retained ingestion ordinal and returns safe source facts, current projections, original receipt times, gaps, retained detail and retrieval history. `agentValidation(runId)` is a deliberately narrow typed validation-only projection; raw settings, transcripts, errors, generic summaries and assessments never enter it. The context owner must still authorize its run scope and construct other task/code/constraint/acceptance context through #21/#66. Any reconciliation/capture/quarantine blocker suppresses this projection. History screens and chart aggregation remain #88–#90 work.

All #86 v1 limits are saved with the run: sanitized bodies keep 32 KiB head + 32 KiB tail; buckets keep 4 MiB head + latest 12 MiB; run-wide detail is capped at 256 MiB with oldest-ingestion eviction; the verbose ingress queue holds at most 4 MiB per run. UTF-8 boundaries are preserved. Compact event envelopes and structured samples/decisions survive eviction. Previews can be derived from retained detail without storing an extra uncharged copy. Queue overflow omits incoming detail and records a gap; later sanitized retrieval retains the same envelope and the earlier collection failure. Omission byte counts are explicit or unknown. There is no time-based expiry or eviction across runs. Upstream collectors still need bounded readers before this port; this store is not a remote collector or spool implementation.

A failed essential transaction rolls back all visible effects, reports a safe fault and inhibits new work. When possible, it persists an unknown-range capture fault outside the failed transaction. `recoverCapture` requires an explicit, evidence-linked owner attestation of boundary repair, reconciled effects and authorized Resume; it records recovery before clearing the fault. It neither launches work nor clears security incidents or unresolved source conflicts. If fault persistence itself fails, the current in-memory fault remains visible; this cannot prove an exact lost-byte count after a hardware failure.

## Verification and limits

The normal `npm test` path includes [research acceptance/failure tests](../../tests/research.test.ts), using Electron's actual native SQLite payload. Tests cover outcome distinctions, pending-decision recovery, duplicate events/decisions/counters, immutable reference failures, causal and sequence gaps, conflicting terminal evidence, superseded controls, preparation without an attempt, synthetic secrets in SQLite/WAL/detail, assessment exclusion, quarantine and unsupported evidence, queue overflow/retrieval, retention boundaries and storage failure/recovery.

A real child process receives SIGKILL before event insertion, after event insertion, after projection, after cursor update and after commit before acknowledgment. Reopening/replaying proves transactional rollback or one committed effect. Near-quota detail fixtures seed an already-admitted replica before exercising real bucket/run eviction; they are not throughput benchmarks. A long-body test also exposed a quadratic URL-redaction scan; URL userinfo now uses a bounded scheme/authority scan that also accepts adjacent diff markers and punctuation. The long punctuation-bearing activity regression remains covered.

Final validation results are recorded in the PR. Packaged make/smoke qualify native loading and the existing shell/catalog/security routes. There is no live provider, credential, model, training, remote supervision, process-containment, power-loss or physical disk-full proof. No provider resource was provisioned or changed. Large-history projection rebuild throughput and paginated history/detail reads need qualification with history consumers; the current implementation favors a replayable complete snapshot over an incremental projection cache. SQLite free pages/WAL and external backups are not claimed forensically erased by quarantine.

Shared integration files touched: `src/catalog/catalog.ts`, `src/coordinator.ts`, `src/main.ts`, `src/security/recording.ts`, `src/security/sanitizer.ts`, `scripts/test.mjs`, and `webpack.tests.config.cjs`. Existing catalog request/reply contracts and security capture methods stay compatible. New research types and ports live under `src/research/`; no package or lockfile changes are required.
# Goldfish correction

An unchanged activity replay whose detail is locally omitted now reconciles to
its existing producer event and receipt ordinal. Queue pressure cannot turn the
replica's detail availability into contradictory producer evidence. Existing
admitted detail and projections are retained; different available detail still
creates an identity conflict. Regression cases exercise both immediate and
post-restart replay, later same-stream events, and validation-context continuity.

Round2 repairs retain the safely admitted complete original fact under the unsupported wrapper, including its original identity/schema and evidence. Exact replay deduplicates; a changed unknown payload under one event ID remains an explicit conflict and never projects as understood state. URL-userinfo regressions cover diff prefixes and inspect/SQLite bytes as well as long-body filtering.

Older unsupported records whose payload was already discarded cannot be reconstructed locally. A newly delivered original payload is retained as distinct source evidence and can expose the previous identity conflict; no old event is silently overwritten.

## Round-4 admission and replay correction

[Round-4 repair evidence](repairs/2026-11-16-pr115-r4/repair.md) records the original
failures and bounded implementation repair. Research writes now use
`withMatchingPolicy` around all event/detail admission and the complete SQLite
transaction. The private main/utility port holds the existing sanitizer authority
until the utility writer settles or actually exits; a caller timeout or missing
reply does not release a possible late write. Leased admission uses the already
initialized authority rather than queuing a reload behind a waiting credential
replacement. The generic matching primitive is unchanged.

Research schema v2 appends `capture_failures`. Its fixed, validated references,
unknown byte counts, collection times/count and recovery link describe replica
collection, independently of immutable producer events. Failed admission does not
invent a producer fact or advance its stream cursor. A capture-failure receipt has
`captureFailed: true`, `status: pending`, `reason: capture_unavailable`, and a null
ordinal when no source exists; an existing ordinal is a reference, not proof of
replay equivalence. A later successfully admitted, applied replay records recovery
without erasing the earlier fault. Required fixed control/outcome receipts remain
available during capture fences. Boundary recovery still needs explicit owner
attestation; verbose capture faults never become execution outcomes.

The standard checksummed upgrade makes a consistent
`research.sqlite.before-v2-<uuid>.sqlite` backup before upgrading an existing v1
store, retains v1 source bytes/checksum, and rejects unknown future schemas.
Downgrade requires restoring that backup with the app stopped. Already-recorded
source conflicts from earlier builds remain evidence requiring reconciliation;
this migration does not silently rewrite them. The npm test command gains a real
Electron main/utility regression with controlled credentials; dependencies and the
lockfile are unchanged. This correction changes no renderer flow.
