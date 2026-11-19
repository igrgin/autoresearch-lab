# Build and run on macOS

The first supported build target is **Apple Silicon (arm64), macOS 15 or later**.
Intel, Windows and Linux builds are not qualified. The workspace supports project creation, persisted listing and reopening. Runs
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

`build` runs TypeScript checking, linting, catalog/recovery and synthetic security tests, webpack compilation, native-module
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
`npm run check` for source checks and both catalog and security tests, `npm test` for both suites
alone, or `npm run package` for just the app. Catalog tests use Electron's embedded
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
It does not prove active-run Pause or remote recovery, which the shell cannot yet
exercise.

[macOS CI](../.github/workflows/macos-build.yml) runs on pushes to `main`.
It checks the arm64 runner, installs from the lockfile, runs the same build and
smoke commands, and uploads the ZIP plus smoke evidence as
`autoresearch-lab-macos-arm64`. Upload runs only after every preceding step
succeeds, with missing output treated as an error. A failed check/build/launch
fails the job and publishes no build artifact.

Before requesting a merge, run the applicable local checks on the exact
candidate and record its revision and results in the PR. For packaged behavior,
run `npm run build` and `npm run smoke`. Pull requests have no hosted macOS
build. Check the main build and artifact after a merge you are operating.

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

Stores use versioned, checksummed SQL initialization, WAL, FULL synchronization,
foreign keys and a bounded busy timeout. A newer/unknown schema is rejected
without resetting it. This initial slice adds version 1 only; future upgrades
must add consistent backups and transactional forward migrations. Use supported
local storage only: network and sync-folder operation, power-loss durability,
and moving/backup UX remain unqualified. SIGKILL recovery tests do not prove
power-loss or disk-full safety.

The project list supports search and sorting by recently opened, name or creation
time. Last-opened times are disposable local UI preferences, stored in the
renderer profile. They are not research history or authoritative project records;
clearing that UI cache loses recency cues without affecting projects or their
identities. Copy feedback is scoped to the project whose location or Git path was copied.

## Host boundaries and follow-up work

The React renderer has no Node access; a sandboxed preload exposes status and
four typed catalog operations (list/create/open/recover) and five narrow native
actions (reveal validated project or Git folders, copy either validated path, and
copy the known workspace projects path). Main validates the
requesting window/frame and owns native windows and utility-process lifecycle.
Main resolves native-action locations through the catalog; the renderer never
supplies an arbitrary native path or clipboard payload. The utility coordinator
owns all registry/history, filesystem and Git work,
requires actual SQLite 3.51.3 or later, and serializes requests. No raw SQL or
filesystem operation is exposed through the preload. The project history schema
currently contains identity only; run history, adapters, active-run
close handling and remote supervision belong to their dependent tasks.

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
