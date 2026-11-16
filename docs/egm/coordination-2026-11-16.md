# Ten-issue implementation coordination

This is implementation/review evidence for the user's authorized ten-issue scope, not a design specification. T3 project binding, repository, remote, clean coordination worktree and latest main were verified before dispatch. Each worker used delegate_task isolation:"worktree", inherited model/settings and no child delegation. Before each issue, gh api user verified igrgin, assignment was added/read back, and native blockers were closed. No PR was merged or issue closed.

The coordinator and workers consumed checkout guidance, shared agent/GitHub workflows, concepts brief and sitemap. Briefs required full live decisions/amendments, acceptance/failure checks, distinct-checkout verification, safe credentials, one branch/PR, self-review and the PR skill. Individual issue records preserve detailed evidence and limits.

## Review order and workspaces

Each PR after the first is based on the preceding implementation branch. This preserves one issue's review diff while resolving shared application glue. Workspaces are under /Users/igrgin/.t3/worktrees/autoresearch-lab/. All ten were clean and their local/remote heads matched before lease-protected stack updates.

| Issue | Branch | Base | PR | Workspace/worker |
| --- | --- | --- | --- | --- |
| #20 | `20-manage-project-defaults` | main | [#107](https://github.com/igrgin/autoresearch-lab/pull/107) | `t3-da8b66aa` |
| #55 | `55-reserve-compute` | https://github.com/igrgin/autoresearch-lab/pull/107 | [#111](https://github.com/igrgin/autoresearch-lab/pull/111) | `t3-a1381a7a` |
| #87 | `87-retain-research-records` | https://github.com/igrgin/autoresearch-lab/pull/111 | [#115](https://github.com/igrgin/autoresearch-lab/pull/115) | `t3-beba70f2` |
| #23 | `23-import-local-data` | https://github.com/igrgin/autoresearch-lab/pull/115 | [#113](https://github.com/igrgin/autoresearch-lab/pull/113) | `t3-70084c17` |
| #35 | `35-discover-runpod-pods` | https://github.com/igrgin/autoresearch-lab/pull/113 | [#109](https://github.com/igrgin/autoresearch-lab/pull/109) | `t3-f765ebc4` |
| #40 | `40-discover-vast-instances` | https://github.com/igrgin/autoresearch-lab/pull/109 | [#110](https://github.com/igrgin/autoresearch-lab/pull/110) | `t3-5316de55` |
| #45 | `45-codex-auth-model` | https://github.com/igrgin/autoresearch-lab/pull/110 | [#114](https://github.com/igrgin/autoresearch-lab/pull/114) | `t3-9d4ba547` |
| #50 | `50-claude-auth-model` | https://github.com/igrgin/autoresearch-lab/pull/114 | [#116](https://github.com/igrgin/autoresearch-lab/pull/116) | `t3-2efbe98f` |
| #60 | `60-bound-stuck-execution` | https://github.com/igrgin/autoresearch-lab/pull/116 | [#112](https://github.com/igrgin/autoresearch-lab/pull/112) | `t3-d869e6a7` |
| #62 | `62-select-training-checkpoints` | https://github.com/igrgin/autoresearch-lab/pull/112 | [#108](https://github.com/igrgin/autoresearch-lab/pull/108) | `t3-45ba5887` |

## Coordinator corrections and integration

- Fixed #23's unsupported-entry error, which included an unadmitted nested filename before credential-name admission. The diagnostic now omits it. A regression checks synthetic secret exclusion from SQLite/WAL, UI projections and reopened records.
- Composed Runpod and Vast as explicit Compute tabs; Vast smoke selects its tab.
- Preserved defaults/imports, both agent settings and run-agent views, narrow host/preload/utility routes, current-policy admission, the single database writer and reservation migrations. Configuration/import/agent/research stores remain independently versioned.
- Combined all test bundles/crash fixtures, smoke entrypoints, native agent payloads and guardian bundle.
- Fixed the combined preload object boundary. Scoped Codex smoke's Manage API keys locator to its panel after both agents made the global locator ambiguous. The pending window wait is observed with the click, preventing it from masking a locator failure.
- Coordinator inspected each implementation's consequential boundaries; this does not imply a GitHub approval review.

## Combined validation

Node 24.22.3, macOS arm64, Electron 45.3.2:

- npm ci passed with the combined lockfile.
- npm run check passed typecheck, lint and **269 tests**, zero failures/skips: 165 catalog/defaults/reservations/history/import/provider/agent/checkpoint; 55 security/Runpod; 2 native Claude; 47 execution-bound.
- npm run make and ZIP integrity passed, including both agent payloads and the guardian.
- Main packaged smoke passed defaults/configuration restart, import recovery/conflicts, reservation utility IPC/restart, Runpod fixtures, offline native Claude worker/settings/run inputs, sender/Keychain isolation, native window lifecycle and SQLite 3.54.1.
- Packaged Vast smoke passed pagination, separate states, empty/stale views, authentication/2FA/session expiry, secret exclusion, restart and IPC authorization.
- Packaged Codex smoke passed after the panel-locator correction: model selection, immutable choice/restart, missing/unauthorized models and credential-free diagnostics. Its subprocess uses controlled fixtures.
- Final lint and whitespace passed. Autosquashing preserved the validated code tree; only this delivery record was added afterward.

Temporary source/build/test logs remain outside the repository. Packaged evidence is in out/smoke/; the ZIP is in out/make/zip/darwin/arm64/.

## Qualification and CI limits

No live service account, paid inference, GPU training, SSH/SFTP, remote containment, power-loss or physical disk-full qualification was performed. Ports fail closed when trusted preparation/execution/stop evidence is unavailable. Move cleanup awaits later preparation confirmation; checkpoint loading requires a trusted adapter. Full run preparation/dispatch remains later issue scope. Guardian-death and arbitrary Linux/macOS containment remain qualification obligations. The internal macOS build is unsigned.

The Claude worker preserved an earlier native-close smoke intermittency. The combined lifecycle check passed; this does not identify the earlier cause.

The initial #112 GitHub job executed no steps: GitHub reported hosted macOS arm64 runner capacity exhaustion. A failed-job rerun was requested. This is an external capacity failure, not a passing check or demonstrated code failure. Stack pushes trigger independent checks on new heads; pending/cancelled checks remain explicit.
