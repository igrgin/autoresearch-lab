# Issue 45 implementation evidence

Scope: [#45](https://github.com/igrgin/autoresearch-lab/issues/45), based on
`2c00e165237114998b49dcbc4f319a72eb0d54b8`. The implementation checkout is
`t3-9d4ba547`, branch `45-codex-auth-model`, with the expected GitHub origin and
a distinct worktree from the coordinator and other tasks. No other checkout was
edited. This is an implementation/review record, not a new design specification.

## Decision inputs

Read the checkout instructions, shared agent/GitHub workflows, approved
[concepts brief](../../designs/concepts_brief.md), [sitemap](../../designs/SITEMAP.md),
[build guidance](../../BUILD.md), and full live issue bodies/comments for
[#44](https://github.com/igrgin/autoresearch-lab/issues/44),
[#21](https://github.com/igrgin/autoresearch-lab/issues/21),
[#16](https://github.com/igrgin/autoresearch-lab/issues/16), and
[#17](https://github.com/igrgin/autoresearch-lab/issues/17). The four final numbered
#16 decisions govern shared ownership; the older document summaries are superseded.
The final live recheck found #45 open, assigned to `igrgin`, no comments, and both
native prerequisites closed. Full #16/#17 payloads remained byte-identical to the
inspected inputs; #44 was reread in full. No new decision publication was needed.

## Delivered boundaries

- [Settings and Runs UI](../../../src/renderer/codex-settings.tsx) use the actual
  sandboxed preload/main/coordinator entrypoints. The existing trusted credential
  window supplies synthetic or user-entered OpenAI keys to the existing encrypted
  vault. Ordinary UI receives metadata/references only.
- [Auth host](../../../src/codex/host.ts) binds the real `codex_auth` component,
  selected account/reference and operation-scoped credential capability. Its
  temporary scope nonces authorize global settings requests; no project/run
  records are fabricated for authentication. Each catalog request closes its
  authenticated process before returning. Replacement/revocation aborts in-flight
  access and subsequent work reauthenticates through the vault.
- [Private stdio transport](../../../src/codex/stdio.ts) supervises the exact
  official 0.169.0 macOS arm64 runtime, verifies binary SHA-256
  `739cda86e15d30a6e2b40cf8dcbbfb988aaf48b305b27065573bb8e9fd41d002`,
  uses an explicit environment allowlist and private home/state/tmp/cwd, and pins
  ephemeral storage, API-key authentication and the OpenAI provider. Only
  initialize/config-read/login/account-read/model-list calls are admitted. No
  thread, turn or tool execution method is available.
- Pre-login configuration inspection rejects nonempty inherited configuration
  and incompatible effective auth/provider settings. An absent `disabledReason`
  is an active layer, just like null; this matches observed runtime serialization.
  Auth bodies, notifications and stderr never enter application capture.
  Fixed-code diagnostics correlate failures by operation identity.
- [Catalog admission](../../../src/codex/catalog.ts) consumes every page, excludes
  hidden entries, preserves returned model IDs/efforts/defaults/modalities and
  admits semantic strings through the shared sanitizer. Bad/partial catalogs
  cannot be selected. Unsafe semantic metadata is withheld rather than rewritten.
  Stored metadata is rechecked against current credentials before UI disclosure.
- [Coordinator-owned storage](../../../src/codex/store.ts) writes a separate
  `codex-settings.sqlite`, without changing existing registry/history schemas.
  Global defaults and immutable per-project agent-selection revisions contain
  credential references only. Project identity is resolved through the catalog;
  expected revision prevents stale saves. These records are the agent portion of
  future run configuration, not a claim that complete runs can launch today.
- Model selection never proves entitlement or silently upgrades a missing model.
  Catalogs and saved records explicitly retain `entitlement: unverified`.
  Intended inference, effective/rerouted model handling, action isolation and
  bounded execution remain #46 and its dependent work.

Request bindings are generated from that exact binary with
`node scripts/generate-codex-protocol.mjs`, using a clean temporary state directory.
The [official protocol guide](https://learn.chatgpt.com/docs/app-server) and pinned
[configuration-layer source](https://github.com/openai/codex/blob/rust-v0.169.0/codex-rs/config/src/loader/README.md)
were checked. Upstream license/notices ship beside the runtime.

## Acceptance and failure evidence

[Codex tests](../../../tests/codex.test.ts) run in the normal `npm test` execution.
They exercise controlled subprocess JSON-RPC, multi-page catalogs, immutable
selection/default persistence across reopen, invalid IDs/efforts, removed models,
unauthorized and quota failures, logged-out state, malformed/oversized responses,
repeated cursors, secret-bearing metadata, unsafe storage/inherited config,
revocation during a request, wrong credential category/reference, runtime
checksum failure, restored metadata rechecking, unavailable sanitizer and invalid
Unicode. UI replies, diagnostics, SQLite and WAL/SHM checks exclude synthetic keys.
The bundled runtime is also exercised for initialization, configuration inspection
and account/read without authentication or inference.

[Packaged smoke](../../../scripts/smoke-codex.mjs) exercises the actual Settings
and Runs UI, dedicated Keychain-backed entry, preload admission, private RPC
transport, coordinator persistence and full app restart. The privileged test
harness replaces only subprocess spawning with a controlled stdio fixture;
production retains binary verification and has no runtime test override. Missing
models stay selected/unavailable, denied access preserves the saved snapshot,
unrelated renderers cannot call Codex IPC, and raw synthetic keys remain absent
from UI, diagnostic projections and database bytes. Evidence is written to
`out/smoke/codex.json` locally and uploaded by existing CI after successful smoke.

Final validation: `npm run check` passed TypeScript, ESLint, 37 catalog/Codex
checks and 47 security checks (84 total); `npm run make`, `npm run smoke` (both
packaged suites), ZIP integrity and `git diff --check` passed. Packaged acceptance
reported all five Codex outcomes as passed, with the fixture/live-inference
limitation explicitly recorded. These results are also recorded in the PR and
delivery report. Live API-key
validity, service/model entitlement, paid inference, authenticated native-runtime
persistence, action sandboxing and GPU work were not exercised. No host credential,
subscription cache, provider lifecycle operation or paid resource was used.

## Self-review and integration surface

Reviewed the complete diff for acceptance, credential delivery/recording, process
lifetime, incomplete catalogs, stale/revoked access, persistence/recovery and real
application entrypoints. No other worker branch was imported. Saved snapshots
remain unchanged by default/auth edits and failed saves. The shared credential
service's authorization contract is unchanged; its matcher is exposed only to the
trusted host, never the renderer.

Overlap with parallel work is limited to application glue/build files:
`src/main.ts`, `src/coordinator.ts`, `src/preload.ts`, `src/shell.ts`,
`src/renderer/index.tsx`, `src/renderer/style.css`, `src/security/electron-vault.ts`,
`package.json`, `package-lock.json`, `forge.config.cjs`, `scripts/test.mjs`,
`webpack.tests.config.cjs` and `docs/BUILD.md`.
New interfaces are `ShellBridge.codex`, `CodexStoreCommand`, `AgentChoice`,
`AgentSnapshot`, and `CodexHost`; all new adapter/UI/test files are issue-specific.
Runtime upgrades need explicit checksum/protocol qualification and storage
compatibility review. The unsigned internal package and strict rejection of
inherited Codex configuration remain operational limitations.
