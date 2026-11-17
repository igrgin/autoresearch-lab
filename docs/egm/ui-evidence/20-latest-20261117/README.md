# Latest after screenshots for PR #107

Application source: `42dbcb82ca5b7a0890cd0ce66aaab98a73c7fe11`. This was the current PR head when captured and rechecked before publication.

Fresh macOS arm64 package built from an exact frozen Git export of this PR head. Isolated synthetic profiles. Provider HTTP and agent processes controlled; actual application UI and host/coordinator routes. No live authentication, inference or training is implied. Captures have not been image-edited. Zoom and image hashes are recorded per file.

Stored on the existing evidence branch so the implementation head remains exactly the captured commit. Original capture artifacts and before images remain unchanged.

| Image | Zoom | Description |
| --- | --- | --- |
| [after.png](after.png) | 100% | Global agent/model, duration and objective defaults saved. |
| [after-project.png](after-project.png) | 100% | Project defaults inherit agent and objective with an explicit 45-second duration. |
| [defaults-recovery-after.png](defaults-recovery-after.png) | 100% | After restart, an explicit clean replacement is saved through the actual defaults form. |
| [cache-after.png](cache-after.png) | 100% | Saved configuration metadata withheld after matching changes, through actual native routing. |

[Source, package identity and PNG hashes](capture.json).
