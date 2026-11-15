# Build and run on macOS

The first supported build target is **Apple Silicon (arm64), macOS 15 or later**.
Intel, Windows and Linux builds are not qualified. The workspace supports project creation, persisted listing and reopening. Runs
and Compute provide empty states; provider connections, agents and training
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

`build` runs TypeScript checking, linting, catalog/recovery tests, webpack compilation, native-module
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
`npm run check` for source checks and catalog tests, `npm test` for catalog tests
alone, or `npm run package` for just the app. Tests use Electron's embedded Node
runtime and the same native SQLite payload as the packaged coordinator.

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
project identity/repository, and checks unavailable-folder restoration. It
writes `out/smoke/result.json` and `out/smoke/workspace.png`, then removes its test
profile. Playwright controls Electron directly; no browser install is needed.
It does not prove active-run Pause or remote recovery, which the shell cannot yet
exercise.

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

## Project storage and recovery

The utility coordinator stores `registry.sqlite` under Electron's application-data
folder (`app.getPath('userData')`) and creates projects under its
`workspace/projects/` folder. The form displays this projects location. Project
names are separate from folder names and opaque UUID identities. Folder names
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
restoring its original files and choosing **Open** retries validation. The app
does not recreate missing files for a previously ready project. Open displays the
project identity, files location and repository location; a code editor and task
setup are separate work.

Stores use versioned, checksummed SQL initialization, WAL, FULL synchronization,
foreign keys and a bounded busy timeout. A newer/unknown schema is rejected
without resetting it. This initial slice adds version 1 only; future upgrades
must add consistent backups and transactional forward migrations. Use supported
local storage only: network and sync-folder operation, power-loss durability,
and moving/backup UX remain unqualified. SIGKILL recovery tests do not prove
power-loss or disk-full safety.

## Host boundaries and follow-up work

The React renderer has no Node access; a sandboxed preload exposes status and
four typed catalog operations (list/create/open/recover). Main validates the
requesting window/frame and owns native windows and utility-process lifecycle.
The utility coordinator owns all registry/history, filesystem and Git work,
requires actual SQLite 3.51.3 or later, and serializes requests. No raw SQL or
filesystem operation is exposed through the preload. The project history schema
currently contains identity only; run history, adapters, credentials, active-run
close handling and remote supervision belong to their dependent tasks.

These boundaries follow the complete decisions in
[#15](https://github.com/igrgin/autoresearch-lab/issues/15#issuecomment-6866989510)
and [#16](https://github.com/igrgin/autoresearch-lab/issues/16). The main/preload,
renderer and coordinator entrypoints stay separate so platform-specific host
code does not become a renderer or shared integration dependency. Future targets
still require their own native module, packaging and lifecycle qualification.
