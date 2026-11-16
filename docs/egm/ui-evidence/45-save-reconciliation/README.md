# Codex save acknowledgement recovery

Actual packaged macOS arm64 application, isolated temporary profiles, synthetic credentials and controlled stdio model catalog. These captures do not establish live authentication or inference.

- **Before:** previous packaged application (validated combined application source at `8b6bcfb6e76c4a530ac1c8757a2440a9e7b39c09`, before round-3 Codex repairs). A privileged test hook suppresses the successful default-save reply after the production handler commits and presents the prior no-effect error. The stored default was independently verified despite the UI failure. No reconciliation action is available.
- **Pending:** repaired application, same controlled commit/reply-loss boundary. The UI truthfully reports uncertainty and retains one opaque request identity.
- **After:** explicit reconciliation recovers the exact durable default. The packaged test verifies identical request identities, unchanged saved value, no additional authentication/catalog worker dispatch and removal of the acknowledged pending identity.

The fixture hook is test-only, outside the packaged application. [The smoke helper](../../../../scripts/smoke-codex-recovery.mjs) exercises the real renderer/preload/main/coordinator/store. Separate native transport regressions exercise actual main-process timeouts, utility exits and rejected replies for default and project saves; the images alone do not prove those failures.
