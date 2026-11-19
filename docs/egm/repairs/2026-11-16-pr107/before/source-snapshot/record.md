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
