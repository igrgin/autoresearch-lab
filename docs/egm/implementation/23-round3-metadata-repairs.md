# Issue 23: round-three private metadata admission repairs

Scope: PR113-R3-F01 and PR113-R3-F02 for [issue 23](https://github.com/igrgin/autoresearch-lab/issues/23)
and parent-owned [PR113](https://github.com/igrgin/autoresearch-lab/pull/113).
This is new execution/correction evidence; prior implementation records and raw
reviews remain unchanged. The supplied raw input is the parent-owned
`docs/egm/goldfish_reviews/2026-11-16-open-prs/round-3/repairs/pr-113/findings.json`.

Before edits, the worker verified its current directory and Git root were the
prepared `t3-6f449664` worktree, its branch was `t3/6f449664`, and its clean HEAD
was `e2ebce5ca050594e55d51abdaae35cfb664a8f20`. Both origin URLs were
`https://github.com/igrgin/autoresearch-lab.git`. `git worktree list --porcelain`
confirmed a distinct checkout of the registered product repository, separate from
the product root, coordinator and issue implementation branch. The prepared
branch was retained. No checkout, branch switch, push, PR, issue publication,
merge, provider action or other agent was created.

The worker read AGENTS.md, the shared agent/GitHub workflows, the complete
[concepts brief](../../designs/concepts_brief.md), [sitemap](../../designs/SITEMAP.md),
raw findings, and live bodies and all comments for #23/#22/#19/#15/#16/#17/#21 via
`gh issue view`. The active issue remained assigned to `igrgin`; the parent had
handled account/assignment verification before dispatch.

Expected behavior was reconstructed from #23's import/recovery criteria and
[#22 section 3](https://github.com/igrgin/autoresearch-lab/issues/22#issuecomment-6859424772):
copy actual supported bytes, verify before publication, preserve sources and
occupied destinations, and retain usable recovery. No approved file-count limit
was found. [#17 section 3](https://github.com/igrgin/autoresearch-lab/issues/17#issuecomment-6867871329)
requires current-policy admission of paths and rechecking retained content;
section 5 requires durable identity-only containment of actual exposure. Both
findings are defects within this issue's byte-import boundary. Neither requires
a new product or spike decision.

## Executed before-failure evidence

Two success-contract regressions were added before changing production code.
They use temporary datasets, project/catalog SQLite stores, and actual
`SafeRecording` / `Sanitizer` / `PrivateFiles` instances, with no registered
credential. After building the existing webpack test configuration:

```sh
ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --test --test-name-pattern='ordinary tokenized|inventory above record' .webpack/tests/imports.cjs
```

Starting production code: **2 tests, 0 passed, 2 failed**, about 4.2 seconds.
The ordinary directory named `tokenized` failed in 697 ms; the neutral flat
directory containing 7,000 one-byte `.txt` files failed in 3,433 ms. Both failed
through the real list-after-settlement path with:

> Import records were withheld by credential protection. Review credential exposure and retained metadata before retrying.

This confirms the reported failure through execution, rather than relying on the
reviewer's source observations. The first path's dynamic dictionary key invoked
credential-field handling; the second full record exceeded generic node bounds.

## Repair and compatibility

[DatasetImports](../../../src/importer/importer.ts) projects directory identities
as fixed `{ path, identity }` objects for admission. Paths remain complete values
subject to all current matching; no path exemption or sanitizer rule relaxation
was added. The existing `directoryIds` dictionary remains unchanged on disk for
v1 compatibility and source-directory replacement checks.

The complete saved header, sources, every file entry, directories and directory
identities pass as schema-aware pieces: at most 128 collection elements and
256 KiB of serialized UTF-8 per piece. Normal entry pieces remain far below the
generic 100,000-node bound. The total inventory can exceed either generic record
bound. Every piece uses the original project/import/file-name security envelope,
so one actual exposure withholds the entire import across pieces, remediation
and restart. No raw inventory is moved into another unbounded port or archive.

Every existing reuse, persistence and background boundary still enumerates and
compares the full saved inventory. To avoid rescanning and retransmitting all
unchanged strings for every file, a bounded cache holds at most 128 checked pieces
(at most 32 MiB of serialized UTF-8 payload, plus JavaScript overhead). Changed
pieces require real `SafeRecording.recheck`; eviction requires another check,
without imposing a dataset limit. Failures clear the cache.

The new private `import_metadata_revision` utility/main exchange carries only
the stable envelope and an opaque policy generation. `SafeRecording.metadataRevision`
checks current readiness and durable import quarantine on every probe. A matcher
registration/replacement/forget changes the generation; unchanged vault reloads
preserve it. A fresh policy instance always has a fresh generation. The importer
checks the generation before and after the complete comparison, rescanning if it
changes during the scan and failing closed after bounded instability. This also
prevents a late registration from making an earlier piece stale. Callers without
the optional revision optimization perform real checks of every piece instead.

Shared-file overlaps: `src/coordinator.ts`, `src/main.ts`,
`src/security/recording.ts`, `src/security/sanitizer.ts`,
`src/security/stored-metadata.ts`, and `scripts/test-security.mjs`.
`storedMetadataEnvelope` extracts the unchanged existing envelope derivation;
other users of `recheckStoredMetadata` retain their existing behavior. The private
revision exchange is additive and absent from renderer/preload interfaces.
Public `ImportRecord`/requests, import/store schema versions and initialization
checksums, verified copy/move semantics, source/destination ownership checks and
uncertain-effect reporting are unchanged. Existing durable quarantine is not
automatically lifted. Shared parent fixes, dependency locks and the main-only CI
trigger policy are preserved.

## After-pass evidence

- The same two focused cases passed. The tokenized regression was then expanded
  to include `secret-data/password-samples` ancestors. It verifies both complete
  independent destination files, byte counts, no incident/revocation, restart/list
  and a subsequent successful import, with no raw source path in public replies.
- The physical 7,000-file fixture completed, verified all 7,000 one-byte outputs,
  reported complete usable bytes, survived both owner restarts and admitted a
  smaller subsequent import. No security state file or false incident was created.
  Import plus all destination-byte assertions took **352,663 ms** in the focused
  run; fixture total was **354,677 ms**. Every fixture directory was removed.
- A separate controlled retained-inventory fixture exceeds 4 MiB of aggregate
  strings. It proves bounded piece admission, reuse of unchanged checked pieces,
  invalidation on policy restart, and registered-secret containment for a path
  present only in `directoryIds`, including durable withholding after restart.
- Mid-scan matcher registration invalidates an earlier header piece; an
  unavailable revision service cannot reuse cached data or leak diagnostics.
  The dedicated security test verifies unchanged vault reloads, matcher changes,
  fresh-instance generations, and withholding even after incident remediation.
- The focused retained-security/source-replacement run passed **14/14** cases,
  including original source-only list/action/revocation/remediation/restart,
  missing/omitted/changed policy responses, background copy/cleanup fencing,
  accepted-retry partial-effect recovery, and replacement during the policy await.
- The dedicated security suite passed **59/59**, including the parent's recording
  reload/quarantine regression.
- `npm run check`: passed typecheck, lint and **334/334 tests**, zero failures or
  skips: 213 domain tests (including 42 importer cases), 59 security, 2 offline
  native SDK, and 60 execution tests. The full-run 7,000-file import and all byte
  assertions took **582,745 ms**, with **21,072** actual piece checks and **42,032**
  identity-only revision probes. The difference from the focused run demonstrates
  that this is not a stable throughput benchmark. The complete domain suite took
  622,522 ms; security 6,466 ms; SDK 24,585 ms; execution 20,002 ms.
- `npm ci` used the unchanged lockfile with Node **24.22.3** / npm **11.19.1**.
  Electron's install script was explicitly invoked with
  `node node_modules/electron/install.js` to install pinned Electron **45.3.2**
  after the install-script policy skipped it. `git diff --check` passed.

The controlled native smoke assertions now warm the inventory cache through
actual main/utility IPC before registering each synthetic destination/source-only
credential. The parent owns running the final combined package/ZIP/native smoke
and fresh isolated review. No native smoke result is claimed by this repair worker.

Performance qualification is limited to these local controlled fixtures. Chunking
alone was insufficient: an intermediate run without generation caching was stopped
after more than four minutes at 2,218/7,000 copied files, and its temporary root
was explicitly removed. The completed cache-enabled run is still several minutes:
full inventory comparison, cloning and per-file SQLite serialization remain
quadratic over a complete import. Large packaged-IPC throughput, larger/deeper
datasets, concurrent workloads, other filesystems and memory pressure are not
qualified. This is a successful capacity/recovery check, not a throughput promise
or a new product limit. No live credentials, user app data, inference, provider
provisioning, training, physical power-loss testing or signed release was used.
