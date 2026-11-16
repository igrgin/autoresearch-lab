# PR113-F01 hard-linked source cleanup

EGM_FIX_CONTRACT_START
Observed: Confirmed moves of regular source aliases sharing an inode retain an unchanged alias forever after unlinking the first name changes shared ctime.
Expected: Healthy confirmed moves remove matching inventoried aliases and retain two independent verified destination byte copies. Restart reconciles a durably observed application unlink; changed/replaced/symlink sources and uncertain deletion authority remain preserved. Existing metadata admission/quarantine and all identity/digest protections remain.
Authority: Issue #23, current #22 decision section 3, and the user's scoped implementation repair instruction. Live #15/#16/#17 and #19/#24/#25/#26 were read through gh CLI; semantic readiness remains later work.
Scope: Authorized importer cleanup plus PR113-C01 commit authority through private main/utility ports; adjacent tests/docs only. No GitHub publication, dependencies, CI changes, new agents or unrelated consumer edits. Parent owns integration and fresh review.
EGM_FIX_CONTRACT_END

## Reproduction
Pending original-source regression.

## Cause and repair
Pending.

## Changed scope
src/importer/importer.ts, tests/imports.test.ts, docs/BUILD.md; new implementation evidence under docs/egm/implementation/23-round4-hardlink-repair.md.

## Verification
Node 24.22.3 on macOS arm64; pinned package-lock and Electron native SQLite. Required focused regression, npm run check, npm run make and npm run smoke, sequentially.

## Limits
Controlled temporary fixtures only. No live credentials, paid services, physical power loss, hostile same-user filesystem mutation or large-dataset throughput qualification. Independent patch review remains with parent; no review convergence claimed.

## Authorized adjacent correction (new contract extension)
Parent added PR113-C01: the final asynchronous metadataRevision reply may be stale before INSERT/UPDATE. Every import commit must own the existing matching policy across bounded-piece admission and synchronous SQLite publication, with no release on unknown writer quiescence. Reproduced the exact parent regression locally before changing publication code; receipt adjacent-reproduction records one assertion failure and a raw credential path in imports.payload. Main/coordinator private port overlap is now expressly authorized. Generic matcher hold stays parent/#20-owned.

## Final subject
Both findings repaired. Import ownership option wraps all INSERT/UPDATE commits and source-alias receipt persistence. ImportPolicyHost/Client reuse existing matcher primitive unchanged. Native fixture uses actual production coordinator, real SQLite and controlled temporary data; four native cases passed before final capture. Tests preserve altered/replaced/symlink/ctime-only sources before confirmation and after restart; unsafe unrecorded unlink remains pending. Final scoped documentation is docs/egm/implementation/23-round4-hardlink-repair.md. Final receipts regression/check/make/smoke will be archived under docs/egm/implementation/23-round4-evidence. Independent review remains parent-owned.

## Parent integration correction before final full verification
Inspected git show 979f9f512bf1311c1b96f1c79601a1a2098fc4c5 research/security-port.ts and SafeRecording.withMatchingPolicy, plus parent integrated main handlers at 5de6392. No cherry-pick. Initial repaired import ports still routed leased rechecks through repeated initialization. Corrected to an import-scoped leased recording port that skips initialization under a validated live lease. Acquisition initializes first; late timeout cancellation/release remains FIFO/quiescence based. Stronger native fixture queues initialization behind credential registration; seven selected policy tests and four actual native cases passed. Prior final-inputs/regression-final receipts describe the earlier candidate and remain immutable, superseded by final-inputs-v2 / regression-v2.

## Final assertion type correction
The first full check stopped at TypeScript TS2769 in the newly added lease-expiry assert.rejects argument (string-or-Promise union). Wrapped the invocation in an async callback; production code unchanged. Raw check-final receipt retained, superseded by check-final-v3 after refreezing source/tests.

## Final passing verification
Focused regression 41/41 plus four native cases passed. npm run check passed 389 tests plus ten native transport cases (Codex6, imports4), 467.848 seconds; controlled 7000-file import and byte assertions 319391ms. Make and unzip integrity passed in54.063 seconds. Packaged native smoke passed. All four receipt pre/post subject IDs match 99241b6ada0fa0613e428cfd7dee5aacabf8c5f3f2e026957de33333f92b40e7. Live bodies/comments for all nine issues rechecked unchanged.

## Environment label correction
The immutable helper environment identifier SQLite13.1.1 refers to pinned better-sqlite3 package13.1.1, not the engine version. Actual packaged SQLite3.54.1 was read from out/smoke/result.json and archived as packaged-result.json. All original receipts remain unchanged.

## Handoff state
No independent reviewer was launched, per worker instruction; parent owns fresh review/integration/push. No external blocker. No SQL/public schema migration or backup transformation. Optional private cleanupIdentity is backward-conservative, and missing historic alias authority remains retained. Shared main/coordinator import_matching port requires leased checks to use initialized policy and initialize only before acquisition. Working-tree cleanup/commit is the final local step.
