# Import metadata recovery evidence

Captured from the packaged macOS arm64 app with a synthetic local import. Before: imported metadata is visible. After registering a value matching the retained metadata as a synthetic credential, the real import IPC reply is withheld, the matched credential is revoked, and the panel clears cached metadata. These are states of the repaired implementation, not a claim of live provider access or a screenshot of the old defect. Assertions run in scripts/smoke-import-protection.mjs.
