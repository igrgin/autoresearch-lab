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
