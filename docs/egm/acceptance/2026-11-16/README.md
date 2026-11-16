# Per-PR acceptance and remaining defects

The user's 2026-11-16 instruction supersedes the all-ten-PR/two-clean-round gate.
No new broad review round was launched. Confirmed round-four repairs were finished;
new failures found by cross-consumer verification are reported without further
behavior patches. Reopen a clean area only when a relevant dependency or behavior changes.

## Verified confirmed repairs

The combined implementation passed typecheck, lint, 421 automated tests,
19 native transport cases, macOS arm64 packaging, ZIP integrity and all four
packaged smoke suites. The configuration cache suite passed 27 assertions.
See [validation receipt](validation.json), [check](check.log), [make](make.log)
and [smoke](smoke.log). Production and test sources are unchanged by owner-scoped
restacking; shared matching ownership was moved to its earliest consumer.
Separate frozen-source typechecks verify each PR layer.

The recurring-family matrix:

| Family | Consumers exercised | Result |
| --- | --- | --- |
| Current-policy admission through commit and unknown completion | Configuration; research event/detail; import inventory/cleanup; Codex defaults/project choice; Claude defaults/run choice | Confirmed store repairs pass, including real main/utility IPC and SQLite/WAL-before-read checks. Shared direct capture still fails below. |
| Stale UI metadata and denied reuse | Configuration saved snapshots/drafts/defaults; completed imports; Codex Run choice; Claude Settings; Runpod and Vast discovery | Configuration passes all 27 packaged assertions. Five other consumers retain cached bodies after matching changes; three retain them after denied refresh. |
| Stable identity/replay and uncertain effects | Configuration, research records, imports, Codex/Claude saves, reservations and checkpoints | Existing and added acceptance/failure assertions pass in the combined check; no new failure in the tested cases. |
| Matching-only source cleanup | Imports: hard-link aliases, symlinks, replacements, lost deletion acknowledgement, restart and 7,000-file inventory | Confirmed regressions pass. Uncertain source evidence preserves source files. |
| Earliest charged execution bounds | Compilation/training/periodic-validation, each through tick, supervisor loss, Stop and contact expiry | All 12 adjacent regressions and 72 execution tests pass; no new failure in the tested cases. |

## Governing contract

The approved [#17 decision, section 3](https://github.com/igrgin/autoresearch-lab/issues/17#issuecomment-6867871329)
requires current admission before disk/WAL/activity/UI publication and rechecking
retained metadata on reuse. Section 5 requires withholding affected copies,
including caches. [Captured live decision](security-decision.md).
These are implementation gaps against the existing decision; a new product-policy
choice is not needed to describe them.

### FAMILY-PERSIST-01 — direct capture loses current matching authority

A deterministic test pauses the real `SafeRecording.capture` after filtering and
before its filesystem write. The real credential service registers a synthetic
matching value while paused. Resuming writes that recognized value to the actual
activity file, verified directly before read-time quarantine. Both
`recognizedBeforeWrite` and `rawSyntheticValuePersisted` are true.
[Receipt](capture-publication.json), [probe](capture-publication.mjs),
[failing assertion](capture-publication.log).

`ClaudeHost.admit` directly uses this API for settings/catalog/model metadata, so
PR #116 remains blocked despite its repaired database publication lease.
`bindRecordedOperation` and `CaptureStream.finish` also delegate to this shared
API. Their inherited gap must be resolved at the shared contract boundary rather
than assumed fixed by each caller's SQLite lease. A follow-up [four-consumer probe](capture-consumers.json) reproduced the same
failure through direct capture, `CaptureStream.finish`, `bindRecordedOperation`,
and an actual `ClaudeHost.discover` catalog admission. See [probe source](capture-consumers.mjs)
and [failing assertions](capture-consumers.log). These are local controlled
consumer paths, not live Claude inference or a native model exposure.

### FAMILY-CACHE-01 — matching changes do not invalidate all metadata views

Each probe uses an isolated packaged application profile, actual trusted
credential entry, actual host/IPC and the real renderer. Provider/model calls use
controlled fixtures. After displaying safe metadata, register its value as a
credential, allow renderer notification/render turns, then exercise actual refresh.
Receipts contain booleans, not real credentials.

| PR / consumer | Unsafe cache after policy change | Unsafe cache after refresh |
| --- | --- | --- |
| #113 completed import | retained | cleared |
| #114 Codex Run choice | retained | retained after `capture_failed` |
| #116 Claude Settings | retained | cleared |
| #109 Runpod discovery | retained | retained after rejected discovery |
| #110 Vast discovery | retained | retained after rejected discovery |

[Import](ui-imports.json), [Codex](ui-codex.json), [Claude](ui-claude.json),
[Runpod](ui-runpod.json), [Vast](ui-vast.json).
Configuration's cache generation/notification repair currently covers its own
views. Other consumers lack equivalent invalidation; keeping an observation as
"stale" does not authorize displaying newly unsafe metadata. Explicit refresh
recovery in Claude/imports does not cover the policy-change boundary.

The probe scripts under `probes/` are frozen adaptations of the packaged smoke
harnesses. Their intentional `FAMILY_PROBE_FINISHED` sentinel stops after recording
results and runs cleanup; its exit status is not an unrelated application crash.
The source capture probe instead ends on its genuine failing assertion.

## Per-PR disposition

| PR / issue | Acceptance |
| --- | --- |
| #107 / #20 defaults | Passed: publication ownership, delayed reply, denied reuse and cache clearing. |
| #111 / #55 reservations | Passed: exclusion, restart and proof-gated release; no new relevant failure. |
| #115 / #87 records | Passed: full admission/commit ownership, independent replay failure and original identity retention. |
| #113 / #23 imports | Blocked by FAMILY-CACHE-01. Confirmed cleanup and publication repairs pass. |
| #109 / #35 Runpod | Reopened: blocked by FAMILY-CACHE-01. Discovery and scoped adapter checks pass. |
| #110 / #40 Vast | Reopened: blocked by FAMILY-CACHE-01. Discovery/session authority checks pass. |
| #114 / #45 Codex | Reopened: blocked by FAMILY-CACHE-01. Save/publication/uncertain-effect repairs pass. |
| #116 / #50 Claude | Blocked by FAMILY-PERSIST-01 and FAMILY-CACHE-01. Exact-command database publication repair passes. |
| #112 / #60 execution | Passed: repaired earliest cutoff across all charged phases/control entry points. |
| #108 / #62 checkpoints | Passed: replay, equivalent inputs, preserved artifacts and chosen corruption rejection. |

These are per-layer acceptance dispositions, not merge authorization. Later
stack layers also depend on earlier blocked layers. No PR was merged or issue
closed. Hosted PR checks are absent under the externally merged main-only CI
policy (PR #118); local results are not described as hosted CI.

No further patch for either new defect was made. The implementation question
returned to the user is how to apply one shared publication/caching authority to
these remaining consumers, while preserving existing uncertain-write fences.
Live credentials/inference/GPU containment, signing, physical power-loss and
real disk-full behavior remain unqualified.
