# PR115 round-4 implementation repair

Scope: PR115-F01 and PR115-F02 from the parent’s immutable round-4 findings.
No GitHub publication, push, merge, issue closure, workflow trigger, renderer flow,
dependency or generic sanitizer primitive changes. Parent owns independent review.

## Starting state and authority

Actual workspace and Git root: the T3-prepared distinct `t3-7678f169` worktree;
branch `t3/7678f169`, clean starting HEAD
`c96fcf722e2c863b01570d17a73d7a693fa7b8ee`, origin
`https://github.com/igrgin/autoresearch-lab.git`, registered primary root
`/Users/igrgin/Documents/home-repo/repos/autoresearch-lab`. No other checkout was
changed. Read checkout AGENTS, shared workflows, approved brief/sitemap and
Overview/Goals, egm-fix, complete selected reviewer/findings and live full issue
bodies/all comments for #87, #86, #19, #21, #15, #16, #17, #47, #52, #66, #91, #78.
Live #17 section 3 requires admission before SQLite/WAL; #16 preserves immutable
source evidence and deduplicates replay; #86 separates replica collection failure
from source identity and preserves ingestion ordinal. No new policy was selected.

## Reproduction

The first attempt had no installed dependencies and failed before tests loaded;
it is setup evidence only. `npm ci` installed the pinned lockfile with Node
24.22.3. Before any production edit, both newly added R4 cases genuinely failed
against original production: a raw synthetic intervening credential was present
in `SELECT body FROM detail`, and unhealthy replay created two conflicting source
rows at ordinals 5 and 7. The dedicated original run executed exactly two tests,
both failed, exit 1. See [baseline receipt](baseline/receipt.json),
[raw output](baseline/stdout.txt) and [raw errors](baseline/stderr.txt). A preceding
broad run also reached both assertions; its wrapper was interrupted while
finishing. It is not used as the definitive reproduction receipt.

## Repair and shared hunks

- [Research store](../../../../src/research/store.ts): owns matching authority
  across detail/event awaits, digesting, retained fragments, transaction and commit;
  independent fixed capture receipts replace the rewritten producer fallback.
- [Private security port](../../../../src/research/security-port.ts): client owns
  release after writer settlement; main releases on explicit quiescence or actual
  utility exit. Timed-out acquisition is cancelled in FIFO order; late admission
  replies cannot revive a writer. Initialized leased admission avoids a credential
  replacement/reload deadlock.
- Shared `main.ts` replaces only the research-security listener and adds release
  on child exit. `coordinator.ts` replaces only research admission request/reply
  plumbing; importer recheck is explicitly bound after replacing an object with
  a class. `security/recording.ts` adds the callback adapter over existing
  `holdMatchingPolicy`; catalog/host signatures name the expanded private port.
  These are overlap points for parent integration with #20/#23/#50/#60. No
  defaults, UI caches, hard-link cleanup or deadline policy is changed.
- Tests preserve fixed-schema outcome/control safety across fences, distinguish
  replica omission receipts from source rows, retry after explicit repair, and
  continue to flag genuinely changed source content. Native IPC uses the actual
  production coordinator and security host/client with delayed responses.

## Migration and compatibility

Research v2 appends only `capture_failures` through the existing checksummed
backup/transaction mechanism. Original v1 schema checksum and source rows remain
unchanged. Existing stores get a consistent `before-v2` backup; a controlled
upgrade test inspects its rows, v1 version and integrity. Future schemas are
rejected without reset. Older applications require offline backup restoration.
Previously manufactured source conflicts remain retained and need reconciliation;
this repair does not silently amend historical source evidence.

Private ingestion failure receipts now expose `captureFailed: true`, pending
status and capture-unavailable reason, with an existing source ordinal as a
reference or null when there is no source. Collection faults remain visible after
restart and recovery; healthy applied replay links recovery without deleting the
fault. No renderer API or shared producer event contract changes.

## Verification

Final check, focused regression, make/ZIP and packaged smoke receipts are stored
in adjacent directories after execution. See the handoff for actual outcomes.
Full fingerprinted before/original/final snapshots and retained baseline source
are in host scratch `/tmp/pr115-repair-evidence`.

## Limits

Controlled local fixtures qualify admission ordering, native SQLite/WAL and
restart/failure behavior. They do not qualify live account/model access, paid
inference, remote containment, training/multi-GPU, physical power loss/disk full,
signed distribution, or realistic large-history throughput. No UI change or
new screenshot is involved. Parent integrates, pushes, reruns combined validation
and obtains independent review; this record does not claim review convergence.
