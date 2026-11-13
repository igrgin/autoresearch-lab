Stage 7 Design Critic — audit round 1

Assessment: the finalized brief is coherent enough to enter design. It is a concepts brief, not a completed feature specification. Against the supplied feature-spec standard, the problem, scope, alternatives, and principal behavioral trade-offs are understandable. Architecture, integration feasibility, enforcement, and several major risk mitigations remain explicitly unresolved; therefore this review does not establish implementation readiness or full compliance with the pre-implementation standard.

I found no concrete contradiction in the agreed checkpoint, acceptance, initialization, augmentation, counter, reservation, or recovery policies, and no false external-behavior claim in the source excerpts checked. One additional security design follow-up should be recorded.

Read attestation:

- Reconfirmed `concepts_brief.md` contains exactly 303 lines before auditing. Read lines 1–303 in full. SHA-256 matches the manifest: `c336a21b03ac04d5eebc7c6295f7f882b5690feb3ed6cc61528dec96efd5ef2a`.
- Read in full:
  - `/Users/igrgin/.codex/plugins/cache/egm-local/egm/0.2.1/agents/design_critic.md`
  - `/Users/igrgin/.codex/plugins/cache/egm-local/egm/0.2.1/resources/document_standards/feature-spec-standard.md`
  - `goldfish_reviews/2026-11-13/finalized_document_review/context_manifest.md`, lines 1–105
  - `project_and_run_setup.md`, lines 1–234
  - `goldfish_reviews/2026-11-13/goldfish_review_report.md`, lines 1–213
- Under `goldfish_reviews/2026-11-13/finalized_document_review/sources/`, read in full: `autoresearch-program.txt` (1–115), `mlx-program.txt` (1–116), `cifar10-train.txt` (1–242), and `cifar10-prepare.txt` (1–48).
- Read source excerpts: `autoresearch-train.txt` 470–631; `general-autoresearch-guide.txt` 1–65; `huggingface-download.txt` 175–285; `pytorch-transfer.txt` 1–45 and 115–190; `pytorch-crossentropy.txt` 1–145; `sklearn-pitfalls.txt` 218–270; `runpod-lifecycle.txt` 130–152 and 194–240; `vast-lifecycle.txt` 1–75. Also inspected keyword-search matches throughout all twelve readable source captures for the cited claims.
- An initial combined read was output-truncated; subsequent bounded reads covered the required target and both context documents in full. No required document remains unread. No raw HTML, memory, conversation history, uncited external pages, or implementation repository was read. No source instructions were executed; no files were edited.

New actionable finding:

**S7-D-1 — [Major] Secret handling is absent from the retained-activity contract.**

**Target:** `concepts_brief.md` lines 139, 246, and 296; relevant integration scope at lines 69 and 82.

The brief requires preserving visible conversations, captured commands/tool actions, and training/evaluation logs, while integrating authenticated agents and cloud providers and supplying historical results to subsequent research. It defers authentication feasibility, but neither the behavior nor the follow-up register specifies how secrets are excluded from these records.

A setup or integration command could include a bearer token, credential-bearing URL, or other authentication material. Literal activity retention could persist that secret locally or expose it through later agent context. Log-size limits do not address this failure. This is an unaddressed security design question, not evidence that an existing implementation leaks credentials.

**Evidence:** the retention contract at line 246, history reuse at line 139, and the existing register at lines 288–296. The supplied feature-spec standard explicitly requires security implications and mitigations. Existing M04 concerns evidence loss/truncation; M11 concerns test scores. Neither explicitly covers secrets.

**Required design decision:** define credential access for setup/research components, exclusion or redaction before records are retained or supplied to agents, and handling of accidentally emitted secrets. Preserve useful activity evidence without requiring literal retention of authentication material. This need not select an architecture in the concepts brief.

Previously tracked design follow-ups — still consequential, not new defects:

**S7-D-2 — [Major] Independent bounds and lifecycle reconciliation remain unproved.**

**Target:** lines 39, 181–189, 223–238, 288, and 291.

An unreachable target joined with an attempt count using AND can continue indefinitely; training duration cannot terminate a hung evaluator or distributed child process. A delayed completion racing with Stop can also duplicate counting or adoption unless authority and event precedence are specified. The brief correctly identifies these issues rather than claiming the training clock solves them.

**Evidence:** original M01, M02, M06, M07, M13, and M15; current register rows 288, 291, and 292.

**Required design decision:** specify phase bounds, independent enforcement, attempt identity, control/completion precedence, reconciliation, and confirmation before reservation release. Keep the agreed counters and manual provider lifecycle. These are required before the full feature-spec bar is met; they do not prevent concept comprehension.

**S7-D-3 — [Major] Compatibility, immutable inputs, and retained-source dependencies remain design obligations.**

**Target:** lines 41, 141–155, 195–205, 215–217, 247–253, and 289–290.

An architecture edit may no longer load the fixed initializer; cleanup may remove a previous run’s source model while a dependent run is paused; concurrent work may mutate shared inputs. Hardware changes also permit different execution conditions. The brief consistently preserves these risks and does not claim that separate branches, cached scores, or one retained model automatically resolve them.

**Evidence:** original M03, M05, M08, M09, and M16; current register rows 289–290.

**Required design decision:** establish supported combinations, stable input/evaluation identities, initializer dependencies, compatible edits, storage-pressure behavior, and hardware preflight. Cached incumbent scores require matching evaluation context; permission to change hardware does not itself prove comparability.

**S7-D-4 — [Major] Evaluation and test-score boundaries are agreed but not yet enforceable guarantees.**

**Target:** lines 155, 161–175, 195–209, 246, and 293.

Constraint-first checkpoint selection, validation-based acceptance, complete ties, and training-only augmentation are mutually consistent. However, editable candidate code, protected evaluation, training-loss changes, retained logs, and agent-accessible history need a design that preserves those distinctions. For example, a candidate’s new class-weighted training criterion must not silently replace the fixed validation-loss calculation, and a test score must not re-enter context through a readable log.

**Evidence:** original M05/M11 and the explicit enforcement deferral at lines 155 and 169. The PyTorch source excerpts support training-only augmentation and class-weighted loss; they do not establish enforcement in this application.

**Required design decision:** define authoritative evaluation inputs/results and access boundaries, including logs and later-run summaries. Preserve the resolved policy; this does not justify reopening test-based acceptance or banning permitted training-recipe experiments.

Source and scope conclusions:

- The checked captures support the brief’s descriptions of the original autoresearch loop, MLX baseline policy, CIFAR-10 test-based search, revision-specific downloads, pretrained initialization, training augmentation, class weights, test leakage, and provider lifecycle differences.
- Source code supports the original script’s fresh initialization and final-weight evaluation. Its lack of a checkpoint-save implementation was checked through the execution excerpt and save-related searches, rather than a full read of every line.
- Existing alternatives contain concrete product/scope or technical trade-offs. No unlinked maintainer attribution was found.
- Reservations are explicitly application-wide guarantees, not control over external processes or physical hosts. Manual provider lifecycle and continuing charges are explicit accepted limitations.
- Formal architecture and provider/agent integration feasibility remain unverified. No application, integration, GPU workload, recovery mechanism, or access-control implementation was executed or tested. Historical review completion and user approvals were corroborated only against the supplied records, not independently reconstructed.
