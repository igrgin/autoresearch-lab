# Claude recovery evidence

Captured from the packaged macOS arm64 app with a controlled Claude worker fixture and synthetic credentials; no live authentication or inference.

- Metadata before/after: saved model metadata is visible, then a synthetic credential matching that metadata is registered. The real settings IPC rechecks the record, revokes the matched credential and withholds the entire semantic value; the panel clears cached choices.
- Run refresh before/after: a save commits successfully, a test wrapper makes the next list read fail, and the UI acknowledges the save with a separate read error. Refresh saved configurations recovers the same one record without writing another configuration.

Both pairs show successive states of the repaired implementation, not old-code screenshots. The test-only wrapper delegates to the actual application handlers; deterministic store/transport tests separately cover lost replies and durable request reconciliation. Assertions run in scripts/smoke-claude-recovery.mjs.
