# Issue 23: round-four source alias and publication authority repairs

This records the authorized local repair of PR113-F01 and the parent's adjacent
PR113-C01 for [issue 23](https://github.com/igrgin/autoresearch-lab/issues/23) /
[PR 113](https://github.com/igrgin/autoresearch-lab/pull/113). Archived findings,
reviewer responses, previous fixes and captured inputs remain unchanged. The
parent owns integration, pushing and fresh independent review; this record does
not claim review convergence.

## Workspace and authority

Before edits, `pwd` and Git top-level both identified the prepared `t3-99f3fbe3`
worktree, branch `t3/99f3fbe3`, clean HEAD
`c96fcf722e2c863b01570d17a73d7a693fa7b8ee`. Fetch/push origin was
`https://github.com/igrgin/autoresearch-lab.git`. Git worktree registration
identified it as a distinct checkout of the primary product repository. No
worktree/branch switch, other-checkout edit, push, PR, issue/comment publication,
merge, live credential, paid inference or provisioning was performed.

Read the repository instructions, shared agent and GitHub workflows, EGM fix
procedure, [concepts brief](../../designs/concepts_brief.md),
[sitemap](../../designs/SITEMAP.md), approved design framing, build scripts, entire
selected reviewer JSON and findings. Live issue bodies and every available
comment for #23/#22/#19/#15/#16/#17/#24/#25/#26 were fetched with `gh issue view`;
the frozen issue URLs/index corroborated their ownership and decisions. The
parent had verified account, assignment and blockers before dispatch.

[#22 section 3](https://github.com/igrgin/autoresearch-lab/issues/22#issuecomment-6859424772)
requires independent project bytes and matching-only recoverable source cleanup.
Regular source names may share an inode; the prohibition concerns imported links
to mutable sources. #24/#25/#26 still own semantic interpretation, fixed run
inputs and explicit updates. [#17](https://github.com/igrgin/autoresearch-lab/issues/17#issuecomment-6867871329)
requires current matching authority before persistence and durable containment.

## Executed original regressions

Two completion regressions were added before production edits. `node
scripts/test.mjs` genuinely failed with **245 passing tests and exactly two
failures**: healthy confirmed two-alias move and SIGKILL after its first unlink,
followed by restart/retry. Both reported `cleanup_pending` instead of `complete`.
The controlled 7,000-file import plus byte assertions took **494,503 ms**; its
whole test took 500,950 ms and the suite 542,778 ms. This is a slow throughput
limit, not large-dataset qualification.

The first attempt could not load Electron because the prepared checkout lacked
node_modules. That setup failure is retained separately and is not reproduction.
`npm ci` installed the unchanged pinned lockfile before the genuine failure.

After the user added adjacent PR113-C01, the exact parent regression was copied
into this branch and executed against the unchanged publication mechanism. It
failed independently: registering a credential path after computing the final
revision but before delivering it left that raw path in `imports.payload` before
any inspection. The local assertion failed in 539 ms. See the immutable
[hard-link before receipt](23-round4-evidence/hardlink-before/receipt.json) and
[adjacent before receipt](23-round4-evidence/adjacent-before/receipt.json), with
stdout/stderr in the same directories. The original scoped sources and regression
snapshots remain in the external helper case recorded in the receipt paths.

## Repair and compatibility

[Importer cleanup](../../../src/importer/importer.ts) retains the original
inventory identity and introduces optional private `cleanupIdentity` only for
observed application unlink transitions. It pins the inode, checks full identity
immediately before unlink, and synchronously observes the resulting stat without
an intervening application action. Device/inode, size, mtime, mode, UID/GID,
birthtime and the exact one-link decrement must agree. Only still-inventoried
aliases with the exact previous identity receive that observed ctime. The source
directory is synced and the receipt persisted before the existing `unlinked`
checkpoint. The original deletion intent still reconciles the removed name.

Each surviving name still passes symlink ancestry, full ctime/inode/size/mtime
identity and digest checks. A crash at the new earlier `unlink_unrecorded`
checkpoint, before durable alias evidence, retains the uncertain surviving
aliases on every restart/retry. Earlier stuck moves lacking that evidence also
remain conservative. No authority is inferred from absence or a matching digest
alone. Destination verification precedes cleanup; destination files remain
independent inodes/bytes with link count one.

[Publication](../../../src/importer/importer.ts) now owns the existing matching
policy before bounded-piece recheck and through every synchronous SQLite INSERT
and UPDATE. Missing ownership fails closed. The private
[import lease port](../../../src/importer/policy.ts) carries identity-only
acquire/release messages. Main holds `Sanitizer.holdMatchingPolicy()`; existing
`registerWhenMutable` waits for writer completion. No second matcher lock or
sanitizer exemption was introduced. An acquisition timeout never revives a write
on late grant. Dropped or uncertain release retains the hold until explicit
writer release or actual utility exit. Acquisition cancellation is tracked before
asynchronous initialization, so late grants cannot leak authority. Leased rechecks and revision probes use the already initialized policy; they do
not reload credential state behind a mutation waiting for the same owner. Only
acquisition initializes first. This consumes the parent/#87 integration boundary
without importing that other issue's commit. The same
bounded piece/cache checks and import-wide persistent quarantine remain intact.

Authorized shared-file overlaps are [main](../../../src/main.ts),
[coordinator](../../../src/coordinator.ts), test entry configuration and the npm
test command. The #20 worker confirmed reuse of the unchanged ownership primitive
and configuration-specific ports; import changes use `import_matching`. Parent
#50/#60 and other workers' changes are not copied or replaced. Dependencies,
lockfile, public renderer/preload contracts, CI triggers and existing quarantines
are unchanged. No UI changed and no new screenshots are claimed.

The v1 import SQL/schema/checksum and registry/history schemas are unchanged.
`cleanupIdentity` is optional private JSON state: existing records remain readable,
with uncertain old cleanup retained. Older code ignores this extra evidence and
conservatively retains aliases against the original identity. No migration,
backup transformation or destructive automatic recovery is required.

## Verification receipts and limits

The initial repaired hard-link-focused run passed **23/23** selected cases.
Combined focused checks passed, including the exact stale-approval regression,
missing authority, duplicate grants, timed-out/late grants, asynchronous acquire
cancellation, dropped releases, uncertain delivery and source preservation.
Before final capture, the native fixture passed **four actual Electron
main/utility cases** against the production coordinator and real SQLite: queued
registration at final revision delivery, late grant after the production 15-second
acquisition deadline, dropped post-commit release held until confirmed utility
exit, and denied authority. The final native initializer deliberately waits on a
queued credential mutation, proving leased checks avoid reinitialization; the
dropped-release writer is interrupted conservatively until actual utility exit. These run as part of `npm test` through
[test-import-policy](../../../scripts/test-import-policy.mjs).

Final outcomes are recorded in the immutable receipts/logs below; check each
receipt's `exit_code`, `passed`, pre/post subject IDs and raw assertion output:

- [Focused regression](23-round4-evidence/regression/receipt.json), including the
  native fixture and positive/negative/crash/restart/source/destination tests.
- [Full npm check](23-round4-evidence/check/receipt.json), including the complete
  physical 7,000-file case, existing security/quarantine and native suites.
- [Make and ZIP integrity](23-round4-evidence/make/receipt.json).
- [Packaged native smoke](23-round4-evidence/smoke/receipt.json).

These checks execute sequentially in this checkout, with Node 24.22.3 selected;
webpack/test/package jobs never overlap. Raw receipts contain actual host paths
and toolchain identity. Source/test fingerprints and original failures are
retained by the EGM evidence helper. The final handoff reports their actual
results; absent/failing receipts cannot be interpreted as a pass.

All data, credential values, delayed/dropped messages, trusted preparation
confirmations and process kills are controlled fixtures. They do not establish
live provider/authentication/inference behavior, semantic preparation, hostile
same-user mutation safety, physical disk-full/power-loss durability, clean-machine
signed distribution or acceptable large-dataset performance. Lost release can
hold credential mutation until coordinator exit; uncertain unlink authority can
require deliberate source preservation rather than automatic cleanup. These
limits are explicit, and parent integration/fresh review remain outstanding.
