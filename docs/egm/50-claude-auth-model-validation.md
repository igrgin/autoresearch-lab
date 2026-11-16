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
