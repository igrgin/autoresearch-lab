# Archive preservation notes

Captured stdout and Git patch files retain their original bytes, including
trailing whitespace emitted by assertion diffs and Forge. They are passive
execution evidence, not product source. The scoped source/document whitespace
check excludes this raw evidence directory; no captured log or patch was trimmed
to satisfy a formatting check.

The helper's stable environment label `SQLite13.1.1` identifies the pinned
`better-sqlite3` npm package 13.1.1. Actual packaged SQLite is **3.54.1**, reported
in [packaged-result.json](packaged-result.json). This correction does not modify
any existing receipt.

[validation-summary.json](validation-summary.json) records the actual final
outcomes. Independent review and parent integration remain pending.
