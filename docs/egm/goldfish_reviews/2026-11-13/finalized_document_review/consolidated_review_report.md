# Finalized Concepts Brief — Consolidated EGM Review

**Target:** [approved concepts brief](../../../concepts_brief.md), lines 1–303.  
**Reviewed input:** [archived copy](./concepts_brief.input.md).  
**SHA-256:** `c336a21b03ac04d5eebc7c6295f7f882b5690feb3ed6cc61528dec96efd5ef2a`.  
**Preset:** consolidated review, Mode REVIEW, applicable stages 5–8.  
**Result:** coherent concepts brief, ready to begin formal design on instruction. It is not a completed feature specification or an implementation-ready design.

**Post-review correction status:** the user authorized fixing the two new document actions. F01 is addressed in the brief's retention contract and credential-handling design follow-up; the mitigation itself remains design work. F02's stale approval label is corrected. The original 303-line input, raw reviewer reports, and source captures are preserved. Findings and counts below describe the original review, with current dispositions noted per finding.

## What needs attention

The review identified **one new Major design follow-up** and **one editorial Nit**. Three previously tracked Major design obligations remain unresolved. No Blocker, new contradiction in the agreed product workflow, or false cited-source claim was found in the material checked.

The new security follow-up concerns keeping credentials out of retained activity and later agent context. The editorial issue is one stale “awaiting overall confirmation” label. Neither requires restarting discovery or reducing the agreed version-one scope.

**Unique findings:** 0 Blockers, 4 Majors, 1 Nit. This total includes the three already tracked design obligations; it does not mean four newly discovered product defects. Raw Stage 7 findings were 0 Blockers, 6 Majors, 1 Nit before deduplication and severity calibration. Stages 5, 6, and 8 added no new findings.

## Review coverage and evidence

| Stage | Actual reviewers | Completion and result |
| --- | --- | --- |
| 5 — Initial zoom out | Zoom out; inventive catalyst | Both completed. No findings; no false compromise detected. [Report](./zoom_out_report.md) |
| 6 — Comprehension | Comprehension, without context documents or standards | Completed. Coherent paraphrase and no findings. Complete response retained. [Report](./comprehension_report.md) |
| 7 — Critic review | Design; structural; style | All completed. One read-only audit round. [Report](./critic_report.md) |
| 8 — Intermediate zoom out | A new zoom-out reviewer | Completed. Upheld the critique's calibrated dispositions; no new findings. [Report](./intermediate_zoom_out_report.md) |
| 9 — Implementation readiness | Not applicable | No implementation plan or detailed range exists. No reviewer was launched and no pass is claimed. [Record](./implementation_readiness_report.md) |

All seven actual reviewers completed with required persona, target, and supplied-standard reads attested. Truncated outputs were reread; no required material remained unread. No failed reviewers or retries. Reviewers consulted relevant captured source sections and disclosed which files were read completely versus in excerpts. They were not told to pretend every captured source was independently reread in full by every lens.

Each reviewer used `fork_turns: "none"`. Stage 6 received only its persona and the target. Other stages received the [approved context manifest](./context_manifest.md); Stage 8 also read the prior stage reports. Fresh parent-turn contexts were used, while host instruction-file exclusion remains unverified. The reports do not claim stronger isolation.

The target remained byte-for-byte identical to its archived input. This was verification only: no repairs, scope changes, architecture choices, formal drafting, or implementation were performed. The critic audit did not run approved-remediation cycles or establish two-clean-round antagonistic-loop convergence. Its findings remain open or tracked as stated below.

## Prioritized findings

### F01 — Credential handling needs an explicit design follow-up — Major, new

**Target:** lines 139, 246, 296. **Evidence:** S7-D-1; Stage 8 independently upheld C01.

The application will authenticate agent/provider integrations and retain conversations, commands, tool actions, and logs. These records could contain bearer tokens, credential-bearing URLs, or other authentication material. The brief's logging and history policies do not specify how such material is excluded before retention or later agent access.

