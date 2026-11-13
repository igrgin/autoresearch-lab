# Build and run on macOS

The first supported build target is **Apple Silicon (arm64), macOS 15 or later**.
Intel, Windows and Linux builds are not qualified. The shell currently provides
Projects, Runs and Compute navigation with empty states; project creation,
provider connections, agents and training are separate implementation tasks.

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

`build` runs TypeScript checking, linting, webpack compilation, native-module
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
`npm run check` for the fast source checks or `npm run package` for just the app.

## Packaged smoke check and CI

After building, run:

```sh
npm run smoke
```

This launches the actual packaged executable in a temporary user-data directory,
checks native SQLite loading in the utility coordinator, all three navigation
pages, renderer isolation, native window close/reopen and normal app quit. It
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
Issue #18's actual runs and local evidence are recorded in
[its implementation evidence](egm/implementation/18-build-evidence.md).

## Host boundaries and follow-up work

The React renderer has no Node access; a sandboxed preload exposes only
`lab.getStatus()`. Main owns native windows and the utility-process lifecycle.
The utility coordinator loads `better-sqlite3` and checks the actual SQLite
runtime is at least 3.51.3, using an in-memory database only. Durable registry and
per-project history schemas/migrations, adapters, credentials, active-run close
handling and remote supervision belong to their dependent tasks; no placeholder
protocol or outcome rules are imposed here.

These boundaries follow the complete decisions in
[#15](https://github.com/igrgin/autoresearch-lab/issues/15#issuecomment-6866989510)
and [#16](https://github.com/igrgin/autoresearch-lab/issues/16). The main/preload,
renderer and coordinator entrypoints stay separate so platform-specific host
code does not become a renderer or shared integration dependency. Future targets
still require their own native module, packaging and lifecycle qualification.
