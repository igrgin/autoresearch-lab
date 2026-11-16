# Build and run on macOS

The first supported build target is **Apple Silicon (arm64), macOS 15 or later**.
Intel, Windows and Linux builds are not qualified. The workspace supports project creation, persisted listing, reopening, global/project defaults, saved run configurations and recoverable local dataset imports. Compute discovers existing Runpod GPU Pods and Vast.ai instances. Credential settings use a separate trusted window; research execution, agents and training
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
The Runpod suite exercises the real adapter against controlled REST-v2 responses;
it does not access a Runpod account or establish GPU/SSH readiness.

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
also intercepts the main-process Runpod HTTPS transport to exercise the scoped vault,
pagination, Pod details, invalid credentials, partial discovery with last-good observations,
and complete empty results through Compute. This is fixture evidence, not a live service check. It
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
whose content and identity still match. Durable deletion intents reconcile crashes
between unlink and progress recording. Non-recursive directory removal preserves
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

## Runpod discovery

Open **Compute → Credential settings**, save a Runpod API key with `account:read`
and `pods:read` access, then choose **Refresh credentials → Connect and discover**.
The adapter uses only HTTPS GET on the fixed REST-v2 account, Pod list and Pod detail
routes. It reads all cursor pages before showing a complete empty result, and lists
only RUNNING GPU Pods. Canonical identity is `runpod` plus Pod ID; account IDs and
credential labels are access metadata, so replacing a key does not rename a Pod.

Failed refreshes show an explicit incomplete/error state. The current view keeps its
last complete observation with its receipt time and marks current access/state unknown.
Choose Refresh Pods to retry; rate-limit responses enforce the indicated retry time.
Refresh details obtains a new account/Pod observation and distinguishes absent from
reported-but-unverified direct SSH metadata. A 404 means missing or inaccessible,
not confirmed deletion. Provider GPU type/count and system RAM are allocation metadata;
they do not establish GPU UUIDs, usable VRAM, CUDA/PyTorch, SSH/SFTP or execution readiness.

Discovery observations and selected credentials are kept only in the current view's
memory. After navigation/restart, choose a saved credential and discover again; vault
references survive restart, and each observation retains the same canonical Pod key.
No registry/project schema or reservation state is changed. The adapter withholds raw
responses, environment, command strings, endpoints and vendor error bodies; it validates
allowlisted fields with the shared sanitizer before IPC/display. If a required field
cannot pass admission, discovery is incomplete rather than silently changing identity.

## Vast.ai connection and discovery

Open **Compute → Credential settings**, save a Vast.ai API key with `instance_read`
permission, then select it in Compute and choose **Connect and discover**. Use
**Reload credentials** after changing settings. The app sends read-only HTTPS GETs
to `console.vast.ai`, requests safe listing columns, and follows every v1 cursor
with at most 25 instances per page. It bounds each scan to 100 pages/45 seconds,
each request to 10 seconds, and each response to 1 MiB. Transport/429/5xx retries
are finite; a long `Retry-After` returns a retry-later error instead of retrying early.

Results show canonical contract identity (`vast:<contract ID>`), separate actual,
intended and contract states, and advertised GPU/count, effective CPU and disk
information. Missing/sentinel values stay unavailable; provider GPU memory units,
remote device UUIDs, SSH and execution readiness remain unverified. This is
discovery, without GPU assignment, reservations, SSH, or provider lifecycle calls.
The [same-model replacement amendment](https://github.com/igrgin/autoresearch-lab/issues/39#issuecomment-6866658509)
remains an input to later assignment work; discovery imposes no UUID lock.

Only a complete successful scan establishes **No running Vast.ai instances** for
the selected credential. A failed refresh keeps the last successful in-memory list
visibly stale, including a stale previous empty scan. Discovery results are not
persisted as research history. Restart retains encrypted API credentials and their
account association; reconnect explicitly to read current provider state.
Replacing a credential preserves account and canonical resource identity.

Bad API keys, denied scope, provider-requested 2FA, expired sessions and service
failures have distinct safe feedback. If the service requires 2FA, complete Vast's
supported login externally and enter its **provider-issued session credential**
under the selected API key's **Vast.ai two-factor session** section in trusted
Credential settings. See [Vast's 2FA procedure](https://docs.vast.ai/cli/two-factor-authentication).
The app does not read CLI auth files or collect passwords, OTPs, recovery codes or
TOTP seeds. Sessions stay in the shared credential service's memory; their access ends
on expiry, key replacement/revocation or restart. Protected matching material can
remain in process memory until exit. After expiry, a later explicit
scan uses the saved API key unless a new session was entered.

The [Vast fixture suite](../tests/vast.test.ts) runs in `npm run check`.
`npm run smoke` also executes [packaged Vast acceptance checks](../scripts/smoke-vast.mjs),
with HTTP replaced by controlled fixtures through the actual settings, host,
credential service, adapter, preload and Compute UI. Evidence is written to
`out/smoke/vast-result.json`. These checks do not prove live account permissions,
2FA behavior or compatibility on a real rental. No host credentials or paid
resources are used.