**Recommended action:** add credential access, exclusion/redaction before persistence or context reuse, and handling of accidental emission to the design follow-up register. Resolve the behavior during design. This concerns the existing integration/history scope; it does not require a separate credential-management product or prove that any existing implementation leaked a secret.

**Status:** documentation fix applied on the user's instruction. The retention contract now requires exclusion or redaction of authentication material before saving records or reusing them in agent context. A credential-handling row in the design follow-up register covers component access, affected record types, redaction coverage, and accidental exposure. Credential mechanisms and their verification remain open design work; this is not an implemented mitigation.

### F02 — Setup-flow label still implies pending overall approval — Nit, editorial

**Target:** line 131, compared with lines 5 and 302. **Evidence:** S7-S-1 and S7-T-1; Stage 8 upheld C02 as a Nit.

The phrase “Recommended setup flow, awaiting overall confirmation” is stale after the recorded final approval. The recommended flow can remain optional for design without leaving the whole brief's approval ambiguous.

**Recommended replacement:** “Recommended setup flow, carried forward for design consideration.” Preserve the recommendation status of copy/move defaults and generation timing.

**Status:** wording fix applied on the user's instruction. The label now reads “Recommended setup flow, carried forward for design consideration.” Structural rated the original issue Nit and style rated it Major. Consolidation and the independent Stage 8 review retained Nit because final status and the decision log made the overall approval clear. The original disagreement remains visible in the raw reports.

### F03 — Execution bounds and recovery require a concrete design — Major, already tracked

**Target:** lines 39, 181–189, 223–238, 288, 291–292. **Evidence:** S7-D-2 and relevant coverage in S7-S-2; existing M01/M02/M06/M07/M13/M15.

A condition within AND/OR is not necessarily an unconditional ceiling. The training clock does not bound preparation, a hung evaluator, or distributed subprocesses. Reconciliation must avoid repeated counting/adoption and premature resource release.

**Required design work:** phase bounds and their enforcement, attempt identities, event precedence, one reconciled outcome, remote supervision, stale-state handling, version compatibility, and confirmed cleanup before reservation release. Additional user-facing safeguards remain decisions rather than silently approved requirements.

**Status:** retained design obligation, not a new contradiction or a claim that a supervisor has been implemented.

### F04 — Compatibility and source ownership require concrete contracts — Major, already tracked

**Target:** lines 41, 141–155, 195–205, 215–217, 247–253, 289–290. **Evidence:** S7-D-3 and relevant coverage in S7-S-2; existing M03/M05/M08/M09/M16.

Architecture changes must remain compatible with fixed starting weights; dataset and evaluation identities must remain stable; cleanup must protect inputs needed by dependent runs; hardware reassignment needs compatible execution conditions. Cached scores are comparable only under the recorded matching evaluation context.

**Required design work:** supported task/model/integration combinations, compatible edits, input identities, initializer ownership, peak-space and low-space behavior, and hardware/environment preflight. Preserve both providers, both agents, multi-GPU scope, and the agreed warning-based hardware changes.

**Status:** retained design obligation. No arbitrary-model support, identical-hardware requirement, or universal artifact platform is implied.

### F05 — Evaluation and agent-context boundaries require enforcement — Major, already tracked

**Target:** lines 155, 161–175, 195–209, 246, 293. **Evidence:** S7-D-4 and relevant coverage in S7-S-2; existing M05/M11.

Training-only augmentation and class weighting are compatible with fixed evaluation, but editable code and retained logs need a design that preserves this boundary. A training-loss change must not alter the authoritative validation calculation, and test scores must not re-enter agent context through another readable record.

**Required design work:** authoritative evaluation inputs/results, access boundaries, result publication, log treatment, and later-run context filtering. Keep the agreed constraint-aware checkpoint selection and validation-based acceptance policy.

**Status:** retained design obligation, not a reason to reopen resolved metric roles.

## Source verification

All twelve approved external references were saved locally. The connected GitHub read tool supplied repository file contents. The six documentation pages have raw HTML and readable article/main-text captures; redirects and hashes are recorded in the [source manifest](./sources/source_manifest.json). All source capture hashes and the target hash were checked after review.

