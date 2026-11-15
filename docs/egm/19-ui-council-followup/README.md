# Issue 19 UI council follow-up

Stopped after the new ten-round cap. The requirement that every council member score both UI functionality and appearance at least 9.5/10 was not met. Final scores were Sol **8.8 / 9.0**, Astra **8.6 / 8.7**, Terra **8.5 / 8.5**. No product changes followed Round 10.

## Review protocol

Each round used three fresh read-only Codex delegates, one each for GPT-6.1 Sol, GPT-6 Astra and GPT-6.1 Terra, all at high reasoning effort. Their only grading context was a brief application/task explanation, a short factual change list, the definitions of 1 and 10, and two previous/current image pairs. Prompts excluded the target score, stopping condition, previous scores, reports, code and tests.

Round 1 used the previous cycle's Round 10 images for comparison. Later rounds used this cycle's immediately preceding pair. Only the current design was scored. Each numbered directory preserves its exact prompt, 3 verbatim reports, 3 structured delegate responses and capture hashes. [All scores](score-table.md), [machine-readable scores](scores.json), and [interactive score plot](report.html). The [initial cycle](../council-ui/README.md) remains a separate historical record with a different review protocol.

## Changes

- Compacted project/location presentation and kept the saved list beside creation/current-project panels.
- Added relative recency with exact timestamps on hover, consistent folder identifiers and emphasis on differing suffixes.
- Clarified Open project versus Finder access, showed opening/copy feedback, and aligned path disclosures.
- Identified the project folder as the Git working repository, kept readiness visible, exposed Git-metadata path copying and grouped advanced metadata/identity utilities.
- Added narrowly typed Git-folder reveal/copy actions. Main resolves and validates catalog identities; renderer code cannot supply arbitrary native paths or clipboard text.

## Remaining findings

All final reviewers found the distinction between **Copy project path** and **Copy Git path** unclear. They do copy different locations: the working project directory and its **.git metadata directory**, respectively. Smoke verifies those exact destinations; the UI labels remain a design limitation.

Other findings concern the subtle duplicate-name suffix, the wrapped creation location label, small path controls, and repeated identity/status text. A rename/description feature suggested by one reviewer was not added to this create/reopen issue. These are recorded, rather than changed after the cap.

## Verification

[Build output](build.log) records passing typecheck, ESLint, 17 real SQLite/filesystem/Git tests and macOS arm64 app/ZIP creation. Coverage includes distinct project identities/repositories, restart/reopen, conflicts and symlinks, unwritable locations, unavailable/replaced files, unknown schemas, and SIGKILL recovery at eight checkpoints. ZIP integrity passed.

[Native smoke output](smoke.log) and [results](smoke-results.json) cover creation/conflict protection, restart/reopen, unavailable-folder restoration, search, persisted UI recency, canceling creation, path disclosure, native close/reopen/quit, sandboxing, project/Git Finder dispatch, project/Git/workspace clipboard dispatch and invalid-ID rejection. Finder and clipboard endpoints are stubbed in smoke; real catalog validation runs. Tests do not open Finder or replace the user's clipboard. Capture runs reported no renderer page/console errors.

[Source/package fingerprints](verification.json) bind the reviewed product files and packaged app to these checks. Power-loss, disk-full, network/sync storage, move/backup UX and external distribution remain unqualified. Screenshot reviews grade visible interaction design and appearance, not runtime correctness.

## Screenshot provenance and cleanup

The genuine Before capture comes from the unchanged PR-base CI package at acfdada4d42d06f556dc0b96e6d3e282eadf85ac, [run 43741488909](https://github.com/igrgin/autoresearch-lab/actions/runs/43741488909). The [original provenance](../implementation/19-ui-evidence/provenance.json) retains package and ASAR hashes. Its PNG was verified byte-for-byte against pre-follow-up commit c811e7f5859ea132c491a39373bf611ece24e925.

After captures came from the genuine locally packaged application, at the same 1180×838 content size, driven by Playwright with no pixel editing, DOM substitution or style injection. Three synthetic projects were created through the UI, persisted, and reopened after a full process restart; the original identity was revalidated. [Capture driver](capture.mjs). From Round 7, two projects share a name with distinct folders; disposable recency preferences were explicitly seeded at 30 minutes, 2 hours and one day. Those timestamps demonstrate UI presentation and are not claimed real past activity. Screenshots were visually inspected and contain no credentials or personal project data.

At the user's request, generated screenshot files and the older supplemental image archive are removed from the checkout and branch head after this capped review. The [cleanup manifest](image-cleanup.json) records every removed file/hash and the historical image snapshot commit. It also records archive members. Text reports, captured-source provenance and build logs are preserved. Required rendered Before/After PR images use raw URLs pinned to historical commits, so the PR remains reviewable after local image deletion. Git history is not rewritten. Downloaded original CI artifact screenshots and application-owned assets are preserved as captured sources, not newly generated review images.
