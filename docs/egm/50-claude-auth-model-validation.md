# Issue #50 implementation evidence

Scope: [Claude authentication/model selection #50](https://github.com/igrgin/autoresearch-lab/issues/50),
following the complete live decisions in [#49](https://github.com/igrgin/autoresearch-lab/issues/49#issuecomment-6859442290),
[#16](https://github.com/igrgin/autoresearch-lab/issues/16) and
[#17](https://github.com/igrgin/autoresearch-lab/issues/17#issuecomment-6867871329).
This is implementation/review evidence, not a new design specification.

## Delivered path

Settings → existing write-only credential window → scoped Claude worker →
complete authenticated Models API pages ∩ SDK resolved supported models →
canonical selection → coordinator-owned settings/run-agent store.

The [host](../../src/claude/host.ts) admits safe metadata before display or
persistence. Credential references are validated UUIDs projected as `accessRef`
in recording, since the shared generic sanitizer deliberately redacts fields
named `credentialId`. This projection never transports a credential value.
Authentication scopes are temporary security-operation identities, not launched
research runs or experiment outcomes.

The [worker](../../src/claude/worker.ts) receives only its operation's API key
over private IPC. The [runtime](../../src/claude/runtime.ts) uses an explicit
environment and a macOS sandbox that permits private state and required system
reads, denies outside file contents/writes, host Keychain service lookup,
process inspection and helper execution. No candidate code is executed here.
The SDK's own bounded subprocess group is killed on worker completion,
revocation or deadline; incidental state is removed after utility exit.

Runtime qualification found that the pinned binary needs its own temp override,
system timezone data and SDK protocol environment variables. It advertises
compiled-in agents/plugins even with command tools disabled. The validator accepts
only the observed names from this exact pinned SDK/binary and requires only
`StructuredOutput` in the enabled tool list; slash-command/skill discovery is
disabled. Unknown/custom tools, plugins, agents, skills, auth sources or versions
fail closed. These advertisements do not expose Agent or Skill tools.

## Acceptance and failure coverage

- [Claude tests](../../tests/claude.test.ts): paginated authenticated inventory,
  alias resolution/intersection, retired/unsupported/unresolved exclusion,
  malformed/oversized/duplicate/incomplete pages, 401/403/service failures,
  invalid/missing/stale/revoked models, replacement and in-flight abort,
  immutable snapshots/retries/conflicts, restart restoration and secret-free
  SQLite/WAL/diagnostics, model mismatches and failed structured completion.
- [Native runtime tests](../../scripts/test-claude-runtime.mjs): real pinned SDK
  initialization/resolved catalog and initialized capability surface with external
  network denied; synthetic outside-file read/write and helper-execution denial;
  no synthetic key in incidental native files.
- [Packaged smoke](../../scripts/smoke.mjs): actual packaged worker/SDK/binary
  with a controlled Models API response and outbound networking denied;
  settings and run-agent UI/IPC/persistence through real Keychain storage;
  invalid/unavailable choices, restart restoration and stale evidence rejection;
  unrelated renderer denied access. The UI access-check result is a worker fixture.

## Self-review and limits

Reviewed credential delivery, safe projection/admission, disabled native capture,
complete pagination, canonical model identity, no fallback, bounded process cleanup,
refresh races, revocation, settings revision conflicts, immutable snapshot retry,
coordinator ownership, startup failure and packaged resource paths. Existing
registry/history schema checksums are unchanged. A separate versioned settings
store avoids changing another owner's migration sequence.

No real host/application/subscription credentials, paid resources, provider
lifecycle operations, live inference or remote training were used. Live Anthropic
account/model entitlement and successful bounded inference remain unproven until
the user supplies an application credential and explicitly invokes the check.
General candidate/remote isolation and full research actions remain #54/#51.
Unsigned packaging retains the existing signing/distribution limitation.

Shared integration files: `src/main.ts`, `src/coordinator.ts`, `src/preload.ts`,
`src/shell.ts`, `src/renderer/index.tsx`, `src/renderer/style.css`, Forge/webpack
configuration, package manifest/lock and test/smoke runners. Other integrations
should preserve `ShellBridge.claude`, `SelectionCommand`/`SelectionValue`,
`ClaudeChoice`/`RunAgentSnapshot` and the existing security service interfaces.

## Final local validation

- Node 24.22.3; `npm run check`: typecheck/lint passed; 26 catalog/Claude,
  47 security and 2 native runtime tests passed (75 total, none skipped).
- `npm run make`: macOS arm64 application and ZIP built successfully with the
  pinned native payload.
- `npm run smoke`: complete final run passed, including native packaged worker,
  unavailable-model UI, settings/run-input restart and the existing shell checks.
- `git diff --check`: passed. Final live recheck found #50 open, assigned to
  `igrgin`, both native blockers closed and all prerequisite bodies/comments
  unchanged from the implementation inputs.

One earlier complete smoke attempt observed one extra application window at the
native-close assertion. A subsequent full run passed with a more descriptive
per-window assertion. Its cause remains unconfirmed; no native-window behavior
change is claimed as a correction. This intermittent observation is a validation
limit, not a failed Claude authentication or model-selection result.
# Goldfish corrections

Default saves now carry a stable request identity. Schema v2 adds an atomic
save/result journal, with a consistent v1 backup before migration. A repeated
equivalent request returns the committed result before revision/catalog checks;
changed payloads under the same identity fail explicitly. Reply timeout or
coordinator loss reports an unknown write outcome, including failed reconciliation
queries, rather than claiming the saved choice was preserved.

The renderer retains default-save identity until acknowledgement. A committed
run-agent save is acknowledged separately from refreshing its list. Read failure
offers Refresh saved configurations and labels another save as a new configuration.
Controlled native smoke loses one successful save reply and fails one post-save
read, then verifies a single committed revision/configuration and unchanged IDs.
The IPC interception is test-only and pinned to Electron 45.3.2's implementation.

Downgrading a schema-v2 agent settings store requires restoring its preserved v1
backup; do not open the upgraded file with the previous application. Existing
default/run rows are retained during upgrade. Physical disk-full and power-loss
behavior remain unqualified.

Additional retained-metadata verification reproduced the Codex-style containment
gap in the original Claude read path. Default revisions, saved-request results
and run snapshots now use shared retained-record rechecks before disclosure.
Detection revokes matched credentials and preserves identity-only quarantine
through restart/remediation. The UI clears affected cached metadata on the
specific protection failure. A clean new default is a new independently admitted
revision; it does not unquarantine historical run-agent inputs.

The native settings regression also exposed concurrent revalidation (PR116-C02): a sibling settings request could see an already initialized credential vault temporarily unavailable during another reload. Reload now publishes validated vault state atomically and blocks access on failure; safe-recording reload is serialized with its durable operations so it cannot overwrite an in-flight incident. A deferred-I/O regression covers concurrent access, capture ordering, and fail-closed reload errors. Initial loads remain unavailable until validated.

Run-agent save replies now recheck the exact store-returned record using its stable snapshot identity, including duplicate receipts with older timestamps. A new proposal's admission never authorizes disclosure of a different cached record. A withheld post-write receipt reports uncertain save effect; durable quarantine remains enforced after matching-material remediation and restart. Controlled regressions cover a newly recognized stored timestamp and replay of a quarantined record.

## Recovery and fresh-default receipt verification

Parent verification reproduced two adjacent paths after round 2. On the previous
packaged application, late recognition of a saved default's model caused the UI
to clear every credential option: selecting the original clean key timed out.
The host/store already allowed a clean new revision, but the delivered renderer
could not reach it. A separate failing regression registered a catalog observation
timestamp after discovery; a fresh default save returned success containing that
newly recognized value.

A sender-validated `claude:recovery` IPC now returns only independently admitted
credential choices and the current default revision. It never returns the old
model/timestamps or clears its quarantine. The renderer clears unsafe cached
metadata, loads this minimal projection, requires an explicit clean key/model,
and saves the next revision. Save stays disabled until a revision is available.
The normal settings/run-history reads retain their strict withholding behavior;
new defaults do not unquarantine historical run inputs or old save receipts.

Fresh default saves admit the complete proposed record, including catalog
observation time, before storage. They also recheck/admit the exact stored receipt
before returning it. A receipt that becomes unsafe during storage is withheld
with unknown effect, preserving the stable-request reconciliation protocol.
Rejection of a new unsafe proposal occurs before SQL and does not invent an
exposure incident for a record that was never retained.

Regression assertions cover clean revision-2 replacement after store restart and
incident remediation, continued withholding of the old receipt, safe credential
label projection, unavailable-policy failure, pre-write timestamp rejection and
post-write receipt containment. Packaged acceptance selects a clean key/model and
saves through the actual renderer/IPC/store using a test-only discovery worker;
it does not call Anthropic or run inference. The before/after screenshots and
capture notes are in [the recovery evidence](ui-evidence/50-default-recovery/README.md).

Final parent validation after import/Claude integration: `npm run check` passed
323 tests (206 domain, 57 security, 2 offline native SDK, 58 execution), typecheck
and lint. macOS arm64 `npm run make`, ZIP integrity and all main/Vast/Codex
packaged smoke suites passed. Source-only import exposure and explicit clean
Claude default replacement were exercised through actual private IPC. These
controlled fixtures do not establish live authentication, inference or GPU work.

## Round3: preserve live containment and protect qualification ingress

Parent reproduced the reload race using a valid existing private state file,
a deferred reload read, and concurrent retained-record recheck/explicit session
containment. Before repair, reload replaced the immediate in-memory incidents and
queued persistence saved the older snapshot. SafeRecording now imports disk state
once per physical owner (merging any initial-read containment); later reloads
validate durable format/access without replacing authoritative live state. A failed
reload still blocks access. A new owner imports the saved state after restart.
The regression verifies incident IDs, withheld IDs, run/session fences on disk,
credential remediation, and continued withholding through a fresh instance.

A second controlled regression found qualification invoked its worker once with
a newly recognized cached model value before returning capture_failed. Qualification
now uses current memory-only semantic admission immediately before worker dispatch,
with no await between admission and invocation. Required model identities are
withheld rather than redacted. The regression proves zero worker invocations.

Parent full check passed328 tests (208 domain,58 security,2 offline native SDK,
60 execution), typecheck/lint. The independent execution regressions are included
in that combined receipt. Final packaging/native checks and fresh review follow
integration of the remaining scoped repairs. No live authentication/inference or
GPU qualification was performed.

## Round 4 publication ordering correction

Four deterministic deferred-write regressions reproduced matching-policy changes
completing before default/run-agent SQL publication, including timeout followed
by late execution. The production SelectionClient now owns matching policy and
synchronously re-admits the exact command before dispatch. Ownership survives
caller timeout; a late reply, synchronous-writer FIFO barrier or confirmed utility
exit proves quiescence before release. A missing reply and missing barrier keep
matching changes fenced until confirmed coordinator exit. Pre-dispatch rejection
has no write effect; ambiguous dispatched saves retain unknown/same-key recovery.
Post-commit recognition still invokes the existing exact-receipt quarantine.

All 28 Claude tests pass, including the four original races, barrier/exit release,
zero-dispatch rejection of newly recognized commands, and existing recovery cases.
Six additional native Electron main/utility cases use the production publication
helper, client and SQLite store with a bounded synchronous writer gate. Default
and run saves each cover normal reply, timeout followed by late write/FIFO barrier,
and dropped original/barrier replies followed by confirmed process exit. Matching
cannot change while the admitted writer is pending; one settings/run record and
one default retry receipt survive. Typecheck and lint passed.

The private selection protocol adds `barrier`; main/client/coordinator/store must
ship together. No SQL schema/migration/checksum changes or new public renderer API
are introduced. Native fixtures use temporary profiles, AES-encrypted synthetic
credentials and controlled local processes, without live authentication/inference.
Combined packaging/smoke validation and fresh independent review remain pending.
