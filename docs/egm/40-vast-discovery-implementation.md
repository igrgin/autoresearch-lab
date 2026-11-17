# Issue 40 implementation and self-review evidence

Date: 2026-11-16. Scope: [#40](https://github.com/igrgin/autoresearch-lab/issues/40) only.
This is implementation evidence, not a new design specification or spike decision.

## Authority and isolation

Started at main `2c00e165237114998b49dcbc4f319a72eb0d54b8` in the tool-prepared
`t3-5316de55` checkout; renamed its clean `t3/5316de55` branch to
`40-discover-vast-instances`. Verified Git root/common directory, origin, status and
all worktrees before edits. This checkout differs from the coordinator and every
other listed task. No other checkout was edited. GitHub CLI authenticated as
`igrgin`; issue 40 was open and assigned to that account, with native prerequisites
39 and 21 closed. Re-read 40, 39, 21, 16 and 17 and all their current comments before
delivery; no new decision amendments were present.

Consumed the [concepts brief](../designs/concepts_brief.md), [sitemap](../designs/SITEMAP.md),
[build guidance](../BUILD.md), shared agent/GitHub workflows, #16's final numbered
decisions, #17's credential decision and both #39 comments. The original-UUID /
same-model amendment remains owned by assignment/Resume; discovery does not impose
a UUID constraint or implement assignment.

## Delivered boundaries

- Compute selects saved Vast credential references and invokes a host-owned,
  read-only REST adapter. `VastDiscovery` v1.0 and `VastInstance` expose canonical
  `vast:<contract ID>` identity separately from account access metadata. Rotation
  retains account association; account aliases do not create a resource namespace.
- Listing uses v1 GET, explicit safe columns, ID ordering, running filter and
  `next_token`/`after_token`, maximum 25 rows/page. A full scan is bounded to 100 pages
  and 45 seconds; requests to 10 seconds; response bodies to 1 MiB. Repeated/invalid
  cursors, malformed rows, missing actual state, missing cursor metadata and page
  failures produce an error without publishing a partial/empty list. Transient
  retries are finite; long Retry-After values yield retry-later feedback.
- The separate v0 detail operation validates an object under `instances`, canonical
  ID equality and nullable absence, without a running filter. It is an internal
  provider port for later consumers, not an assignment or deletion decision.
- Actual, intended, current contract and next contract states stay distinct.
  Advertised hardware is not verified GPU inventory or readiness. Unknown contract
  state strings survive; missing/sentinel hardware stays unavailable. Provider
  memory units remain unverified; receipt time does not invent a source sample time.
- API keys use existing encrypted storage and scoped credential handles. The
  dedicated trusted window accepts an externally issued 2FA session credential;
  it never saves sessions, passwords, OTPs, recovery codes or TOTP seeds to disk.
  Session authority ends on service expiry, replacement/revocation or restart.
  Protected matching material may remain in memory until exit. Host-created access
  scope IDs stay internal; they are not published as fabricated project/run history.
- The adapter constructs fixed-origin GET URLs and disables redirects/cookies.
  Vendor prose, headers, challenge fields and raw provider JSON never enter display
  or records. Allowlisted projections pass the shared sanitizer admission policy
  before UI delivery; changed required content or admission failure withholds the
  projection. The additive transient admission method creates no database/history
  record. Existing persistent recording formats and policy revision are unchanged.
- Failed refreshes retain only the last successful in-memory list, visibly stale,
  including a stale prior empty scan. Restart restores API credential metadata and
  requires an explicit new scan. Nothing grants/releases reservations, launches
  work, mutates provider lifecycle, or modifies registry/project database ownership.

## Source compatibility checked

Rechecked the official [v1 listing schema](https://docs.vast.ai/api-reference/openapi/yaml/show_instances.yaml)
and published [client v1.11.0 listing/detail code](https://github.com/vast-ai/vast-cli/blob/v1.11.0/vastai/api/instances.py).
The [published CLI error handling](https://github.com/vast-ai/vast-cli/blob/v1.11.0/vastai/cli/main.py)
also recognizes a 401 message mentioning Two Factor Authentication and a 404
`Session expired. Please log in again.` response. Those signals are normalized to
fixed errors alongside supported machine-code forms, without forwarding prose.
[Current 2FA guidance](https://docs.vast.ai/cli/two-factor-authentication) describes
provider-issued expiring sessions; the app does not import the CLI's auth files.
Fixtures are controlled synthetic responses, not captured live-account traffic.

## Validation

- `npm run check`: passed typecheck, lint, 17 catalog tests, 10 Vast tests and
  47 security tests (74 total). Vast cases cover complete/duplicate pagination,
  running filtering, null/sentinel capabilities, invalid/missing/oversized pages,
  second-page failure, cursor loops/page cap, distinct authentication/scope/2FA
  and session errors, finite retries/deadlines, v0 shape/ID mismatch, rotation,
  unauthorized category/revocation, unsafe admission, session persistence exclusion,
  concurrent scan rejection and in-flight revocation.
- `npm run make`: passed, producing the arm64 macOS app and ZIP. Used a task-private
  temporary directory for the final packaging run. An earlier simultaneous
  check/make run collided on `.webpack`; a later shared-temp extraction attempt
  failed with ENOENT. Both were superseded by sequential checks and isolated-temp
  successful packaging; no build-tool/dependency change was needed.
- `npm run smoke`: passed the existing packaged catalog/security/native suite and
  the new Vast suite through actual compiled UI/IPC/credential/adapter paths with
  only HTTP replaced. Verified two-page discovery and deduplication, state
  separation, specific invalid-key/scope/service/2FA/expiry feedback, stale retained
  lists and stale empty scans, safe-field admission, memory-only session handoff,
  active-session loss and API credential restoration after full restart, and
  unrelated-renderer IPC rejection. Final evidence is emitted to
  `out/smoke/result.json` and `out/smoke/vast-result.json` (generated, not committed).
- `git diff --check`: passed.

No real Vast credential, host subscription, service account, paid resource, SSH
connection or GPU work was used. Live `instance_read` entitlement, account/session
behavior and rental compatibility remain unproven. The package remains unsigned
under the existing build qualification. Session login is completed externally;
the application supports the trusted handoff and sanitized expiry/challenge states.

## Final self-review and integration overlap

Reviewed correctness, schema boundaries, bounded reads/retries, safe error paths,
key rotation and in-flight revocation, memory-only session behavior, stale/empty
states, restart behavior and real IPC/UI integration. Corrected malformed actual
state handling, listing-vs-detail 404 handling, legacy 2FA/expiry signals and
first-request error wording. No archived review/input/source artifact was changed.

Potential coordinator overlap is limited to additive glue in `src/main.ts`,
`src/preload.ts`, `src/shell.ts`, `src/credential-preload.ts`,
`src/renderer/index.tsx`, `src/renderer/credential-entry.tsx`, and
`src/security/recording.ts`, plus `package.json`, `scripts/test.mjs`,
`webpack.tests.config.cjs` and `docs/BUILD.md`. Existing bridge methods and credential
APIs remain compatible. New adapter/contract/connection modules live under
`src/providers/vast*`; new UI is `src/renderer/vast-compute*`. New IPC channels are
`vast:credentials`, `vast:discover`, `vast:settings` and the trusted-entry-only
`credentials:vast-session`. No coordinator/catalog/storage schema was changed.
# Goldfish correction

Provider-issued session credentials now record their selected parent key in
memory. The shared credential service synchronously fences dependent sessions
and their workers whenever that parent is revoked or rotated, including exposure
containment outside Settings. Dispatch and result publication also check parent
authority. Controlled deferred-response regressions cover revocation, incident
containment and rotation, requiring immediate abort, no next-page request and no
successful result. Session values remain memory-only.
