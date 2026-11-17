# Issue 45: round 3 repair evidence

Scope: PR114-R3-F01 and PR114-R3-F02 from the parent-owned round-3 PR114 review bundle. The original reviewer observations remain unchanged. This record adds executed evidence and implementation corrections; it is not a new spike decision or a review approval.

## Authority and isolation

Read the checkout's AGENTS.md, shared agent/GitHub workflows, approved concepts brief and design sitemap. Read the current bodies and all comments for issues [45](https://github.com/igrgin/autoresearch-lab/issues/45), [44](https://github.com/igrgin/autoresearch-lab/issues/44), [21](https://github.com/igrgin/autoresearch-lab/issues/21), [15](https://github.com/igrgin/autoresearch-lab/issues/15), [16](https://github.com/igrgin/autoresearch-lab/issues/16), [17](https://github.com/igrgin/autoresearch-lab/issues/17), and [20](https://github.com/igrgin/autoresearch-lab/issues/20) through `gh issue view --json body,comments`. The dispatch explicitly delegated assignment/publication to the parent and authorized only local repairs, checks, evidence and commits.

Before edits, pwd and Git root agreed on the distinct T3-prepared `t3-026d00cd` checkout, branch `t3/026d00cd`, HEAD `e2ebce5ca050594e55d51abdaae35cfb664a8f20`. Both origin URLs were `https://github.com/igrgin/autoresearch-lab.git`. `git worktree list --porcelain` identified the separate registered product root and parent coordinator checkout. The prepared checkout was clean; no branch/worktree was created or switched.

The governing contracts require API-key-only Codex authentication, complete catalogs with exact canonical model/effort choices, current/recently retired credential matching before publication, immutable selections, safe recovery identities, and durable deduplication with truthful uncertain effects. Catalog membership remains distinct from inference entitlement. No inference or research action is introduced.

## Executed failures before repair

Added controlled regressions to [codex.test.ts](../../../tests/codex.test.ts) before changing production code, compiled with the existing webpack test configuration, and executed the bundled Codex tests using the pinned Electron with `ELECTRON_RUN_AS_NODE=1`, `--test --test-name-pattern=PR114-R3`.

All **8 initial regressions failed** against the starting implementation:

- **PR114-R3-F01, 6 failures:** a credential registered while waiting for a later catalog page, process close, catalog diagnostic persistence, default-save diagnostics, project-save diagnostics, or settings diagnostics still allowed unsafe metadata to be returned. The two save cases also published new durable selections instead of withholding them.
- **PR114-R3-F02, 2 failures:** the real store committed a default/project selection and the injected adapter rejected its reply; the host reported `effect: none` instead of `unknown`.

Only stdio/store timing and acknowledgement delivery were controlled. These fixtures use the real credential service, shared matching/recording, host and SQLite store. No reviewer assertion is treated as executed evidence by itself. Synthetic matching values are omitted from this record.

## Repairs

**PR114-R3-F01:** [catalog admission](../../../src/codex/catalog.ts) checks the complete aggregate, and [host publication](../../../src/codex/host.ts) re-admits after shutdown, diagnostics and settings awaits. Exact retained defaults and complete immutable snapshots receive shared identity-based rechecks. A matching-generation change during a recheck restarts it. A separate executed red/green scheduling regression also verifies that ownership acquired immediately after a credential waiter wakes defers registration without losing its matching value. The final host reply is admitted synchronously while matching policy is owned through the IPC promise handoff. Required semantic fields are withheld rather than redacted into different model choices.

[Matching-policy ownership](../../../src/security/sanitizer.ts) and the [store client](../../../src/codex/store-client.ts) keep credential matching changes out of an admitted in-flight write. Asynchronous credential registration/replacement/reload/remediation wait for ownership; synchronous matching changes fail closed. Ownership survives caller timeout. A FIFO barrier processed by the coordinator's synchronous Codex handler, a late reply, or confirmed utility exit proves the writer is quiescent before ownership is released. If matching changes after a commit, the exact durable receipt is rechecked and contained before publication; failure remains `unknown`, never a claim that the write was undone. No raw matching values are sent to the coordinator.

**PR114-R3-F02:** [store schema v2](../../../src/codex/store.ts) transactionally records each mutation's stable request identity, canonical caller intent and committed receipt together with the settings/selection write. An identical retry looks up that receipt before authentication/catalog dispatch or revision checks. Changed intent under the same identity conflicts. A retry cannot replace a newer default or append another project revision. Timeout, disconnect and ambiguous dispatch/reply failure preserve `unknown` and same-identity reconciliation; known pre-dispatch unavailability/admission rejection remain `none`. Reply transport is outside the coordinator's mutation catch, so a failed send after commit cannot produce a no-effect rejection.

The [renderer](../../../src/renderer/codex-settings.tsx) retains an unacknowledged request identity across route changes and restarts. Persistent renderer state contains only the opaque identity, not another metadata/credential copy. In-memory retries pin the original intent. Reopening uses an explicit read-only reconciliation endpoint; committed safe results are rechecked, withheld results expose only independently admitted minimal identities, and an absent receipt does not dispatch a save. Acknowledgement/containment never clears an old quarantine.

