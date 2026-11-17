# Issue 60 implementation and review evidence

Scope: [#60](https://github.com/igrgin/autoresearch-lab/issues/60), consuming the complete live decisions and amendments in #16, #17, #54, #67 and #73. This is implementation evidence and an adapter handoff, not a new design specification. Archived inputs remain unchanged.

## Delivered ports

- [ExecutionBounds](../../../src/execution/bounds.ts) validates and snapshots finite policies, boot identity, original phase and validation-call deadlines, an outer attempt deadline, an optional earlier recovery parent deadline, and the inclusive training interval. Retrying/re-entering the same phase or validation call does not renew its deadline. Restore preserves the deadlines and fails closed on unsupported/corrupt records or changed clock identity.
- [ExecutionGuardian](../../../src/execution/guardian.ts) independently enforces those deadlines, seals authority, requests phase cancellation, escalates against the owned subtree, and distinguishes observable emptiness from unknown stopping. It emits execution-safeguard facts; it never evaluates acceptance, changes research counters, releases a reservation or invokes provider lifecycle operations.
- [The private supervisor client](../../../src/execution/client.ts) starts a detached guardian with an explicit credential-free environment, waits for durable readiness and correlated phase/control receipts, and keeps controller renewal separate from supervisor health. Lost replies have unknown effects; there is no automatic resend/replacement. Bounded pending requests prevent an unbounded client queue.
- [The guardian entrypoint](../../../src/execution/guardian-process.ts) is included as `execution-guardian.cjs` in the webpack build. It runs on Linux with Node 24 and independently checks the boot clock and real cgroup v2 filesystem. Its [cgroup port](../../../src/execution/cgroup.ts) pins the directory inode, kills only the bound subtree, and confirms the complete subtree through `cgroup.events populated=0`. No PID-file/process-group/bare-SSH fallback exists.
- [The private guardian journal](../../../src/execution/journal.ts) atomically publishes minimal structured identities, bounds and stop facts, with file and directory sync. An exclusive durable bootstrap lock rejects duplicate guardians. A stale lock requires owner reconciliation, not PID-based takeover. Restarted guardian logic fences original authority and preserves the original escalation deadline.

## Resolved profile

`defaultBoundPolicy(configuredTrainingMs)` leaves the selected training duration unchanged. It resolves preparation to 30 minutes, agent/repair actions to 15 minutes each, tools and periodic validation to 5 minutes each, final evaluation to 15 minutes, publication to 2 minutes, cleanup to 30 seconds and transfer to 30 minutes. Compilation/training share the configured inclusive training interval. The outer attempt limit is training duration plus 120 minutes, supervisor liveness is 15 seconds, and cancellation escalation is 10 seconds (first half for graceful cancellation, then whole-subtree kill).

These are per-operation execution safeguards. There is no mandatory total run-time ceiling, stopping-expression condition or provider lifecycle change. Missing, nonpositive, nonfinite or unsupported values block arming. Callers persist the resolved profile before dispatch. #67's owner persists the two-retry/two-repair recovery episode and passes its **original** parent deadline to every affected action/attempt; this module does not create/reset recovery episodes or own retry counters.

Training cutoff fences optimization/checkpoint authority and stops only the nested training scope. Final evaluation can then use already sealed eligible checkpoints, within its own deadline and the original outer/parent limit. A missing required endpoint or invalid checkpoint remains the execution/evaluation owners' failure, never a successful result inferred from timer expiry. Publication/cleanup expiry preserves any result already committed by its owner. Pause and Finish latch a drain and deny new preparation/exploration/repair; their existing attempt and finalization limits remain unchanged. Controller-contact expiry latches automatic pause; only an already admitted attempt may drain. Fresh sequenced 5-second challenges cannot renew contact after its 30-second expiry or extend any work deadline.

## Required launcher integration

The scope port is a trusted integration boundary, not a sandbox implementation. Before arming, the #54 execution launcher must qualify and create its delegated cgroup, namespace/device/credential restrictions, protected journal directory and closed work gates. The guardian must remain outside the work subtree. A separate nested cgroup contains **all** training ranks, loaders, compiler helpers and training/checkpoint workers; evaluation/finalization workers remain inside the outer scope. Gate opening must wait for the appropriate guardian receipt.

Every launch/mutation/checkpoint gate must honor the irreversible operation/training fence; no process may be added after sealing. The trusted launcher must qualify the namespace-init parent-death path so guardian death cannot orphan work, and the race between parent-death arming and opening the gate. Neither a writable fence file nor the presence of cgroup support proves namespace isolation or this fail-closed path. The remote gateway owns authenticated admission, terminal/cancel arbitration, instance-local locking, immutable input qualification and journal reconciliation; this primitive does not replace those owners. Local registry/project writes remain in the existing utility coordinator.

A macOS agent route must supply its own qualified `OwnedScope`. This PR deliberately rejects the Linux backend on macOS and does not enable local agents or an uncontained command route. There is no run/provider/agent workflow to wire in the starting checkout; these ports are available to those dependent implementations. Reservation owners consume a persisted sealed/empty receipt with matching operation, run, scope, boot and incarnation. They must settle launch/cancel facts and perform their own durable release sequence. `quiescence_evidence_available` is not a reservation-release command or proof that acceptance/history is settled.

## Verification and limits

The normal `npm test` command includes [the execution suite](../../../scripts/test-execution.mjs). It exercises each hung phase, inclusive timing, phase retries/progress/restart near parent expiry, fixed recovery-parent positions, clock changes, stale/replayed contact, Pause/Finish drain, late wakeup, persistence failure, unobservable exit, restart during escalation and client receipt correlation. Independent-process tests hang/exit a supervisor during evaluation/publication/cleanup, terminate a controlled root plus detached child and grandchild, and keep an unrelated process alive. Additional real hanging fixture work runs in every phase.

The controlled test launcher tracks its synthetic descendants before opening work and admits no further processes. It is test-only, outside production imports. These tests prove independent watchdog/process behavior for those controlled fixtures; they do **not** qualify arbitrary daemon containment, Linux cgroup/namespaces on a rental, hung CUDA/NCCL, macOS sandboxing, guardian-death cleanup, authenticated controller transport or real provider/agent credentials. No live service, host subscription, paid resource or provider lifecycle was used. The production backend refuses unsupported containment; actual routes must remain unavailable until their launcher qualification succeeds. Uninterruptible kernel/device work can still prevent observable exit; the guardian retains unknown state and the reservation requirement.

Self-review focuses: finite children and immutable parents; cutoff versus finalization; sealed all-participant stop proof; no false pause/release/outcome; no retry/progress/renewal resurrection; durable bootstrap/fences and fail-closed storage; credential-free process environment and minimal structured diagnostics; compatible record ownership. Only shared glue changes are the `package.json` test command and `webpack.main.config.cjs` entry map. No DB migration, credential API, renderer or provider adapter is changed.

Final local validation on 2026-11-16 used Node 24.22.3 and Electron 45.3.2: `npm run check` passed typecheck, lint and 111 tests (17 catalog, 47 security, 47 execution); `npm run make` produced the arm64 application/ZIP including the guardian entrypoint; `npm run smoke` passed the packaged shell/SQLite/security/project recovery/native-close checks. Smoke is a shell regression check, not live remote execution qualification. `git diff --check` passed. The final live re-read found #60 open/assigned to `igrgin`, all three native blockers closed and all seven issue bodies/comment sets unchanged. No other issue is closed by this change. Self-review found no remaining implementation defect within the primitive scope; the platform/launcher qualification limits above remain explicit.

## PR112 repair evidence — 2026-11-16

The earlier self-review conclusion above was superseded by verified findings PR112-F01 and PR112-F02. Both were reproduced before production edits on the prepared combined source `c3404b0259e9502b779ae954e2ccdb057eb8c88e`. With Node 24.22.3, `node --test --test-name-pattern='PR112-F0' scripts/test-execution.mjs` ran two tests and failed both: the second distinct validation at 420000 expired against 360000, and restored training cancellation at 119 did not perform the overdue training kill. The original archived reviews and parent reproduction artifacts remain unchanged.

Periodic validation now requires `phase('periodic_validation', validationCallId)` (or `enter(phase, now, validationCallId)` at the bounds port), with a canonical lowercase UUID assigned by the trusted driver. The driver must durably bind that ID to one validation call before dispatch and reuse it for retries/reconciliation. Guardian/client/private phase messages carry it unchanged. A new transport request ID, heartbeat, phase transition or reconnect cannot create a validation-call identity. Other phases reject the extra ID and retain their original cached phase deadlines. This is a trusted driver interface, not authority for candidate code to declare new calls.

The guardian records each call's original start/deadline and the active call ID. Distinct calls get finite per-call deadlines capped by the original inclusive training, attempt and recovery-parent deadlines. The regression sequence trains at 0, validates at 60000 (deadline 360000), returns to training at 120000, and admits a distinct validation at 420000 (deadline 720000), retaining training deadline 1800000. Same-call retry/reentry/restore retains 360000. Replaying that expired call fences the operation; a different ID cannot bypass an already expired active call. Missing/malformed/misplaced IDs, unknown phase-message fields and corrupt call state are rejected.

Compatibility consequence: the private **bounds snapshot format is version 2**. Version 1 snapshots are rejected for explicit owner reconciliation; call identity cannot be inferred safely from their phase cache. The journal envelope and guardian-record versions remain 1, containing a versioned bounds snapshot; there is no project/registry database migration or automatic history rewrite. Client readiness requires bounds version 2, and old callers without validation-call identity cannot admit validation through the new host. Deploy matching client/guardian bundles only after old scopes are reconciled and quiescent; preserve legacy source evidence and never replace an active guardian to upgrade it. All existing in-repository callers were adapted; the future #56/#57/#59/#77/#78 workflow remains separate. Call records are retained for the operation rather than pruned into replay ambiguity. If the existing 64 KiB journal capacity is exhausted, publication fails before replacing the last readable record, fences work and retains uncertainty/reservation requirements; it does not silently drop IDs or admit unrecorded work.

Recovery now enforces an unfinished nested training cutoff even after whole-scope authority is fenced. Training deadline 100 with cancellation interval 20 retains kill time 110 and cancellation deadline 120. Restore at 119 immediately issues the overdue training and whole-scope kills and retains 120; restore at 121 remains unknown/retain without exit proof. Whole-scope recovery termination is capped by the original training escalation, and is durably recorded before recovery observes training emptiness, so a second crash cannot renew the interval. If the crash preceded the cutoff receipt, recovery first enforces the already-due original training deadline. An expired parent/attempt cap is also enforced while training is draining. Corrupt or extended cutoff receipts are rejected. Restart tests use the real private journal, populated scopes whose kill callbacks supply no exit proof, another restart after expiry, late training-only emptiness (reservation retained), and finally trusted whole-scope emptiness. Timers and kill acknowledgments never imply stopped work or authorize reservation release.

Repair validation and limits: with Node 24.22.3, `node scripts/test-execution.mjs` passes 57 tests (47 existing plus 10 added). `npm run check` passes typecheck, lint and all 299 tests (184 domain, 56 security, 2 native SDK and 57 execution); `git diff --check` passes. Tests include private client/host correlation and durable call identities, malformed raw phase messages, replay/fencing, training/attempt/parent caps, persisted restart/escalation and journal-capacity failure. No live provider/GPU effects or new platform-containment qualification were performed. Parent owns final combined packaging/native smoke and fresh review; this implementation worker did not run an independent reviewer or publish GitHub decisions/comments.

If recovery precedes the training-cutoff receipt, the original training-derived cancellation cap is installed before global fencing/persistence and before observing nested emptiness. Thus already-empty training cannot save an armed intermediate record or renew outer-scope cancellation. Regression covers restore at119/121 and another restart from the first recovery write, retaining deadline120 and unknown/reservation until whole-scope emptiness.

## Round3: semantic journal binding and restored cancellation validation

Parent regressions reproduced order-sensitive rejection of identical journal
identities and acceptance of a cancellation deadline changed from20 to2000.
Journal reads now compare validated identity objects semantically, preserving
changed/missing/extra-field rejection without treating property insertion order
as authority. Restored whole-scope deadlines must remain within their immutable
receipt/policy maximum and applicable training/recovery caps. Inconsistent evidence
requires owner reconciliation; it cannot renew escalation authority.

Both new regressions and all60 execution tests passed. Full parent check passed
328 tests with typecheck/lint and no failures/skips. Existing unchanged-deadline,
missing-cutoff and repeated-restart cases remain covered. Packaging and native
combined validation remain with the coordinator after other repairs; actual remote
GPU/containment and power-loss behavior remain unqualified.

## Round 4 late-wakeup arbitration

Twelve controlled regressions failed before repair: compilation, training and
periodic validation, each interrupted by a late tick, supervisor-loss callback,
Stop or contact-expiry callback. At elapsed 16000 with training limit 1000 and
cancellation limit 10000, the previous guardian granted a fresh later window.
Whole-scope termination now caps cancellation by the original charged training
clock even if a later global receipt was installed before a nested cutoff.
All 72 execution tests pass after repair. The new cases assert immediate kill,
unknown/retained reservation until observed whole-scope emptiness, and no deadline
after 11000. Existing restored-cutoff and finalization tests remain passing.
This is deterministic-clock and controlled-process qualification, not live GPU
or Linux rental containment proof. Combined validation and fresh review remain
pending for this correction.
