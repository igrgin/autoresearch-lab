# Build and run on macOS

The first supported build target is **Apple Silicon (arm64), macOS 15 or later**.
Intel, Windows and Linux builds are not qualified. The workspace supports project creation, persisted listing, reopening, global/project defaults saved run configurations and recoverable local dataset imports. Runs
and Compute provide empty states; Credential settings use a separate trusted window; provider connections, agents and training
remain separate implementation tasks.

## Prerequisites

- Git and Apple Command Line Tools (`xcode-select --install`), including Clang.
- Node **24.22.3** (also in [`.node-version`](../.node-version)) and npm **10.9.0
  or later**. Select that Node version in your version manager before installing.
- Python 3 for `node-gyp` if a native dependency must compile from source.
- Internet access for the first npm install, Electron download and native headers.

No Python ML environment, cloud credentials, provider resource or separate web
server is needed. The packaged app embeds its own Electron/Node runtime.

## Clean build and launch

From a clean checkout, in the repository root:

```sh
npm ci
npm run build
open "out/Autoresearch Lab-darwin-arm64/Autoresearch Lab.app"
```

`build` runs TypeScript checking, linting, catalog/reservation recovery and synthetic security tests, webpack compilation, native-module
rebuilding and Forge packaging/making. Dependencies are pinned in
[`package-lock.json`](../package-lock.json). Forge produces:

- `out/Autoresearch Lab-darwin-arm64/Autoresearch Lab.app`
- `out/make/zip/darwin/arm64/Autoresearch Lab-darwin-arm64-0.1.0.zip`

These are unsigned internal builds, without Developer ID signing or notarization.
They are not qualified for external distribution or a clean Mac without developer
tools. Do not bypass Gatekeeper to install an untrusted download.

For interactive development, use `npm start`. It uses Forge's local webpack
development server. Use View → Reload after renderer edits (automatic browser
HMR injection is disabled for the sandboxed preload). Packaged builds load local files and need no server. Use
`npm run check` for source checks and catalog, reservation and security tests, `npm test` for all suites
alone, or `npm run package` for just the app. Catalog/reservation tests use Electron's embedded
Node runtime and the same native SQLite payload as the packaged coordinator.
Security tests use synthetic values and temporary stores without live adapters.

## Packaged smoke check and CI

After building, run:

```sh
npm run smoke
```

This launches the actual packaged executable in a temporary user-data directory,
checks native SQLite loading and durable storage in the utility coordinator, all
three navigation pages, renderer isolation, native window close/reopen and normal
app quit. It also creates two projects through the UI, preserves a source file on
a conflicting creation, restarts the entire application, reopens the same
project identity/repository, and checks unavailable-folder restoration. It also saves, replaces and revokes
synthetic credentials through the dedicated settings window, checks Keychain-backed
ciphertext and cleared inputs, tests storage/browser recovery, and rejects
credential IPC from unrelated renderers. Browser and clipboard endpoints are
stubbed while validation runs. It
writes `out/smoke/result.json` and `out/smoke/workspace.png`, then removes its test
profile. Playwright controls Electron directly; no browser install is needed.
It also tests both provider reservation bindings through a separate packaged
utility fixture: whole-instance conflict, unknown stop, no-proof release rejection
and restart retention. It does not prove active-run Pause or live remote recovery,
which the shell cannot yet exercise.

[macOS CI](../.github/workflows/macos-build.yml) runs on every pull request and
push to `main`. It checks the arm64 runner, installs from the lockfile, runs the
same build and smoke commands, and uploads the ZIP plus smoke evidence as
`autoresearch-lab-macos-arm64`. Upload runs only after every preceding step
succeeds, with missing output treated as an error. A failed check/build/launch
fails the job and publishes no build artifact.