| Captured source | Checked claim and evidence |
| --- | --- |
| [Original program](./sources/autoresearch-program.txt) | Baseline, commit-before-training loop, separate result records, protected evaluation/dependencies, fixed reference budget, and conflicting tie guidance. Lines 23–39 and 94–108. |
| [Original training script](./sources/autoresearch-train.txt) | Fresh initialization and final-weight evaluation; no checkpoint-saving path found on complete Stage 5 inspection. Lines 479–485 and 610–613 plus whole-file inspection. |
| [MLX instructions](./sources/mlx-program.txt) | Baseline on actual hardware and validation-based comparison. Lines 18, 35, 60. |
| [CIFAR training](./sources/cifar10-train.txt) | Best observed test accuracy is recorded without saving corresponding weights. Lines 160, 205–228 plus complete-script inspection. |
| [CIFAR evaluator](./sources/cifar10-prepare.txt) | Uses the dataset test split. Lines 21–22. |
| [Generalized loop](./sources/general-autoresearch-guide.txt) | Chosen metric/direction and optional required guard. Lines 42, 49–56. |
| [Hugging Face downloads](./sources/huggingface-download.txt) | Downloads can specify a model repository revision/commit. Lines 182–228. |
| [PyTorch transfer learning](./sources/pytorch-transfer.txt) | Pretrained initialization; random training augmentation separated from validation processing. Lines 22–32 and 112–195. |
| [PyTorch cross-entropy](./sources/pytorch-crossentropy.txt) | Class-weighted loss supports imbalanced training sets. Lines 38–43. |
| [Scikit-learn pitfalls](./sources/sklearn-pitfalls.txt) | Test data should not guide model choices; split before fitting preprocessing. Lines 220–249. |
| [Runpod lifecycle](./sources/runpod-lifecycle.txt) | Stopping releases compute and has storage consequences. Lines 139–145 and 193–196. |
| [Vast.ai lifecycle](./sources/vast-lifecycle.txt) | Stop preserves data with storage charges; restart depends on GPU availability. Lines 55–74. |

The checked source claims are supported. Sources establish reference behavior and documented capabilities, not compatibility or guarantees for the proposed application. No GPU training, agent integration, provider operation, enforcement mechanism, or recovery implementation was executed.

## Raw-to-consolidated traceability

| Raw finding or assessment | Consolidated treatment |
| --- | --- |
| S7-D-1 | F01, new open security design follow-up |
| S7-D-2 | F03, previously tracked execution/recovery work |
| S7-D-3 | F04, previously tracked compatibility/retention work |
| S7-D-4 | F05, previously tracked evaluation/context enforcement |
| S7-S-1 | F02, stale approval label |
| S7-S-2 | F01/F03/F04/F05 and full-specification readiness limitation; no new mandatory headings or implementation code demanded |
| S7-T-1 | F02, duplicate; severity disagreement preserved |
| Stage 5 zoom-out and inventive results | No findings; sources supported; no false compromise |
| Stage 6 paraphrase | No findings; document-only understanding matched its explicit product model |
| Stage 8 dispositions | Upheld F01–F05 and added no new findings |
| Original M01–M16 and N01–N02 | Follow-up register covers all; behavioral decisions are resolved where recorded, while design mechanisms remain unproved |

## Recommended next action

The approval-label correction and credential-handling documentation are now applied. Proceed to formal design when instructed, resolving the credential-handling mechanisms and F03–F05 before claiming a complete feature specification or implementation readiness. Implementation remains outside the authorization for these document fixes.

## Post-review correction record

The user authorized the two document fixes with “lets fix these.” The updated concepts brief preserves the recommended status of the setup flow, makes credential exclusion/redaction part of retained-record handling, and explicitly tracks credential access and accidental-exposure handling for design. No particular credential store, secret-management subsystem, or provider operation was selected.

Validation reread the changed sections and checked their links and required brief structure against the archived input. The archived review input and raw reports were not rewritten. No fresh reviewer pass or implementation test is claimed for these small documentation changes.
