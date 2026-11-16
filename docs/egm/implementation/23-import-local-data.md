# Issue 23 implementation and self-review evidence

Scope: [#23](https://github.com/igrgin/autoresearch-lab/issues/23), implementing the
live [#22 import policy](https://github.com/igrgin/autoresearch-lab/issues/22#issuecomment-6859424772)
within #16's preparation-owner/single-writer boundary. #19 supplies the project
binding. Full live bodies/comments for #23/#22/#19/#16/#17 were read before work
and rechecked unchanged before delivery; #23 remains open and assigned to igrgin,
and its two native prerequisites remain closed.

The tool-prepared clean worktree was verified distinct from the coordinator and
all listed worktrees, with the expected common Git directory and origin. Its branch
was renamed to `23-import-local-data` before edits. No other checkout, issue,
archived input, schema sequence or dependency lockfile was changed.

Delivered integration: the open-project panel uses native file/directory selection
through an opaque selection ID; main admits only its trusted renderer. The utility
coordinator owns `DatasetImports` and the independent `.lab/imports.sqlite` store.
`src/imports.ts` defines version-1 preparation-owned projections with separate
operation/import IDs, revisions, project-relative location, byte progress,
completion/partial/cleanup states and explicitly absent semantic readiness.
Private source paths/inventory never enter renderer projections or agent context.
Main's current/retired credential matcher admits metadata before persistence;
required semantic path strings are rejected rather than redacted into other paths.

Copy stages independent source bytes, verifies SHA-256/size and stable source
identity/inventory, then publishes with exclusive insertion and no overwrites.
Temporary links connect only app-owned verified staging to destination, not source
files; staging is removed before completion. Conservative name checks are backed
by actual filesystem exclusive-creation probes. Source/project ancestry overlap,
symlinks, unsupported entries and occupied destinations block publication.

Recoverable move follows the same byte path. The trusted preparation-owner port
`confirmPreparation(projectId, importId, expectedRevision, preparationRef)` is
absent from renderer IPC. #24/#25 must supply its persisted layout/interpretation/
split confirmation. Until then the app honestly shows cleanup pending and retains
the source. The cleanup implementation is tested through controlled confirmation
fixtures: reverify destination, record deletion intent, delete only matching source
files, retain changed/new entries, and remove only original empty directories
without recursive deletion. Retry preserves a usable destination after cleanup
failure. Byte completion never claims task/run readiness.

Self-review covered accepted/partial/completed distinctions, idempotency and
cross-project identity, serialized retry/discard, no-clobber publication, stable
source verification, symlink/path/name handling, source-deletion ordering,
crash windows, durable registration failure, raw-error/payload exclusion, existing
schema compatibility and the actual renderer/preload/main/utility integration.
An invalid Chromium HTML-pattern expression found by packaged smoke was corrected;
the final smoke includes invalid-folder validation and rejects console errors.

Validation (final results recorded before commit):

- `npm ci` using Node 24.22.3 and the unchanged lockfile.
- `npm run check`: passed, 37 catalog/import tests and 47 synthetic security tests.
  Import tests include copy/shard persistence, staged corruption/cancel/retry,
  source mutation/additions, permission/unavailable-source and space failures,
  occupied/late destinations, normalization/symlink/overlap rejection, cleanup
  failure and matching cleanup, metadata admission, command concurrency and scope.
  Five real SIGKILL boundaries cover copied/reserved/partial-publication/published/
  source-unlinked recovery. Source/destination inode independence is asserted.
- `npm run make`: passed, macOS arm64 app and ZIP built.
- `npm run smoke`: passed on the rebuilt packaged app; copy/move states,
  source/destination failure recovery, sender/metadata protection and full restart
  persistence passed with no renderer/console errors.
- `git diff --check`: passed.

All datasets, storage failures, credentials and preparation confirmations used for
verification are controlled synthetic fixtures. Packaged smoke uses the actual
app/IPC/native SQLite and a stubbed native picker for temporary paths. No live
service credential, subscription, provider, resource lifecycle or research run was
used. Semantic preparation, large-dataset performance, hostile same-user filesystem
mutation, power-loss durability and signed distribution are unqualified. A crash
before durable folder ownership requires preserving/moving ambiguous files aside;
no ownership is guessed and no unrelated bytes are deleted.

Coordinator overlap: `src/coordinator.ts`, `src/main.ts`, `src/preload.ts`,
`src/shell.ts`, `src/projects.ts` (additive error origin), `src/renderer/index.tsx`,
`src/renderer/style.css`, `src/security/electron-vault.ts` (narrow metadata matcher),
`scripts/test.mjs`, `scripts/smoke.mjs`, `webpack.tests.config.cjs`, and
`docs/BUILD.md`. New importer/contracts/component/tests are otherwise isolated.
The import store is an independent v1 initialization; registry/history initialization
SQL and their existing checksums are unchanged.

## Coordinator correction

Coordinator inspection found that unsupported-entry errors included a nested
filename before the full inventory passed credential-name admission. The error
now omits the unadmitted filename. A regression checks a synthetic secret in an
unsupported nested filename against the UI projection, SQLite/WAL bytes, and
reopened records. The corrected source passes typecheck/lint, 38 catalog/import
tests and 47 security tests. Combined packaging/smoke validation remains pending.
# Goldfish corrections

Discard now distinguishes proven publication from an unrelated occupied files
directory. A completed inventory and recorded ownership/publication are required
before matching bytes can block discard as a published copy. Unowned destinations
are preserved while private staging and the old reservation can be discarded.

Every import list/start/action reply passes retained records through shared
credential rechecking before renderer disclosure. Detection creates an identity-
only exposure incident, revokes matched credential access and durably quarantines
the external record without copying its body. Semantic paths are withheld rather
than redacted into different filesystem paths. A write with an unavailable reply
is reported as uncertain. Regression tests cover all three reply kinds and restart.

Record-scoped security identities are namespaced separately from research run
identities. A withheld reply also clears cached import records and form values
from the renderer. Packaged smoke registers a synthetic credential after import,
checks all three real IPC replies and credential revocation, and captures the
before/after protection states without live provider traffic.

The native navigation test also exposed duplicate sibling React keys shared by
the import and configuration panels. The import key now has its own namespace,
and the smoke test requires one import panel after switching to another project.


## Verified-source round-two repairs — 2026-11-16

Repair scope: PR113-R2-F01 / raw PR113-F01 and PR113-R2-F02 / raw PR113-F02.
The implementation worker read this checkout's guidance, the shared agent/GitHub
workflows, concepts brief and sitemap, the full frozen raw review, and live
#23/#22/#19/#16/#17/#21 bodies and every current comment/amendment. Live decisions
remain authoritative; earlier implementation/review evidence was not used as a
product decision. No archived input or raw review was changed.

Isolation was checked before edits: the T3-prepared `t3-0482f08d` worktree, branch
`t3/0482f08d`, started clean at
`2d3951292d73c8e1b0d17a15133c72a994cb41ad`, with origin
`https://github.com/igrgin/autoresearch-lab.git`. Git's registered worktree list
confirmed separation from the product root, coordinator and issue branch. The
common Git directory belongs to the registered product repository. The worker
kept that branch and did not push, publish decisions, post reviews/comments, or
modify another checkout.

Before production edits, three focused regression cases failed against that
starting production code: the post-unlink failure case and independent list/action
source-only canary cases. The cleanup fixture throws `EIO` exactly once on the
second `unlinked` checkpoint, uses synthetic trusted preparation confirmation,
settles, verifies the original root is absent, restarts, and retries cleanup at the
fresh revision. It remained `cleanup_pending` instead of completing. The two
source-only cases finish verified byte publication to a safe destination before
registering the source-directory canary; both returned successful replies without
revocation. These were actual executed counterexamples, not source-only inferences.

Reproduction command after compiling the test bundles with the existing webpack
configuration (all commands use Node 24.22.3 from the prescribed PATH):

```sh
ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --test --test-name-pattern='post-unlink failure|late source-only credential' .webpack/tests/imports.cjs
```

Receipt: before repair **3 tests, 0 passed, 3 failed**; after the initial repair,
**3 tests, 3 passed, 0 failed**. The final expanded suite also covers these cases.

Cleanup now reconciles durable deletion intents when the original entry/root is
already absent. It checks every existing ancestor for symlinks first; remaining
files still require original identity/content, and directory removal still requires
original directory identity and nonrecursive `rmdir`. Regression cases preserve
symlink, new-file and changed-file replacements after the uncertain unlink. A
separate test replaces a source file during the asynchronous policy response;
cleanup revalidates ancestry and identity after that await before unlinking.
Destination ownership, exclusive publication and trusted preparation confirmation
retain their existing semantics. #24/#25/#26 integration is still future work.

The coordinator supplies a private `recording.recheck` port to `DatasetImports`
using its existing `admission.recheck` / `securityRequest` roundtrip over
`research_security`. Complete `Saved` metadata, including `sources`, `sourceRoot`,
`directories`, `directoryIds` and every entry's private source path, goes through
`recheckStoredMetadata` before reuse, persistence and returned projections.
Background copy/publication and cleanup steps also recheck; denied checks cannot
persist the original payload again. The same project/import/file-name identity as
the public defense-in-depth check drives actual `SafeRecording` exposure handling,
matched credential revocation and durable identity-only quarantine. A retry whose
accepted state is already durable reports partial effect if a later private-policy
response fails; a regression reopens and recovers it without duplicate publication.
No raw SQL or private-state endpoint was added to renderer IPC, no semantic path is rewritten,
and no second raw archive is created. Missing policy ports, failed responses,
omitted coverage and changed bodies all fail closed with fixed safe guidance.

Source-only tests assert list/action withholding, identity-only incident state,
matched revocation, unchanged original SQL payload and no second security file.
After restarting both owners, forgetting matcher material and completing synthetic
incident remediation, the original record remains withheld for list, retry,
retry-cleanup, discard, cancel and trusted preparation confirmation. Background
fixtures register the canary after copying or immediately before cleanup and prove
further work stops while both source and verified destination bytes survive.

Compatibility: public import contracts, renderer bridges, store schema/version,
existing initialization markers and backups are unchanged. The new policy port is
internal to the sole-writer coordinator; omitted legacy callers fail closed. Main's
existing public-projection recheck remains defense in depth. Import persistence now
awaits policy checking; source identity is checked again after the new await before
deletion. Quarantine remains in place and does not claim forensic erasure of SQLite
WAL/free pages, backups or external copies.

Final validation:

- `npm ci` with the unchanged lockfile; npm's install-script policy required an
  explicit `node node_modules/electron/install.js` to install the pinned Electron.
- `npm run check`: passed **319 tests** (202 domain, including 37 importer cases;
  57 security; 2 offline native SDK; 58 execution), zero failures. This includes
  the existing five actual SIGKILL/SQLite recovery boundaries, normal copy, trusted
  move confirmation, cancellation, conflicts and changed/new-source preservation.
- `npm run make`: passed; macOS arm64 application and ZIP built.
- `node scripts/smoke.mjs`: passed on the packaged application, including actual
  utility IPC checks for both destination-only and source-only canaries, withheld
  list/action/start replies and revocation of each distinct synthetic credential.
- `npm run lint` and `git diff --check`: passed. Standalone Vast/Codex packaged
  smoke scripts remain for the parent's final combined validation.

All source datasets, credentials, failures and preparation/incident-recovery
confirmations are controlled fixtures. Full metadata checking adds private IPC and
bounded matcher work per persistence/phase; large-dataset performance remains
unqualified. No live service authentication/inference, GPU training, hostile
same-user filesystem mutation, physical disk-full/power-loss behavior or signed
release is claimed. Parent owns the final combined build, all native smoke suites
and independent review/integration into PR113.
