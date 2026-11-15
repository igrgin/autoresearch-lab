# Issue 21 — comparison council follow-up

Stopped after **10 rounds in the new comparison series**, at the user's limit.
The requirement that every member grade both UI functionality and appearance
at least **9.5** was **not met**. No round 11 or subsequent design pass occurred.

| Final member | UI functionality | UI appearance |
| --- | --- | --- |
| GPT 6.1 Sol | 8.8 | 9.0 |
| GPT 6 Astra | 8.8 | 9.0 |
| GPT 6.1 Terra | 8.5 | 8.5 |

All [30 verbatim reviews](./reviews.json), [numeric scores](./scores.json), and
[round-by-round grades](./score-table.md) are retained. The earlier
[ten-round series](../21-ui-council/README.md) remains a separate historical record;
its prompts used a different scale description, so its grades should not be
treated as a directly comparable measurement.

## Review method

Each round used three fresh Codex delegates at high reasoning effort and default
service tier: `gpt-6.1-sol`, `gpt-6-astra`, and `gpt-6.1-terra`. Each received the
same task-only prompt for that round, a brief application/task description,
a short list of completed UI changes, and the immediately previous and current
screenshot sets. Round 1 used the earlier series' final images as its previous
set. Reviewers graded the current design independently on functionality and
appearance. They were instructed to inspect only the images, without code,
runtime checks, PR discussions, prior reviews or browsing.

The scale defined only its endpoints: **1 = unusable or incoherent;
10 = exemplary, clear and polished throughout**. No target score or stopping
condition appeared in any reviewer prompt; this was verified for all ten common
prompts. Fresh delegates did not receive parent conversation history. These
remain screenshot judgments, not runtime or security audits.

All successful reviews completed. Initial delegate requests with an invalid
option name were rejected before any reviewer started, then retried using the
catalog's supported `reasoningEffort` setting. These requests were not counted
as a review round. Some captures were refined during preflight before being
supplied to a council; each completed round received the recorded image set.

## Delivered changes and validation

- Clarified which previous value is retained and why, distinguished app access
  from issuer revocation, and disclosed removal limits without implying an
  automatic scan or a completion estimate.
- Improved history navigation, compact badges, readable dates, text size and
  contrast. History has a bounded scrolling body, fixed title/Close action,
  conditional scroll cue, and expandable retention details.
- Added issuer links within history and actionable browser-failure feedback
  with retry and a fixed public address that can be copied. Copying accepts only
  an allowed integration category through sender-specific IPC; it cannot copy
  arbitrary URLs or credential values.
- Kept browser failures separate from storage failures, with both recovery paths
  visible together. Stabilized refresh and copy-feedback geometry, tightened
  management spacing, and made reveal duration clearer.

Final `npm run build` passed TypeScript, lint, **47 security tests**, webpack,
native packaging and arm64 ZIP creation. Expanded `npm run smoke` passed selection,
validation, replacement/revocation, confirmation focus/Escape, safe fixed help,
browser retry/copy, simultaneous browser/storage failures, storage recovery,
unauthorized renderer/copy rejection, 740 × 650 horizontal containment and Close
visibility, and stable address width after copying. An added smoke assertion was
corrected to wait for its asynchronous UI response; the final rerun passed.
Capture script syntax, prompt/grade consistency, image hashes and
`git diff --check` also passed. [Provenance and detailed test scope](./provenance.json)
retain final source and packaged-app hashes.

Browser and clipboard side effects were stubbed in smoke/capture; no system
clipboard content was read or changed. The existing
[implementation limitations](../21-credentials-and-safe-recording.md) remain:
no live provider, SDK, SSH, GPU or model-download adapter was qualified; remote
and native-history remediation, signed-update/clean-Mac Keychain behavior and
future integration boundaries remain unproven. Retired-value removal is a trusted
service handoff; this UI does not run cleanup or expose progress.

## Remaining final-round findings

- Explain record verification and its ownership more concretely without implying
  an implemented cleanup workflow.
- Make removal limits and previous-credential issuer revocation harder to miss
  before replacement and in collapsed history.
- Reduce density at short heights and name the hidden retention section in the
  scroll cue.
- Align the destructive action's name consistently with “Revoke app access” and
  connect the reveal duration more directly to its button.

These are recorded from round 10 without another design pass. Only a single
historical version was pictured; larger-history behavior was not graded.

## Image deletion and screenshot-evidence limitation

At the user's explicit request, **all 113 PNG files created for this comparison
series were deleted**, including the final screenshots. The latest generated
smoke screenshot was also deleted. No new image archive was created. Earlier
preflight captures overwritten before review are also absent. The
[deletion manifest](./image-deletion-manifest.json) records paths, byte counts and
SHA-256 values. Per-round capture metadata and exact prompt/review text remain;
image paths inside raw prompts are historical input inventories, not live links.

The pre-existing PR Before/After screenshots and the earlier review archive
remain byte-for-byte unchanged. Their after images show the UI at commit
`25a6cf8e54183a293c4dec47352c9c1aae3f5917`, before this series. They **do not show
the current final UI**. PR #106 labels them as historical. No rendered image
evidence of the current final UI remains, so the retained review text cannot be
independently checked against those deleted images. This limitation follows the
user's latest deletion instruction; no missing images are embedded or linked.
