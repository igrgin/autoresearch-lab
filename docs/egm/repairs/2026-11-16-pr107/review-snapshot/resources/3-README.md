# PR #107 round-four defaults repair

This repair addresses PR107-F01 and PR107-F02 from the retained
[findings](inputs/findings.json) and [raw reviewer report](inputs/reviewer.json).
The approved contracts are issue [#20](https://github.com/igrgin/autoresearch-lab/issues/20),
[#16](https://github.com/igrgin/autoresearch-lab/issues/16), and the
[#17 credential decision](https://github.com/igrgin/autoresearch-lab/issues/17#issuecomment-6867871329),
especially admission before persistence and current-policy checks on reuse.
Live issue bodies and every comment for #20/#19/#15/#16/#17/#21/#28 were read
through `gh issue view`; the frozen round-four inputs corroborated their scope.
Full run settings remain #28 work.

The [workspace receipt](inputs/workspace.json) records the actual isolated
checkout, prepared branch, baseline SHA, origin and primary-root registration.
The checkout was clean before this task. No worktree was created/switched and
no other task checkout was changed.

## Original failures

The original-production regression in [unit.log](before/unit.log) fails because
the snapshot write returns success after recognition between the second
admission approval and writer continuation. The retained
[source snapshot](before/source-snapshot/snapshot.json) includes the original
production inputs and regression assertion.

The [packaged baseline](before/result.json) independently reproduces both defects:
registration completes while main's already-approved second utility-port
admission is delayed, and the subsequent write creates a new plaintext project
snapshot copy even though the renderer reply is withheld. Already selected
snapshot and prepared draft bodies remain after rejected revalidation; mounted
default inputs remain immediately after recognition. A defaults reload itself
already cleared its own form, which is preserved as a passing baseline assertion.
The [execution receipt](before/receipt/receipt.json) records the genuine nonzero
exit. Earlier fixture timing/probe-start mistakes were corrected before that
receipt; they were not classified as defect reproductions.

Actual original packaged captures include [snapshot after denial](before/snapshot-after.png),
[draft after denial](before/draft-after.png), and [defaults after recognition/reload](before/defaults-after.png).
These are synthetic canaries in temporary profiles, not real credentials or user
data. The captures are unmodified; tall element captures include scroll clipping.

## Repair and integration seams

- `ConfigurationClient` owns the existing `Sanitizer.holdMatchingPolicy()` before
  dispatch. Main checks the request under that ownership. Both utility admission
  requests carry the owning transport request identity, and main refuses orphan
  approvals. Resolved inherited choices are still admitted before SQL, with the
  existing defaults-revision fences preserved.
- The coordinator terminal reply follows `handleAdmitted` and its synchronous
  database close/commit path. Main releases ownership on that reply or confirmed
  utility exit. Caller timeout, dropped replies and throwing transport do not
  release an in-flight writer. A missing terminal reply can conservatively block
  new credential recognition until utility exit/application restart. No FIFO
  barrier is assumed for this asynchronously handled protocol.
- `holdMatchingPolicy`, `registerWhenMutable` and `forgetWhenMutable` semantics
  are unchanged. The sanitizer adds only a memory-only matching-change
  subscription; unchanged vault reloads do not notify. Main forwards a value-free
  notification through the narrow preload bridge.
- Snapshot, draft and defaults state clears on matching changes. A denied reuse
  invalidates sibling configuration caches too. Every operation owns a renderer
  generation; older replies cannot restore cleared bodies. Defaults recovery
  retains its minimal revision-only identity and clean replacement path.

Shared-file hunks are restricted to configuration routing/client initialization,
the value-free notification, and sanitizer subscription delivery. Import-specific
ports and research publication/replay remain their workers' scope; the parent
owns Claude SelectionClient guarding and deadline arbitration. No Codex or Claude
implementation was changed. The parent will restack the existing generic matcher
ownership primitive into the earliest #20 layer; this patch adds no parallel lock.

## Validation and limits

Final receipts and captures are recorded below after execution. Focused tests
cover both race orderings, caller timeout, uncertain send, late/duplicate replies,
orphan/denied admission, policy notifications, sibling invalidation and restart.
Packaged tests use the actual main/coordinator, credential-entry form and encrypted
vault, with test-only message-delay hooks and synthetic data. Notification-drop
fixtures exercise explicit denial independently of policy push delivery. Delayed
already-admitted IPC replies exercise all three renderer body types.

No schema, data migration, dependency, backup format or saved-record format
changes are required. Existing immutable records and precedence remain intact;
previously recognized historical choices remain withheld rather than rewritten.
This is not forensic erasure or retroactive cleanup of existing database/WAL/
backup copies. No live provider, paid inference, GPU, signed distribution or
clean-machine qualification is claimed.

The main-only CI trigger is unchanged. No PR, GitHub comment/review, merge, push
or issue closure was performed. Independent review and combined-stack integration
remain with the parent; this worker does not claim review convergence.

Correction to the initial five-minute interpretation: the import worker reported
that its original 7000-file test completed after about 494 seconds under shared
machine load. The first broad run here is an **incomplete timeout**, not evidence
of an inherited hang or defect. A longer final run is required and recorded
separately; no earlier receipt is overwritten.

Compatibility cross-check: inspected #87's supplied repair commit through
`git show` without applying it. The defaults request initializes before taking
ownership, then its leased admission callbacks use the established matcher and
never reinitialize. This avoids waiting on a queued credential replacement that
is itself waiting for this writer. There is no separate utility hold-acquisition
round trip in this defaults protocol: main owns matching before dispatching the
entire request. Configuration and import/research ports retain separate IDs.

Final broad source verification passed: [npm run check](after/check/receipt.json)
reports 250 application tests, 60 security tests, 2 Claude native runtime tests,
and 60 execution tests passing, followed by the production Codex transport check.
The controlled 7000-file import took 361358 ms. The earlier 300-second attempt
was too short and remains retained as [incomplete evidence](incomplete/check-300s/receipt.json).
The [focused configuration receipt](after/configuration-tests/receipt.json)
reports 17/17 passing. The prepackage targeted native rerun passed all 27
observations; the final full packaged smoke is recorded separately below.

Final packaged verification passed sequentially:

| Check | Receipt |
| --- | --- |
| `npm run make` (macOS arm64 app and ZIP) | [make](after/make/receipt.json) |
| `unzip -tq` on the final ZIP | [integrity](after/zip/receipt.json) |
| `npm run smoke` (existing native fixtures plus configuration protection) | [smoke](after/smoke/receipt.json) |
| Configuration protection: 27/27 observations | [actual native results](after/native/result.json) |

Final actual packaged captures include [snapshot withheld](after/native/snapshot-after.png),
[draft withheld](after/native/draft-after.png),
[snapshot denial with notification dropped](after/native/snapshot-denial-only-after.png),
[draft/default sibling clearing after denial](after/native/draft-denial-only-after.png),
and [default recovery](after/native/defaults-after.png). Each final run uses a
fresh temporary synthetic profile, so fixture identity text can differ from the
original-production capture. No image was generated or edited.

The private admission IPC requires main/preload/utility from the same application
build; no mixed-version utility protocol is supported. SQLite/saved-record
compatibility is unchanged. No user backup or migration is needed for this patch.
The [dispositions](dispositions.json) describe the implemented fixes; independent
review is pending with the parent. There is no genuine external blocker remaining.
