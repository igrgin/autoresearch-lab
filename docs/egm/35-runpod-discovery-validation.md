# #35 implementation and validation evidence

Implementation record, 2026-11-16. This is not a new product specification.

## Authority and isolation

Read the checkout's AGENTS.md, shared agent/GitHub workflows, approved concepts brief,
design sitemap, BUILD notes, and live bodies/full comments for #35/#34/#21/#16/#17.
The final live recheck found no body/comment changes. #35 remained open and assigned
to `igrgin`; native blockers #34 and #21 remained closed. The same-model amendment
on #34 is preserved: discovery reports allocation metadata and makes no UUID matching,
assignment, substitution, reservation or launch decisions.

The tool-prepared worktree is separate from the coordinator and all listed workers.
It shares the registered repository's Git common directory and origin but owns branch
`35-discover-runpod-pods`, based on `2c00e165237114998b49dcbc4f319a72eb0d54b8`.
No other checkout, worktree, issue or archive was modified.

## Delivered boundary

- [Provider contract](../../src/providers/contract.ts): versioned safe discovery/detail
  projections; canonical `(provider, resourceId)` identity; account ID only as access
  metadata. Allocation GPU type/count is distinct from physical GPU identities/VRAM.
- [Runpod adapter](../../src/providers/runpod.ts): scoped credential service operation,
  fixed-origin direct HTTPS GET account/list/detail, TLS verification, no redirects,
  cookies, ambient proxy dispatcher or lifecycle route. Complete cursor traversal,
  RUNNING GPU filtering, explicit partial/error/empty results, bounded retry/deadlines,
  response-size/item/page limits, cursor-loop/duplicate detection and quota cooldowns.
- [Compute view](../../src/renderer/compute.tsx): saved Runpod references, trusted settings
  entry, connect/refresh, detail reads, explicit unavailable values and last complete
  observations labeled with receipt time after refresh failure. No readiness claim.
- Raw environment/arguments/registry/runtime/endpoints/vendor errors never enter the
  projection. Allowlisted fields pass the existing sanitizer; altered required semantic
  fields block publication. No raw debug fallback or durable discovery cache exists.

The adapter uses private ephemeral workspace scope IDs with a fresh action/operation
for the existing credential API. These are access bindings, never fabricated run or
project records. Main owns the adapter; preload exposes only credential reference
selection and narrow reads. The utility remains the sole registry/project DB writer.
Navigation/restart deliberately requires a fresh discovery; saved vault references
survive restart and the canonical Pod identity remains unchanged.

## Evidence and self-review

The controlled [provider tests](../../tests/runpod.mjs) run inside the normal security
test command. Eight scenarios cover full cursor traversal and filtering; alias/rotation
identity and credential reload; honest empty/partial/duplicate/malformed discovery;
401/403/404/429/5xx/network failures and quota headers; wrong-category/unknown/revoked
references and in-flight revocation; secret-bearing fields/malformed/oversized bodies;
detail identity/state/readiness; and deadlines/broken sanitization. All fixtures are
synthetic. Existing security tests separately exercise encrypted storage, permissions,
recovery, current/retired matching and operation scope rejection.

The [packaged smoke helper](../../scripts/smoke-runpod.mjs) intercepts only the native
HTTPS transport in main. Actual vault binding, parsing, sanitizer, IPC sender checks,
preload and Compute remain active. It verifies two pages, account/detail reads, the
trusted settings button, partial failure with last-good retention, invalid key errors,
complete empty recovery, absence of synthetic secrets in displayed content, and narrow
window overflow. It runs again after full app restart. An unrelated renderer is denied
credential listing, discovery and inspection before dispatch.

Self-review checked canonical identity independence, complete-versus-partial semantics,
credential rotation/revocation races, safe error handling, no provider mutation paths,
bounded allocation/response handling, absent-versus-zero semantics, persistence/recovery,
actual application integration, and test execution wiring. No database migration,
package/lockfile/toolchain change, external issue comment or early issue closure.

Final validation uses Node 24.22.3: `npm run check` (17 catalog + 55 security/provider
tests), `npm run make` (darwin/arm64 app and ZIP), `npm run smoke`, and `git diff --check`.
Build/test commands must be sequential: Forge cleans `.webpack/`, which also holds the
catalog crash-worker test bundles. Detailed generated smoke output is in ignored
`out/smoke/result.json`; temporary diagnostic logs stay outside the repository.

Public unauthenticated REST-v2 OpenAPI was checked for account/list/detail shapes,
cursor metadata, allocation meanings and quota headers. No real account key, host
subscription, live Pod/SSH/SFTP/GPU/training, paid resource, provider mutation or signed
distribution check was used. Fixture success does not establish those live properties.

## Integration overlap

Shared additions touch `src/main.ts`, `src/preload.ts`, `src/shell.ts`,
`src/security/electron-vault.ts` (trusted-host sanitizer exposure only),
`src/renderer/index.tsx` (Compute navigation), `scripts/test-security.mjs`,
`scripts/smoke.mjs`, and `docs/BUILD.md`. New provider types and adapter are under
`src/providers/`; new Compute files and test helpers remain separate. No coordinator,
catalog, storage, reservation or existing credential-service contract is changed.
