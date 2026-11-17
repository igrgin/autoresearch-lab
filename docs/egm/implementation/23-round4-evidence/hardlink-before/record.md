# PR113-F01 hard-linked source cleanup

EGM_FIX_CONTRACT_START
Observed: Confirmed moves of regular source aliases sharing an inode retain an unchanged alias forever after unlinking the first name changes shared ctime.
Expected: Healthy confirmed moves remove matching inventoried aliases and retain two independent verified destination byte copies. Restart reconciles a durably observed application unlink; changed/replaced/symlink sources and uncertain deletion authority remain preserved. Existing metadata admission/quarantine and all identity/digest protections remain.
Authority: Issue #23, current #22 decision section 3, and the user's scoped implementation repair instruction. Live #15/#16/#17 and #19/#24/#25/#26 were read through gh CLI; semantic readiness remains later work.
Scope: Importer cleanup and adjacent regression coverage/documentation only. No publication, issue/PR mutation, coordinator/security/main edits, dependencies, CI policy changes or new agents. Parent owns fresh independent review and integration.
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
