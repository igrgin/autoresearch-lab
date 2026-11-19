# PR107 defaults/snapshot repair

EGM_FIX_CONTRACT_START
Observed: main approves a configuration asynchronously without owning credential matching through commit; renderer retains denied or subsequently recognized configuration bodies.
Expected: matching remains owned from current-policy admission through writer quiescence. Denied reads and credential-policy changes clear configuration/default caches, and delayed replies cannot restore them. Existing immutable snapshots, precedence, Codex and Claude contracts remain intact.
Authority: issue #20 and live #15/#16/#17 decisions, particularly #17 sections 3 and 5; PR107-F01/F02 and explicit repair brief.
Scope: defaults/snapshot admission transport, renderer state, deterministic controlled regressions, packaged UI evidence. Parent owns fresh reviews, integration and push. No new policy, schema migration or GitHub publication.
EGM_FIX_CONTRACT_END

## Reproduction
Pending original production regressions.

## Verification
Node 24.22.3, macOS arm64, pinned Electron 45.3.2. Required: regression, check, make, smoke.

## Limits
Controlled synthetic inputs only. Parent obtains independent review; no child agents authorized here.

## Cause and repair
ConfigurationClient takes the existing matcher ownership before native utility dispatch and initial request admission. Utility admission messages carry the owning request ID; orphan requests are denied. The owner survives caller timeout/send uncertainty and is released on terminal reply after synchronous writer settlement or confirmed utility exit. Admissions under ownership never reinitialize credentials. Renderer generations plus host/local invalidation clear sibling defaults/draft/snapshot bodies and fence late replies.

## Reproduction results
The original direct second-admission recognition regression failed (success was returned despite new recognition). Original packaged reproduction independently showed stale snapshot/draft bodies after denial and a new plaintext snapshot copy under invalidated approval. Original baseline inputs and raw output are retained. A first packaged fixture timing/probe-start error was corrected before genuine reproduction; it was not counted as a defect.

## Verification updates
Focused configuration tests: 17 passed. Shared security tests: 60 passed. Corrected targeted packaged test: 27 assertions passed against repaired production. The first npm run check timed out at 300 seconds with 124 assertions reported passing, no failures; worker evidence that the controlled 7000-file importer took >494 seconds changes that interpretation to incomplete timeout, not an inherited hang. A longer final npm run check is running. A delayed-defaults smoke fixture initially caught the initial mount read; waiting for the initial form before installing the hook corrected the harness. No production change was needed for that correction.

## Review status
Parent owns independent review and combined integration. No agents spawned; review remains pending rather than converged.

## Final source verification
The longer final npm run check passed (exit 0). 250 application +60 security +2 Claude native runtime +60 execution tests passed, followed by the production Codex transport check. The controlled 7000-file import took 361358ms, resolving the earlier timeout concern. Focused final configuration tests passed17/17. No inherited hang or external blocker is established.

## Final packaged verification
Final npm run make, ZIP integrity and npm run smoke all passed in sequence against final source. Full smoke includes all existing native provider/agent cases and the new configuration-protection script with27/27 observations. Actual final before/after screenshots and raw result JSON are retained under the repository evidence directory. No image was generated or edited. Schema/saved-record formats and dependencies are unchanged; no migration/backup action is required. Private main/preload/utility IPC is a same-build contract. No live qualification or independent review convergence is claimed.
