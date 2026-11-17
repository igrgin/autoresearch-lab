# Issue 62 implementation and review evidence

This is an implementation record, not a new design specification. The behavior
comes from the complete current decisions on [#61](https://github.com/igrgin/autoresearch-lab/issues/61#issuecomment-6867877187),
[#92](https://github.com/igrgin/autoresearch-lab/issues/92#issuecomment-6913117701),
[#16](https://github.com/igrgin/autoresearch-lab/issues/16), and
[#17](https://github.com/igrgin/autoresearch-lab/issues/17#issuecomment-6867871329).

## Delivered boundary

[CheckpointSelection](../../src/evaluation/checkpoints.ts) is an attempt-scoped,
synchronous service for the single-writer coordinator/protected evaluator. Its
versioned [records](../../src/evaluation/contracts.ts) join the attempt, immutable
run inputs, tested commit, model/initializer/processing/software references,
checkpoint digest/sequence, and protected validation evaluation/result identities.
The service writes its private attempt artifact directory, not registry or project
databases. No renderer filesystem or evaluation authority is added.

The host creates this directory outside candidate access, supplies frozen resolved
inputs and a trusted model adapter's required `verifyLoadable` operation, then:

1. `saveSnapshot` copies all expected state shards, checks size/digest, loads the
   saved weights and buffers through that adapter, synchronizes files and publishes
   the snapshot/sequence before evaluation. The source paths are trusted host
   inputs; they are never persisted or returned in research records.
2. `recordValidation` admits a completed protected validation record, rechecks the
   saved artifact, and atomically publishes the result. Ranking uses only eligible
   checkpoints: unrounded constraints, primary then configured secondaries, exact
   binary64/decimal half-even keys, earliest snapshot sequence on a complete tie.
   Identical artifact/result replay is idempotent; conflicting identities fail.
3. `completeAttempt` supplies completed trusted attempt-wide measurements. Unknown
   evidence cannot pass, and a failure disqualifies all checkpoints. `finish`
   requires completed evaluations/evidence and seals selection.
4. `finalEvaluationInput` returns the exact verified saved package, pinned inputs
   and selection result ID for a distinct final evaluator invocation, or `null`
   for `no_eligible_checkpoint`. It publishes neither final validation nor an
   experiment acceptance/target decision.

The current application's shell has no training-dispatch or final-evaluator
entrypoint yet. This change implements their checkpoint persistence/selection port
and exercises its full saved-file/result handoff; it does not add fake training UI
or claim a trainer is connected. Actual protected snapshot production belongs to
execution, and post-training re-evaluation/acceptance remain their own issues.

## Persistence and failure review

Checksummed, versioned selection state is published by file sync, atomic rename,
and directory sync. Replacement copying budgets two replacement copies plus a
reserve against currently free space; the previous model remains allocated.
Every selected package is checked again before use. Failed copying or publication
does not remove the previous artifact. Unpublished partial files remain orphaned
and cannot participate in selection. A failed state publication fences that
writer until reopen/reconciliation. A context/identity conflict durably invalidates
the attempt. Missing/corrupt selected bytes report an integrity error without
silently selecting another score. Historical result records are preserved.

There is no automatic artifact deletion here. Cross-run dependencies, selected
run-model replacement, remote retrieval, and retention cleanup remain with the
artifact owner under #92. This service requires exclusive coordinator ownership;
it is not a multi-process locking or remote authority/fencing protocol. Checksums
detect accidental corruption; they do not authenticate a hostile trusted host.

Selection records accept only typed IDs, numeric evidence and validation metrics
from the frozen registry. Test phases, extra assessment fields, unknown metrics,
and test-dependent constraint types are rejected. Existing security context
projection tests also exercise rejection of assessments, test splits and mixed
validation/test bodies. Sanitization/isolation of model bytes, actual evaluator
provenance, exact evaluation-unit coverage, and candidate filesystem denial remain
the trusted execution/preparation owners' obligations.

## Acceptance and self-review

[The acceptance/failure suite](../../tests/checkpoints.test.ts) is included in
`npm test` and therefore `npm run check` through the existing Electron test runner.
It covers an ineligible checkpoint with better primary score, ordered secondaries,
complete ties arriving out of order, exact half-even and hard-threshold boundaries,
large integer constraints, invalid/non-finite/missing/incomplete evidence, no
eligible model, attempt-wide constraints, mutable source state, exact saved shards
and buffers, idempotency/conflicts, restart, corruption, partial writes, failed
copy/publication, low space, symlinks, identity fencing, and test exclusion.

Self-review traced replacement before and after manifest publication and caught a
gap between snapshot capture and result publication. Result admission now verifies
the stored package again before changing selection; a regression test corrupts a
replacement during that gap and confirms the prior durable selection survives.
The review also checked that final evaluation remains required and that no
acceptance, target or provider lifecycle effect is manufactured.

Validation uses controlled JSON model-state fixtures and a model-load adapter;
it is not PyTorch, GPU, remote transport, power-loss, hostile-process isolation,
or live-service qualification. No product credentials or subscriptions were used.

Shared integration changes are limited to `scripts/test.mjs` and
`webpack.tests.config.cjs`, which add the checkpoint suite. New consumer interfaces
are `SelectionInputs`, `Snapshot`, `ValidationResult`, `AttemptEvidence`,
`CheckpointHost.verifyLoadable`, `Selection`, and `finalEvaluationInput`.

## Final validation on 2026-11-16

- Node 24.22.3 and npm 10.9.0; `npm ci` completed with no lockfile changes.
- `npm run check`: typecheck and lint passed; 23 checkpoint, 17 catalog and 47
  security tests passed (87 total, zero failures/skips).
- `npm run make`: macOS arm64 package and ZIP completed successfully.
- `unzip -tq` on the generated ZIP: no compressed-data errors.
- `npm run smoke`: all packaged checks passed, including native launch, navigation,
  renderer isolation, close/reopen/quit, persisted projects/recovery, credential
  entry/Keychain isolation and the coordinator's SQLite 3.54.1. These are shell
  regression checks, not a training smoke test.
- `git diff --check`: passed. Final self-review covered ordering, artifact identity,
  result publication, error/restart behavior, test exclusion and consumer handoff.
- Live issue/prerequisite bodies and all comments were retrieved again. #61, #92,
  #16 and #17 were unchanged from the fully read decisions; #62 remained open,
  assigned to `igrgin`, with both native blockers closed and no new comments.

Goldfish repairs preserve exact durable replays after finish/reopen: saved artifacts, immutable validation results and completed attempt evidence return the existing selection without advancing its revision. New or altered submissions remain rejected, and invalidated/fenced state and saved-artifact integrity remain enforced. Reopening compares validated immutable inputs structurally, ignoring object property insertion order while preserving array/ranking order and every actual identity/policy value. Regression tests exercise replay after trainer-source deletion, changed/new payload rejection, corrupted saved bytes and reconstructed nested input objects.

## Round 4 replay correction

An identical completed-attempt replay still reverified every eligible package,
including a losing checkpoint that had subsequently disappeared or become
corrupt. Two new regressions reproduced that failure before repair. Replay now
compares the persisted evidence and returns the existing selection, verifying
only the chosen artifact through the normal selection path. Initial completion
still verifies all newly eligible packages before publishing its evidence.
Changed evidence, existing fences and missing/corrupt selected weights still
fail; replay leaves selection bytes and revision unchanged after reopen.

All 27 checkpoint tests, typecheck, lint and diff checks passed. The two new
cases cover missing and corrupt losing weights plus corresponding selected-file
failures. This is scoped service validation; the earlier 371-test combined
receipt predates this correction. Combined validation and fresh independent
review remain pending; no live training or cleanup integration is claimed.