## Validation

Use `PATH=/Users/igrgin/.nvm/versions/node/v24.22.3/bin:$PATH`. Installed locked dependencies with `npm ci`; npm skipped Electron's install payload, so explicitly installed the pinned payload with `node node_modules/electron/install.js`. No dependency or lockfile version changed.

- `npm run check`: **PASS** — application/contract tests, shared security tests, native Claude qualification, execution tests, and new real Electron main/utility Codex transport fixture. Final run: 230 application/contract tests, 58 security tests, 2 native Claude tests and 60 execution tests passed; the additional 6 actual main/utility Codex transport cases also passed. No skips or failures.
- The expanded Codex regressions cover current and retired matching, every initial await boundary, policy changes during retained recheck, late exact receipts, actual ownership while registering a matching credential, dropped/rejected replies, timeout/disconnect/post-commit dispatch exceptions, pre-dispatch failure, exact retry after reopen, changed-payload conflict, and migration/backup recovery.
- The [real Electron transport fixture](../../../tests/codex-transport-main.ts) runs the production store client in Electron main against a [utility-process SQLite writer](../../../tests/codex-transport-worker.ts). Its actual timer, exit handler and rejected post-commit storage reply each recover one default and one project receipt after writer restart: **6 cases passed**, with no second revision. Controlled tests shorten the timer; production retains its 10-second timeout.
- `npm run make`: **PASS**, producing the macOS arm64 application and ZIP.
- `node scripts/smoke-codex.mjs`: **PASS**, using only isolated profiles and a controlled stdio worker. Covers the production renderer/preload/main/coordinator/vault/store, API-key-only transport/environment, sender rejection, model errors, immutable/reopened selections, quarantine and clean replacement, and pending default/project identity reconciliation after restart without another catalog dispatch or project revision.
- `git diff --check`: **PASS**. The main-only CI policy is untouched; no PR-trigger restoration or hosted check is claimed.

One earlier whole-check attempt timed out in the unchanged native Claude initialization qualification; an isolated transport launch also timed out once. Both subsequently passed; neither was hidden or repaired through unrelated changes. Another verification attempt lost a generated worker bundle because test/package builds overlapped; the final whole check was rerun sequentially with intact bundles. No native Claude/execution/guardian behavior was changed.

## Compatibility, overlaps and limits

Codex settings storage advances from schema 1 to 2 using the existing checksummed forward migration mechanism. A consistent pre-upgrade v1 backup is preserved. The regression opens that backup read-only, verifies integrity/version/history, rejects opening v2 with the old migration list, reopens the new journal receipt, restores the v1 backup into a fresh controlled directory and verifies its original immutable selection survives forward migration. Older binaries must restore the supported backup deliberately; no reverse migration/reset is provided. Existing agent snapshot schema and the pinned upstream `codex-auth/1` protocol stay unchanged.

The co-shipped bridge/main save APIs now require `requestId`; `reconcileSave` is added. Renderer, preload, main, host, coordinator and store must be integrated together. Shared overlaps are limited to sanitizer policy ownership/generation and credential-service waits, plus the normal main/preload/coordinator/package/test configuration files. Unexpected storage exceptions during a dispatched mutation are conservatively unknown; typed validation/conflict rejections retain their effect certainty. New internal interfaces are `admitCodexValue`, `CodexStoreClient`, mutation/receipt commands and `CodexReconciliation`. Parent-owned SafeRecording reload quarantine, cached Claude admission, guardian identity/cancellation, and full retained-metadata protections are preserved.

Ownership can remain held if both the write reply and its barrier are unavailable while the coordinator has not been confirmed exited. This deliberately fences matching changes instead of certifying a late write safe; reconnect/restart and receipt reconciliation are required. Historical SQLite/WAL/backups may retain metadata that became unsafe later; identity-based withholding is not forensic erasure. No real credentials, user app data, authentication/inference service, provider provisioning, or research work was used. Signing/notarization and clean-machine distribution remain outside this repair. Parent integration, combined packaging/native checks and fresh isolated Goldfish review remain pending. No external blocker remains after successful local validation.

## Parent integration correction

The import repair adds bounded metadata caches using `matchingRevision`; Codex
uses `matchingGeneration`. Parent merged them into one monotonic counter with
both getters, preserving cache invalidation and policy ownership together.

A new combined-source regression reproduced unchanged credential-vault reloads
waiting behind an in-flight Codex matching-policy owner. Reloading identical
known matching values now proceeds without releasing ownership or changing its
generation; new/changed values still wait. The test preserves the ownership
until the unchanged reload completes. Final parent validation records its result.

Parent combined validation passed: 243 domain tests, 60 shared security tests,
2 native Claude qualification tests, 60 execution tests and 6 real Electron
Codex transport cases (371 total), plus typecheck/lint. macOS arm64 make,
ZIP integrity and all three packaged smoke suites passed sequentially. The
[save recovery captures](../ui-evidence/45-save-reconciliation/README.md)
show the previous error and repaired same-identity reconciliation. No extra
model dispatch or saved revision occurred during that packaged recovery.
Fresh independent review remains pending; live service qualification is unchanged.
