# Issue 20 implementation and review evidence

Scope: [#20](https://github.com/igrgin/autoresearch-lab/issues/20), based on
`2c00e165237114998b49dcbc4f319a72eb0d54b8`. The clean tool-prepared worktree
was verified separately from the coordinator and other workers before edits;
branch renamed to `20-manage-project-defaults`. Origin is
`https://github.com/igrgin/autoresearch-lab.git`.

Read the checkout guidance, shared agent/GitHub workflows, approved concepts
brief and sitemap, [build instructions](../BUILD.md), live #19/#20 bodies and
all #16/#17 bodies/comments. #20 was open, assigned to `igrgin`, with #19 as its
closed native blocker. No design decision comment or archived review was changed.

## Delivered seam

[Configuration contracts](../../src/configuration.ts) own typed defaults for
agent/model, duration and objective. Per-field precedence is global → project
→ explicit run choice; absent means inherit and null means explicitly unset.
Agent and its model are atomic to avoid mixed-integration inheritance. No model
availability or numeric training preset is invented. Domain-policy choices for
initialization/data/metrics/stopping/hardware remain with their existing owners.

[Configuration store](../../src/configuration/store.ts) runs exclusively inside
the utility coordinator. Separate versioned stores avoid mutating the catalog
and project-history schema. Append-only revisions, revision preconditions,
idempotent request receipts, project binding and missing-store guards protect
persistence/recovery. Snapshots copy resolved choices and origin revisions;
the saved-read path never resolves defaults. SQL triggers forbid snapshot
updates/deletes. Configuration snapshots reserve a run identity but remain
unprepared and cannot launch research.

[Application forms](../../src/renderer/configuration.tsx) use the real
main/preload/coordinator path for global settings, project inheritance,
preparing/overriding/saving configurations and inspecting saved choices.
Trusted-frame IPC and the existing app-owned credential matcher reject unsafe
semantic values rather than silently substituting redactions. Responses are
rechecked under current matching policy before display.

## Self-review

Reviewed correctness, ownership, isolation, security, integration and recovery:

- Global edits affect inherited project choices only. Explicit null remains
  unset; removing the key restores inheritance. Other projects remain independent.
- Save retries are looked up before resolving defaults or checking their current
  revisions. An altered request conflicts and cannot create a second snapshot.
- Caller mutation affects only detached return objects. No update/delete API is
  exposed for snapshots; future execution must consume a snapshot by identity.
- Project paths come from validated catalog records, not renderer paths. Stores
  reject symlinks, foreign identity and future schema; missing initialized stores
  fail without creating empty replacements.
- No real credential values, subscription state, provider lifecycle calls, external
  adapter or paid resource is used. Settings use app-owned matching state only.
- Remaining preparation is explicit in the UI and record; no complete launch
  contract, provider/model entitlement or live training proof is claimed.

## Validation

Final validation on Node 24.22.3, macOS arm64:

- `npm run check`: passed typecheck, lint, 24 catalog/configuration tests
  (including seven configuration acceptance/failure tests) and 47 security tests.
- `npm run make`: passed; produced the arm64 application and ZIP.
- `npm run smoke`: passed against the actual packaged app and isolated temporary
  user-data profile. `defaultsPrecedenceAndRestart`,
  `immutableConfigurationSnapshots`, `configurationAdmission`, and all existing
  smoke checks passed; actual coordinator SQLite was 3.54.1.
- `git diff --check`: passed. Careful final diff/self-review completed.
- Live #19/#20 and #16/#17 bodies/comments were reread before delivery. No
  amendments, assignment or dependency changes were found.

The packaged flow saves global duration 120, explicit project duration 45 and
explicit unset objective; saves a configuration; changes project/global duration
to 60/300; saves a run override 75; verifies the original 45 remains; restarts
the whole app; verifies persisted precedence and original saved values. It also
rejects an app-registered synthetic secret before settings persistence.

Limits: local controlled tests only; no real provider access, inference,
training, paid resources, signed-distribution qualification, power-loss or
physical disk-full proof. Snapshots are unprepared choices, not launch-ready
training records. Source/schema tests and injected SQL write faults establish
specific failure behavior; they do not qualify arbitrary storage failure.

During development, an early lint failure was fixed. A test helper
initially threw before exercising the intended unavailable-project request and
was corrected. Running packaging concurrently with tests removed the temporary
crash-worker bundle; final validation runs those commands sequentially. Packaged
smoke found an invalid HTML pattern under Unicode-set regex rules; the pattern
was corrected before final validation.

## Integration overlap

Shared entrypoints: `src/main.ts`, `src/preload.ts`, `src/shell.ts`,
`src/coordinator.ts`, `src/renderer/index.tsx`, `src/renderer/style.css`,
`src/security/electron-vault.ts`, `scripts/smoke.mjs`, `scripts/test.mjs`,
`webpack.tests.config.cjs`, `docs/BUILD.md`.

New interfaces: `ConfigurationBridge` extends `ShellBridge`; private utility
messages add `configuration` / `configurationReply`; `ConfigurationStore`
consumes the existing `ProjectCatalog.handle(open)` port. The security host adds
`assertSafeConfiguration`, using its existing matcher. Catalog/project contracts
and storage schemas are unchanged. Future preparation/run owners must extend
versioned configuration choices and reference immutable snapshots, never mutable
defaults. No other worker branch was imported.