To verify the negative path on a review branch, temporarily introduce a TypeScript
error under `src/`, push it to the PR, and confirm the build job fails at checking
and skips upload (the run's artifact list must be empty). Revert the error and
verify a new successful run with the ZIP. Do not merge the deliberate failure.

The packaged configuration-protection smoke additionally delays a real
main/coordinator admission and checks credential entry ordering through commit,
current/retired read denial and full application restart. It checks surviving
snapshot, draft and defaults views after credential changes, including delayed
previously admitted replies. Evidence is written to
`out/smoke/configuration-protection/`. These are synthetic local fixtures, with
no live credentials, provider traffic or inference.

## Project storage and recovery

The utility coordinator stores `registry.sqlite` under Electron's application-data
folder (`app.getPath('userData')`) and creates projects under its
`workspace/projects/` folder. The creation panel shows the destination folder and its parent; the shared projects
folder remains available from “Where projects are saved.” Project
names are separate from folder names and opaque UUID identities. Creation needs
only a name; Edit folder name exposes the suggested folder name and validation
rules when customization is needed. Folder names
are single path components; existing files, folders and symlinks are rejected,
including empty folders. Repository import and relocation UI are outside this
issue.

Each project has an independent `.git/`, `.lab/project.json` identity marker and
`.lab/history.sqlite` identity store. The Git local configuration records
`autoresearch.projectId`; `.gitignore` excludes `.lab/`, `dataset/` and `runs/`.
Git is resolved at `/usr/bin/git`, with an installed Command Line Tools preflight
and recorded version. The app removes inherited `GIT_*` redirections, ignores
external Git configuration and creates repositories without templates. New
repositories have an unborn `main` branch; generated research source and its
first commit belong to later preparation work.

A durable creation intent precedes filesystem/Git work. The project becomes
ready only after the marker, history identity and repository binding validate.
Retrying the same creation request returns the same project; reusing its request
identity with different details fails. Incomplete creations stay listed with
**Retry creation** and cannot be opened. Recovery continues only from files whose
ownership can be verified; it never deletes partial files or reinitializes an
existing repository. A crash before marker publication, or between Git init and
binding publication, needs manual preservation/moving aside of the ambiguous
folder or `.git/` before retry. The error names that action. Recovered projects
keep their original identity.

Reopening validates the saved identity, history schema and Git repository. A
missing, inaccessible or substituted project remains listed as unavailable;
restoring its original files and choosing **Open project** retries validation. The app
does not recreate missing files for a previously ready project. Open preserves the saved list beside the current-project panel. Folder locations
can be inspected before opening. The current panel provides Finder access,
validated project/Git-path copying and a disclosure for Git metadata and project identity. The project folder is also the Git working repository; Git metadata utilities are secondary. A code editor
and task setup are separate work.

Stores use versioned, checksummed SQL migrations, WAL, FULL synchronization,
foreign keys and a bounded busy timeout. A newer/unknown schema is rejected
without resetting it. Version 2 adds shared compute reservations and project
release intents. Existing registry stores upgrade on startup; existing project
histories upgrade when reservation work first needs them. A consistent SQLite
backup named `<database>.before-v2-<uuid>.sqlite` precedes each upgrade, and failed
migrations roll back. Older application versions reject upgraded stores; rolling
back requires restoring their pre-upgrade backups with the app stopped. Use supported
local storage only: network and sync-folder operation, power-loss durability,
and moving/backup UX remain unqualified. SIGKILL recovery tests do not prove
power-loss or disk-full safety.

The project list supports search and sorting by recently opened, name or creation
time. Last-opened times are disposable local UI preferences, stored in the
renderer profile. They are not research history or authoritative project records;
clearing that UI cache loses recency cues without affecting projects or their
identities. Copy feedback is scoped to the project whose location or Git path was copied.

## Defaults and saved configurations

Open **Settings** for global defaults. Open a project and expand **Project
defaults** to inherit or explicitly override each choice. The current reusable
choices are the research agent/integration and model ID (one atomic choice),
experiment training duration in whole seconds, and research objective. Empty
choices remain unselected; no numeric duration or model is silently assumed.
Model IDs are requests, not verified account/model availability.

Precedence is per choice: an explicit run choice overrides an explicit project
choice, which overrides the global choice. An absent project/run key inherits;
an explicit empty (`null`) choice remains unset even if a global value exists.
Removing an override restores inheritance. Changing agent integration clears its
model, so a model from a different integration cannot be inherited accidentally.

Choose **Prepare new configuration**, review the effective choices, optionally
override them for this run, then **Save configuration**. **View saved
configuration** reads the original choices and origin revisions, even after
defaults change or the app restarts. Saved configurations have stable snapshot
and reserved run identities and are immutable. They are visibly **Unprepared**;
data, source/initialization, hardware, evaluation and stopping setup, prepared
input manifests and launch validation remain with their owning implementation
slices. This flow does not start training or create execution history.

Only the utility coordinator writes configuration stores. Global defaults use
`defaults.sqlite` and the `defaults.initialized` guard in application data;
project defaults and snapshots use `.lab/configuration.sqlite` in each project.
Existing catalog/history v1 schemas are unchanged. The stores use the same
version/checksum, WAL and FULL-synchronization policy. Defaults append revisions;
snapshot updates/deletes are rejected. Expected revisions reject stale forms
and drafts; reload or prepare again to review current defaults. Retrying an
unchanged save after an uncertain response returns the original result; changing
that request's payload is rejected. A missing established store, foreign project
binding or unsupported schema fails without resetting data. Restore original
files before retrying. Include these stores, their SQLite-consistent state and
the initialization guard when backing up application data; backup/relocation UI
is not implemented.

Settings contain no authentication fields. Main checks the trusted workspace
frame, loads only app-owned credential matching state, rejects unsafe semantic
settings before persistence and rechecks responses before display. It never
silently saves a redacted objective/model as a different choice. If Keychain or
safe admission is unavailable, settings fail closed with reload guidance. A
saved value that later matches a registered credential is withheld for review;
matching does not prove detection of every unknown or transformed secret.

The normal test command includes precedence, restart, immutable-snapshot,
stale/idempotent request, invalid/unsafe input, SQL write failure, missing/foreign
store and future-schema tests. Packaged smoke additionally exercises global and
project settings, explicit unset and run overrides, saved values after edits,
full application restart, known synthetic credential rejection and unrelated
renderer IPC rejection. These are controlled local checks; no provider, agent
model access or training is qualified.

## Local dataset import

The open-project panel provides native directory/file selection, a project-relative
destination preview, copy/move selection, progress, cancellation and recovery.
Select one self-contained directory or explicit files. Byte formats accepted by
this slice are JPEG/PNG, CSV/JSONL and text; decoding, supported task interpretation,
labels, exclusions and split preparation belong to #24/#25. Archives, custom
scripts, special files and symlinks (including selected-path ancestors) are rejected.
All files in a selected directory are included explicitly; remove unsupported or
unwanted entries first, or select files instead. This does not confirm that every
imported file should become a training example.

**Copy is the default.** The preparation owner inventories files, records SHA-256
content/size and source identity, estimates space, and copies bounded chunks into
`.lab/imports/<import-id>/`. Source changes block publication. Names are checked
under conservative case/Unicode normalization and probed using exclusive creation
on the destination filesystem. Existing destinations and source/project ancestry
overlap are rejected. Publication exclusively inserts verified staged files into
`dataset/<chosen-name>/files/`; it never overwrites a destination entry. Temporary
hard links are only between the app's verified staging and destination on the same
project filesystem, never to source files. Staging is removed before completion,
leaving the imported copy independent of its source.

The coordinator alone writes `.lab/imports.sqlite` with the operation/import IDs,
revision, file inventory, digests, relative location, progress and outcome. This
independent version-1 store does not migrate registry/history schemas. Original
source paths and per-file inventory remain private preparation state, outside the
renderer projection and agent context. Main's existing current/retired credential
matcher admits path metadata before persistence; locked/failed protection blocks
that admission. Dataset payloads are copied as selected bytes, never reproduced
in diagnostics or activity records.

Each import INSERT/UPDATE acquires matching-policy ownership through a private
main/utility lease before checking metadata and retains it through the synchronous
SQLite commit. Credential matching changes wait for writer completion; a revision
reply alone cannot authorize persistence. Timed-out acquisition cannot revive a
write when a grant arrives late. An uncertain/dropped release retains ownership
until the writer explicitly releases it or its utility process actually exits.
Unavailable authority blocks persistence. The bounded-piece cache and durable
import-wide quarantine continue to apply under the same matching policy.

Interrupted/failed imports remain named **Partial import** records. **Retry import**
rechecks source stability and staged files; corrupt/truncated staging is copied
again. **Discard staging** removes only the import's staging, preserving sources,
existing project data and any incomplete destination publication. Incomplete
published bytes are kept with an instruction to move them aside before reusing the
name. A fully published copy interrupted before registration must be reconciled
with Retry before discard. A crash before a destination ownership marker is durable
can require manually preserving/moving the ambiguous folder aside; the app never
adopts an unproven folder. Free-space estimates are conservative; actual write,
verification and storage errors still produce partial recovery, not completion.

**Move is explicit and requires one dedicated directory.** It first follows the
same verified-copy path. The usable byte copy is retained with source cleanup
pending until the trusted preparation owner calls `DatasetImports.confirmPreparation`
with a persisted layout/interpretation/split confirmation reference and expected
import revision. This port is deliberately absent from renderer IPC. #24/#25 must
supply that confirmation; the current UI states that preparation is not available
yet and retains the source. Confirmation does not assert full run readiness.
Cleanup verifies the destination again and deletes only inventoried source files
whose content and identity still match. Regular source names may share an inode;
each destination file is an independent byte copy. Cleanup pins the source inode,
observes its own unlink's link-count/ctime transition, and persists the resulting
identity for matching inventoried aliases before continuing. Full ctime, inode,
size, mtime and digest checks still apply to every surviving name. Durable deletion
intents reconcile crashes between unlink and progress recording. A crash before
the alias identity receipt is durable preserves the uncertain remaining aliases
and reports incomplete cleanup; retry never infers authority from a missing name.
Earlier incomplete moves without that receipt likewise retain uncertain sources.
Non-recursive directory removal preserves
new/changed/replaced entries. Cleanup failures keep the project copy and show
**import complete; source cleanup incomplete**, remaining inventoried-file count,
and **Retry source cleanup**. No destination rollback or provider action occurs.

`npm run check` includes importer acceptance/failure tests and real SIGKILL recovery
checks. Packaged `npm run smoke` exercises native-picker-backed UI/IPC (the picker
is stubbed to controlled temporary fixtures), copy/default and explicit move,
source-unavailable retry/discard, occupied-destination preservation, metadata
admission, sender isolation and full-application restart persistence. These checks
qualify local byte handling, not semantic preparation, large-dataset performance,
hostile same-user filesystem mutation, power-loss durability, cloud services or
research readiness.

## Host boundaries and follow-up work

The React renderer has no Node access; a sandboxed preload exposes status,
typed catalog operations (list/create/open/recover), narrow dataset-import
operations and five native actions (reveal validated project or Git folders, copy either validated path, and
copy the known workspace projects path). Main validates the
requesting window/frame and owns native windows and utility-process lifecycle.
Main resolves native-action locations through the catalog; the renderer never
supplies an arbitrary native path or clipboard payload. The utility coordinator
owns all registry/history, filesystem and Git work,
requires actual SQLite 3.51.3 or later, and serializes requests. No raw SQL or
filesystem operation is exposed through the preload. The catalog history schema retains project identity and compute release evidence. A separate private
`.lab/research.sqlite` stores admitted research facts, transactional projections and
replay cursors through the coordinator; see the [#87 implementation record](egm/87-record-store-implementation.md).
History screens, adapters, active-run close handling and remote supervision remain
their dependent tasks.

Research schema v2 adds independent replica capture-failure receipts. Existing v1
stores receive a consistent `research.sqlite.before-v2-<uuid>.sqlite` backup before
the checksummed upgrade; older applications reject v2 and require restoring that
backup with the app stopped. Event/detail admission holds main's current matching
policy through the utility's actual SQLite commit, including after caller timeout.
`npm test` includes delayed-admission, timeout and utility-exit checks over the real
native port, with direct SQLite/WAL inspection before read-time quarantine.
These use synthetic credentials and local fixtures, without live account access.


These boundaries follow the complete decisions in
[#15](https://github.com/igrgin/autoresearch-lab/issues/15#issuecomment-6866989510)
and [#16](https://github.com/igrgin/autoresearch-lab/issues/16). The main/preload,
renderer and coordinator entrypoints stay separate so platform-specific host
code does not become a renderer or shared integration dependency. Future targets
still require their own native module, packaging and lifecycle qualification.

Credential settings are available from the application menu. Saving, replacing
and revoking app access use the separate trusted window; ordinary project views
cannot retrieve stored values. Replacement does not revoke the old credential at
its provider: complete issuer-side revocation before resuming affected work.
Locked/unavailable Keychain storage fails without a plaintext fallback.

Integrations must use [scoped credential handles](../src/security/credentials.ts)
and [safe-record admission](../src/security/recording.ts) before persistence,
display or model delivery. Retired-value removal requires verified containment
and a completed rescan; saving a replacement alone is insufficient. Live adapters,
OS isolation, remote/native-history remediation and signed-update distribution
still require integration and qualification.
