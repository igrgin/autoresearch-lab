# Issue 87 round 3 retention and ingestion repairs

This is implementation and executed regression evidence for PR115-R3-F01,
PR115-R3-F02 and PR115-R3-F03. The parent-supplied round 3 `pr-115/findings.json`
is an unchanged review input; the round-qualified IDs here disambiguate its
original PR115-F01/F02/F03 IDs from earlier rounds. No new policy decision or
review is published by this repair worker.

## Isolation and authority

Before edits, `pwd`, `git rev-parse --show-toplevel`, branch, HEAD, both origin
URLs and `git worktree list --porcelain` confirmed the T3-prepared worktree
`t3-1a54b121`, branch `t3/1a54b121`, with starting HEAD
`e2ebce5ca050594e55d51abdaae35cfb664a8f20`. Its registered primary checkout is
`Documents/home-repo/repos/autoresearch-lab` under the user's home directory;
this worker owns a distinct worktree. Both origin URLs were
`https://github.com/igrgin/autoresearch-lab.git`. The worktree started clean.
The prepared branch was retained; no other checkout or branch was modified.

Read the checkout instructions, shared agent/GitHub workflows, approved
[concepts brief](../../designs/concepts_brief.md), and
[sitemap](../../designs/SITEMAP.md). Live issue bodies and all comments were
retrieved with `gh issue view --repo igrgin/autoresearch-lab --json
number,title,body,comments` for #87, #86, #19, #21, #15, #16, #17, #54, #73,
#61, #63 and #78. Superseding decision comments controlled the repair.

