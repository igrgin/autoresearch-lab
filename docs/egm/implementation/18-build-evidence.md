# Issue #18 — first desktop build evidence

Scope: [#18](https://github.com/igrgin/autoresearch-lab/issues/18), based on
`cea79a40b801c6f9fe589a5461bdef5b993e66fc`. The prepared worktree's assigned
branch is `t3/9a84bbea`. No other checkout or branch was changed.

Read the full [concepts brief](../../designs/concepts_brief.md),
[sitemap](../../designs/SITEMAP.md), live #18 and all comments on closed
[#15](https://github.com/igrgin/autoresearch-lab/issues/15) and
[#16](https://github.com/igrgin/autoresearch-lab/issues/16), including their
superseding numbered complete decisions. Archived inputs and publication
snapshots remain unchanged.

## Implementation boundary

- Electron/TypeScript/React shell with Projects, Runs and Compute navigation.
- Main owns native windows and single-controller admission; sandboxed preload
  exposes one read-only status query, validating the calling main frame.
- Utility process qualifies `better-sqlite3` against an in-memory database and
  requires actual SQLite >=3.51.3. No durable product schema is introduced.
- Forge 8/webpack packages main and utility as distinct `.cjs` entrypoints.
  The arm64 build alias selects SQLite 13's platform entrypoint, with the native
  binary explicitly unpacked from ASAR. Native relocation applies only to host
  code; applying it to React introduced a browser `__dirname` error during
  development, caught and corrected by the packaged smoke check.
- Product settings/history, contracts, credentials, agent/provider operations,
  lifecycle policies and remote enforcement remain with their owning tasks.
  No active run can be created, and no provider lifecycle API is present.

## Local qualification (2026-11-14, Europe/Zagreb)

Host: Apple Silicon arm64, macOS 26.6.2 (25G83), Apple Command Line Tools.
Build tools: Node 24.22.3, npm 10.9.0; Electron 45.3.2, Forge 8.0.1,
React 19.3.1, TypeScript 5.9.3, `better-sqlite3` 13.1.1.
Exact direct/transitive versions are locked.

Executed successfully:

- `npm run build`: TypeScript, ESLint, webpack, native preparation, Forge app
  packaging and ZIP making.
- `unzip -tq "out/make/zip/darwin/arm64/Autoresearch Lab-darwin-arm64-0.1.0.zip"`:
  no compressed-data errors.
- `npm run smoke`: packaged executable launch, Projects/Runs/Compute navigation,
  ready preload/utility bridge, no renderer Node globals, sandbox/context
  isolation enabled, native window close, macOS activation/reopen, normal quit
  with exit code 0. Actual utility SQLite version: **3.54.1**.
- Inspected `out/smoke/workspace.png`: complete legible empty workspace,
  selected Projects navigation and Workspace ready status.
- Verified the native `.node` exists in `app.asar.unpacked`, outside the archive.
- `npm audit --omit=dev`: **0 vulnerabilities**. Full audit reports **11 moderate
  development-tool findings**, in Forge webpack's dev-server/sockjs/uuid and
  typescript-eslint/minimatch chains. No broad forced dependency substitution
  was made; these are dependency maintenance concerns, not production runtime
  findings. No high/critical findings were reported.
- `npm start`: development app opened, read-only bridge returned SQLite 3.54.1,
  and Runs navigation rendered. Browser HMR injection is disabled because its
  preload client requires unavailable sandbox modules; native View → Reload is
  documented instead. Development CSP uses no eval and the server binds localhost.
- `git diff --check`: passed.

The coding host exports `ELECTRON_RUN_AS_NODE=1`; the smoke runner explicitly
removes it from the child environment so Electron starts as a desktop app.
This is confined to the test harness and does not alter the user's environment.

Removed the previous generated output from the build path, ran a fresh
`npm ci` (619 packages installed), and reran `npm run build`: both passed.
CI attempts and their external blocker are recorded below. Build commands and output paths are documented in
[BUILD.md](../../BUILD.md).

## Limits

Unsigned internal macOS arm64 build only. Signing/notarization, Intel and other
OS targets, clean-machine distribution, durable migrations/storage recovery,
active-run close/Cancel/Cmd+Q and remote safeguards remain unqualified. Local
native close/normal quit with an empty workspace is not active-run lifecycle
proof. No adapters, cloud account, model or GPU execution was exercised.

Current official setup references consulted:
[Forge webpack](https://www.electronforge.io/config/plugins/webpack),
[ASAR/native unpacking](https://www.electronforge.io/config/plugins/auto-unpack-natives),
[Electron utility process](https://www.electronjs.org/docs/latest/api/utility-process),
[GitHub arm64 runner labels](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
Installed Forge 8 configuration/source and SQLite 13 platform exports were also
inspected to verify the exact pinned behavior instead of relying on old templates.

## Live CI attempts and remaining acceptance checks

The [initial implementation run](https://github.com/igrgin/autoresearch-lab/actions/runs/43531091694)
and [deliberate failure-probe run](https://github.com/igrgin/autoresearch-lab/actions/runs/43531111842)
both concluded failure **before any job steps ran**. GitHub's check annotations
state: **"The job was not started because your account is locked due to a billing
issue."** Each job had an empty steps array, no assigned runner and zero artifacts.
The runner-capacity notice is secondary; the billing lock is the explicit blocker.
Selected API evidence is preserved in [18-ci-attempts.json](18-ci-attempts.json).
No account, billing or provider resource settings were changed.

The temporary probe commit `be569aeb20aa4d2d74c79b697e8b0c4e48dc5f40`
introduced `export const deliberateBuildFailure: string = 18;` in a separate
source file. With prior build output moved out of the build path, local
`npm run build` rejected it with TypeScript **TS2322**, exit code **2**, before
Forge packaging; `out/make` did not exist. The probe was reverted in a separate
commit. This proves local failure propagation only; a pre-run account failure
cannot prove the CI build-error path or successful artifact upload.

Acceptance status:

- Clean dependency install, documented build and packaged macOS launch: **passed
  locally**, including navigation, native SQLite, isolation and empty-workspace
  native close/reopen/quit. CI's clean checkout could not execute.
- CI successful build with intended output: **blocked by GitHub account billing**.
- CI deliberately broken build fails at compilation and skips artifact upload:
  **blocked by the same billing issue**, despite the probe being submitted.

After the GitHub account is unlocked, rerun the current valid PR build and check
its ZIP plus smoke evidence. Repeat the temporary-error procedure in
[BUILD.md](../../BUILD.md), confirm TS2322 in the build step and zero artifacts,
revert the probe and finish with a green build. The issue stays open and the PR
is not merged; these two CI acceptance checks must not be marked passed yet.
