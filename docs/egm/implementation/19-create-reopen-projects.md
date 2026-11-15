# Issue 19 implementation evidence

Date: 2026-11-15. This is implementation evidence, not a new approved specification.

## Scope and authority

[Issue 19](https://github.com/igrgin/autoresearch-lab/issues/19) implements project
creation and reopening against the [approved concepts brief](../../designs/concepts_brief.md)
and [design sitemap](../../designs/SITEMAP.md). Live preflight and publication
recheck found the issue OPEN, assigned only to `igrgin`, and native blockers
[#16](https://github.com/igrgin/autoresearch-lab/issues/16) and
[#18](https://github.com/igrgin/autoresearch-lab/issues/18) CLOSED. Issue 19 and
18 had no comments. Read all #16 comments, including its superseding complete
numbered decisions 1–4, and all comments on the linked persistence/stack owner
[#15](https://github.com/igrgin/autoresearch-lab/issues/15). No GitHub CLI call
failed. No issue comments were posted or issue relationships changed.

The work uses the existing merged Electron/React/TypeScript scaffold. Main owns
native host admission, the sandboxed preload exposes named catalog operations,
and the utility coordinator alone owns SQLite, filesystem and Git work. The
existing shell status projection, including SQLite version, remains available.

## Implemented behavior

- Independent folders and Git repositories under the displayed application
  workspace projects folder; names and opaque project UUIDs are persisted in a
  SQLite registry. Folder bindings are relative to the installation's workspace.
- A project-local identity marker, initial history schema and local Git binding
  must agree before registration becomes usable. The history store is ready for
  later schemas; it does not invent run settings, task policies or history.
- Persisted creation intents, same-request deduplication, altered-request
  rejection, incomplete listing and explicit Retry creation reconciliation.
- Reopening validates original identity/history/repository bindings. Unavailable
  projects remain listed and are not silently recreated. Restoring their files
  permits reopening the same identity.
- Existing paths, symlinks, traversal, case aliases, permissions and mismatched
  identities/repositories fail without overwriting unrelated files. Git uses an
  absolute installed executable and strips inherited Git environment overrides.
- Version 1 registry/history initialization has checksummed migration records,
  fixed-runtime checks, WAL/FULL synchronization and a bounded busy timeout.
  Unknown/newer schemas are rejected without reset. No existing schema upgrade
  is introduced.

## Verification

The [catalog integration tests](../../../tests/catalog.test.ts) run against
Electron's embedded Node and the packaged native SQLite payload, with real local
files and Git repositories. The [crash worker](../../../tests/crash-worker.ts)
receives SIGKILL at eight creation checkpoints: durable intent, folder creation,
identity marker, history creation, Git init before binding, bound Git repository,
before ready publication and after ready publication. Restart retains the same
project identity; incomplete projects cannot open. Ambiguous ownership remains
blocked until the user preserves/moves the ambiguous files aside.

The 17 automated checks also cover two independent projects across restart,
source-file preservation, duplicate and altered requests, conflicting folders,
files and dangling symlinks, path traversal, actual unwritable permissions and
retry, missing/replaced folders and metadata, history symlink substitution,
unrelated Git binding, inherited Git environment redirection, and future-schema
rejection without resetting records.

`npm run build` passes TypeScript, ESLint, all 17 catalog tests, webpack/native
packaging and macOS arm64 ZIP creation. `npm run smoke` passes the actual packaged
application's UI creation of two projects, conflict/file preservation, full app
restart/reopen with the same project identity/repository, unavailable-folder
restoration, navigation, sandbox isolation and native close/reopen/quit. Renderer
page errors and console errors are asserted empty. ZIP integrity and
`git diff --check` pass. Smoke JSON/screenshots are generated under ignored
`out/smoke/` and uploaded by the existing CI after a successful build.

A first smoke run exposed an invalid HTML pattern under Chromium's Unicode-set
regex mode. The form pattern was corrected and the final smoke check asserts
console errors as well as page errors, preventing a silent recurrence. The test
runner uses webpack's API directly because webpack-cli is not a scaffold
dependency; no dependency or lockfile changes were needed.

## Limits and follow-up boundaries

This slice opens a project view with its identity and files/repository locations;
it does not add a code editor, import, relocation UI, task setup or training. New
repositories have an unborn `main` branch; the first generated-source commit
belongs to preparation work. Installed Apple Command Line Tools remains the
internal-build prerequisite. Shared-user filesystem attacks and agent isolation
remain with their security/execution owners.

Recovery deliberately does not delete files. A crash before identity-marker
publication, or between Git init and project binding, requires manual
preservation/moving aside before retry. No unresolved product decision was
needed to implement this conservative behavior. Actual power loss, disk-full,
network/sync storage, external distribution, backups/move UX and future schema
upgrades remain unqualified; SIGKILL is not proof of those guarantees. The
[build and recovery guide](../../BUILD.md) documents these limits.