The relevant contracts are [#87 retained evidence](https://github.com/igrgin/autoresearch-lab/issues/87#issuecomment-6894960896),
[#86 retention and pending/final snapshots](https://github.com/igrgin/autoresearch-lab/issues/86#issuecomment-6859457307),
[#16 immutable identities and provenance](https://github.com/igrgin/autoresearch-lab/issues/16#issuecomment-6866989482),
[#17 separately validated safety receipts](https://github.com/igrgin/autoresearch-lab/issues/17#issuecomment-6867871329),
[#61 final-result meaning](https://github.com/igrgin/autoresearch-lab/issues/61#issuecomment-6867877187),
and [#63 terminal publication](https://github.com/igrgin/autoresearch-lab/issues/63#issuecomment-6894959560).
All three findings reproduce within this issue's existing store boundary.

## Before-failure evidence

Before editing product code, three regressions were added to
[the research tests](../../../tests/research.test.ts), bundled with the existing
`webpack.tests.config.cjs`, and executed with:

```sh
PATH=/Users/igrgin/.nvm/versions/node/v24.22.3/bin:$PATH ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --test --test-name-pattern='R3' .webpack/tests/research.cjs
```

The actual initial result was **3 tests, 0 pass, 3 fail**:

| Finding | Executed trigger | Observed failure |
| --- | --- | --- |
| PR115-R3-F01 | Seed the controlled quota replica with the oversized body's first fragment at H−1, retain its original tail at part 1, fill B, then ingest one byte | `SecurityError`, `code: capture_failed`, `effect: unknown`; the envelope transaction aborts |
| PR115-R3-F02 | Admit an attempt, make the sanitizer throw, ingest its activity | `ResearchStore.admit` rejects the second/envelope admission with `capture_failed`; no omission envelope commits |
| PR115-R3-F03 | Persist pending evaluation, reopen, submit final revision 2 under the same ID | `validateEvent` rejects with `invalid_input` |

H is 4 MiB and B is 16 MiB. These were executed local regressions, rather than
inferences from reviewer line references. Tests were subsequently extended with
receipt, compatibility, negative-join and backup cases.

## Repairs and after-pass evidence

PR115-R3-F01: [retention](../../../src/research/store.ts) reuses a deleted part
key once, allocating additional fragments above every still-owned part. All
retention/read ordering uses original byte offsets within an event, so allocation
order cannot move a new middle fragment after the original tail. The controlled
replica now draws oversized-body metadata from real ordinary admission of a
100 KiB body. After the one-byte append, the target body retains exactly
`[0,1)`, `[2,32768)` and `[69632,102400)`; omissions are exactly bucket range
`[1,2)` and original body range `[32768,69632)`. The transaction commits, retained
bytes equal B, both ends remain readable, and restart reports no capture block.

PR115-R3-F02: ordinary capture-policy faults are distinct from storage faults.
Capture-policy faults keep new actions/attempts fenced but do not disable the
private `bind(owner).receipt(event)` route. [Receipt validation](../../../src/research/receipts.ts)
runs independently in both the store and [SafeRecording](../../../src/security/recording.ts),
across the existing coordinator/main security port. Allowed bodies contain only
validated IDs/timestamps/enums and fixed explanation codes:

- Control: `safe_control_receipt`, Pause/Finish/Stop only, existing disposition
  enums, and a causal reference to an already projected attempt/action.
- Confirmed execution outcome: `safe_terminal_receipt`, an already projected
  attempt, terminal enum and evidence ID supplied by the execution owner.
- Omission activity: fixed `type: omitted`, `status: unavailable`, null source
  time/detail, allowlisted source/channel, and an already admitted attempt/action.

The route records evidence; it neither verifies remote termination itself nor
supplies launch, Resume, acceptance or reservation authority. Actual confirmation
still belongs to the trusted logical owner. Invalid owner, arbitrary prose,
unknown attempt, Resume, new attempt and oversized receipt-body inputs are
rejected. Raw receipt validation runs before queue omission can drop an invalid
body. Broken-filter activity retains that fixed safe envelope and unknown-range
redaction omission metadata. Original unfiltered type/status/diagnostic/detail
text is never copied into it. Database and security restarts preserve the fence;
replay retains one Stop and one interrupted outcome, without raw diagnostics.
Receipt/ordinary-admission replay deduplicates the producer event independently
of replica admission metadata and preserves original source bytes/ordinal.

Storage failure still fences every write. An injected transaction failure rolls
back the terminal receipt and durably blocks retry through this route after
restart. Unavailable private security storage also remains fail closed through
SafeRecording readiness. Existing SafeRecording control/outcome file APIs,
retained-metadata rechecks and immediate quarantine/reload merging are unchanged.
Read projections still recheck current policy and withhold quarantined runs;
receipt persistence is not permission to disclose contaminated history.

PR115-R3-F03: contract 1.1 permits an evaluation completion revision under the
same result ID, with unchanged attempt/tested commit/checkpoint/evaluation
context and a `causedBy` reference to its preceding pending source event.
Only pending-to-valid or pending-to-invalid completion is allowed; completed
results cannot acquire another authoritative revision. Invalid completion keeps
`eligible: null`. Source history, including pending evidence, is retained.
Missing earlier evidence stays pending until delivered; malformed transitions
remain conflicts. Same-revision contradictions and alternate logical-result IDs
retain the existing conflict rules. Valid completion plus terminal outcome and
coordinator decision selects once; invalid completion does not select. Neither
pending progress nor a result alone substitutes for terminal/decision evidence.

The [focused executed output](./focused-tests.txt) records **8 passed, 0 failed**.
It covers valid and invalid completion, delayed pending evidence, missing
causation, changed joins, legacy-final edits, contradictory completed revisions,
replay, security restart, storage rollback and consistent-backup restoration.

## Compatibility, preservation and recovery

The SQL schema, migration checksums and project identity marker remain unchanged.
Existing detail part keys remain readable; no renumbering or payload migration
runs on open. The original retention policy and existing valid contract 1.0
revision-1 final results remain supported. No source records are reset, deleted
or rewritten by an upgrade. The previous implementation note remains intact;
this separate evidence record documents the correction.

Evaluation completion is an opt-in **contract 1.1** feature. A 1.0 completion
revision is rejected. Producers must use a compatible consumer before emitting
1.1 completions; older consumers cannot ingest them. The store does not implement
remote feature negotiation or evaluator producers. New private host request kind
`receipt` and `SafeRecording.admitReceipt(owner,event)` must be wired together;
there is no renderer write endpoint. Capture-path constants were extracted to
[recording-paths](../../../src/security/recording-paths.ts) to avoid a runtime
module cycle, with the existing recording exports preserved.

The backup regression creates a consistent SQLite online backup, reopens the
original and verifies identical source rows and schema-migration rows, then opens
the backup with the same project binding and replays the final event once.
Restored source rows are unchanged and `integrity_check` returns `ok`. With no
SQL migration, no automatic upgrade backup is needed or created by this patch.
Existing missing-database, unknown-schema and migration rollback protections are
preserved; recovery never silently creates replacement history.

Shared-file integration overlaps: `src/catalog/catalog.ts`, `src/coordinator.ts`,
`src/main.ts`, `src/security/recording.ts`, and the existing research store,
contract, host and fixture/tests. No dependencies, lockfile, CI workflow or
provider/authentication settings changed. The merged PR118 CI policy is preserved.

## Validation and limits

Checks use Node 24.22.3 via the user-specified PATH. `npm ci` installed locked
dependencies; its policy skipped Electron's installer, so the pinned Electron
was installed explicitly with `node node_modules/electron/install.js`.

Final full-check results are recorded in [checks](./checks.txt). All executions
used temporary synthetic fixtures, including actual Electron/native SQLite,
subprocess crash tests and controlled sandbox roots. No real credential, user app
data, live inference, provider provisioning or cloud execution was used. No
agents, nested review, GitHub publication, PR creation, push, closure or merge was
performed. Parent integration, final combined make/ZIP/native smoke and fresh
isolated Goldfish review remain pending. No external blocker was found.
