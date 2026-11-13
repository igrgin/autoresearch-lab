# Goldfish Review Report

**Mode:** BRAINSTORM — concept readiness, not an implementation audit.  
**Target:** [immutable input snapshot](./concepts_brief.input.md), dated 2026-11-13. Section references below refer to that snapshot.  
**Overall assessment:** Ready to enter design after the user reviews the findings, confirms the brief, and instructs design drafting. No concept-level blocker was reported. This is not implementation readiness or an approved design.

## Reviewer completion and reading attestations

All seven native reviewers actually completed. Each was dispatched with `fork_turns: "none"`; fresh parent-turn context was enforced. Host instruction-file exclusion is unverified, so this report does not claim full host isolation. No reviewer was given other reviewers’ findings. The harness limit required at most two reviewer children at a time. All reviewed the same immutable input rather than progressively edited briefs.

Each reviewer attested reading its exact persona and the entire input snapshot. Persona files are under `/Users/igrgin/.codex/plugins/cache/egm-local/egm/0.2.1/agents/`; the input is `/Users/igrgin/.t3/worktrees/home-repo/t3-6158f6d0/goldfish_reviews/2026-11-13/concepts_brief.input.md`. The actual returned reports are preserved verbatim at these links.

| Reviewer / BRAINSTORM lens | Actual status | Required reads attested | Raw Blocker / Major / Nit |
| --- | --- | --- | --- |
| [egm-design](./egm-design.md) — economics | completed | `design_critic.md` + full input | 0 / 4 / 1 |
| [egm-codebase-details](./egm-codebase-details.md) — observability | completed | `codebase_details.md` + full input | 0 / 4 / 0 |
| [egm-zoom-out](./egm-zoom-out.md) — contrarian/YAGNI | completed | `zoom_out.md` + full input | 0 / 3 / 0 |
| [egm-comprehension](./egm-comprehension.md) — UX | completed | `comprehension.md` + full input | 0 / 4 / 1 |
| [egm-implementation-readiness](./egm-implementation-readiness.md) — migration/compatibility | completed | `implementation_readiness.md` + full input | 0 / 5 / 0 |
| [egm-structural](./egm-structural.md) — maintenance | completed | `structural.md` + full input | 0 / 4 / 0 |
| [egm-inventive-catalyst](./egm-inventive-catalyst.md) — contradiction resolution | completed | `inventive_catalyst.md` + full input | 0 / 0 / 3 |

**Failed reads:** none reported. **Retries:** none needed. **Not run:** none. No supplied standard was omitted: no separate document standard was requested for this brainstorm. No reviewer retrieved working notes, conversation history, memory, or linked upstream sources. YAGNI additionally inspected only the repository root inventory and did not verify implementation reuse. These are returned reading attestations, not a claim that every host-injected instruction was excluded.

**Raw total:** 0 Blockers, 24 Majors, 5 Nits. **Deduplicated total:** 0 Blockers, 16 Majors, 2 Nits. Optional inventive suggestions are merged with the risks they address; their original nit-level classification remains visible below. Major means consequential design work, not a reason to demand implementation detail in this brief. Every recommendation below is advice; none is a new approved requirement.

## Prioritized findings

Read M10 and M11 first: these are the two behavioral ambiguities about checkpoint eligibility and agent visibility of held-out scores. The remaining Majors group operational and UX advice for design. Finding IDs are stable references, not a readiness-blocker ranking.

### M10 — Checkpoint ranking and constraints may conflict — Major

**Lens:** YAGNI #1.  
**Affected scope:** Evaluation, ranking, and acceptance.

The best-accuracy checkpoint can fail a validation-loss constraint while an earlier checkpoint passes it. Ranking checkpoints first and applying eligibility afterward can reject an experiment that produced an eligible model.

**Advice:** Explicitly decide whether eligibility participates in checkpoint selection or whether ranking alone intentionally selects a checkpoint that may then be rejected. Preserve agreed experiment-level constraint-first acceptance and distinguish the within-experiment decision from between-experiment acceptance. No policy is changed by this finding.

### M11 — Held-out scores can influence exploration indirectly — Major

**Lens:** YAGNI #2.  
**Affected scope:** Evaluation, ranking, and acceptance; Retention and historical analysis; Starting code and model initialization.

Recorded held-out scores may enter an agent’s later context and shape proposed changes even though mechanical acceptance and stopping use validation alone. The brief already disclaims an untouched independent test; visibility to the research agent is still unspecified.

**Advice:** Decide whether the agent can see these scores during research. Either exclude them from its decision context or describe the indirect feedback honestly. Do not change agreed validation-based ranking or imply a new evaluation platform.

### M01 — A stopping condition is not necessarily a ceiling — Major

**Lenses:** economics #1; UX #1.  
**Affected scope:** Training duration and stopping.

`attempt count ≥ 100 AND target reached` can keep running forever when the target is unreachable. Failures also do not advance stagnation under the agreed rules. Calling the count an experiment “limit” could mislead the user.

**Advice:** Distinguish research stopping expressions from unconditional execution/failure safeguards during design. Consider a separate bound or an explicit warning for unbounded expressions, with a plain-language preview and current condition values. Preserve nested AND/OR behavior and all agreed counters; adding a separate safeguard would require an explicit design decision.

### M02 — Bound all work and enforce bounds independently — Major

**Lenses:** economics #2 and #4; inventive #1 (optional Nit).  
**Affected scope:** Project and run setup; Autonomous experiments and editing boundaries; Training duration and stopping; User controls, closing, and recovery.

Training duration does not bound setup, code generation, repairs, agent calls, compilation, evaluation, finalization, or a hung multi-GPU child process. An editable training loop may bypass reporting or timing accidentally. A controller outage can leave expensive preparation or stuck application processes alive.

**Advice:** Specify phase limits, quota/authentication exhaustion behavior, and ownership of all application processes. Prove bounded remote completion and cleanup without candidate cooperation, including distributed-worker and evaluation hangs. Inventive’s optional “Extraction” pattern moves authoritative timing/evaluation outside editable code; it adds coordination and task adapters and is not a chosen architecture. The desired result is flexible candidate code whose validity and limits do not depend on its cooperation.

### M03 — Peak storage and source-model dependencies need a joint policy — Major

**Lenses:** economics #3; migration #3; maintenance #4.  
**Affected scope:** Starting code and model initialization; Retention and historical analysis.

A source model, incumbent, candidate, download cache, and transfer copy may coexist across concurrent runs. One model per completed run still grows without bound as runs accumulate. Deleting a prior run’s model or preprocessing while a dependent run is paused could destroy its fixed initializer.

**Advice:** Estimate local/remote peak space, specify low-space and cleanup ordering, and decide how dependencies preserve a complete immutable initialization package. Consider copies or protected references without selecting either here. Keep model/cache cleanup distinct from retained-history limits and do not silently substitute weights. This does not require retaining every historical checkpoint.

### M04 — Evidence collection can fail while research continues — Major

**Lenses:** observability #3; inventive #3 (optional Nit).  
**Affected scope:** Retention and historical analysis; Minimum observations and access.

Verbose output may fill a disk, or an agent integration may stop emitting records. A quiet feed cannot distinguish an idle agent from missing evidence. Cleanup before records are safely retained can leave an experiment uninterpretable.

**Advice:** Define collection failure, truncation, dropped intervals, storage pressure, and compact essential evidence. Decide which evidence losses permit continued work. Inventive’s optional “Segmentation” pattern separates durable records from removable model blobs and permits cleanup only after record preservation; reference consistency and partial cleanup then need reconciliation. The desired result is that removing weights preserves meaningful history.

### M05 — Code identity alone does not preserve evaluation context — Major

**Lenses:** observability #4; migration #4; maintenance #1.  
**Affected scope:** Project and run setup; Autonomous experiments and editing boundaries; Compute and comparability; Retention and historical analysis.

Concurrent setup or external edits could change shared dataset contents, labels, splits, preprocessing, evaluator, or environment. A resumed run could compare different inputs despite unchanged metric names and code.

**Advice:** Define which research inputs are stable for a run, their recorded identities, checks on Resume, and behavior when they change. Include environment, initialization, randomness, and unavailable provenance. This is interpretability and compatibility work, not a promise of deterministic reproduction or a selected dataset-storage design.

### M06 — Reconciliation must not apply one attempt twice — Major

**Lenses:** observability #2; maintenance #2; inventive #2 (optional Nit).  
**Affected scope:** Autonomous experiments and editing boundaries; Training duration and stopping; User controls, closing, and recovery.

A delayed completion, repaired execution sharing a commit, and pending Stop can arrive in different orders after reconnect. Counting, adoption, or reservation release could be applied twice or to the wrong execution.

**Advice:** Distinguish baseline, candidate, actual attempt, and evaluation; define one reconciled outcome per attempt and precedence for competing control/completion events. Repeated delivery must not repeat effects. Inventive’s optional “Self-Service” pattern gives a remote supervisor bounded-completion/pause ownership before the Mac resumes; it adds a component, durable state, and upgrade/testing work. The desired result is retained outcomes without duplicate exploration. Mechanism and authority remain design decisions.

### M07 — Connection, freshness, progress, and safeguard health differ — Major

**Lens:** observability #1.  
**Affected scope:** Minimum observations and access; User controls, closing, and recovery.

An open connection can coexist with a stalled controller or collector. Old GPU samples and state may look current without proving progress or a functioning safeguard.

**Advice:** Show last-confirmed state and distinguish these health signals. Preserve uncertainty when they disagree. This does not select heartbeat timing or a transport.

### M08 — Fixed pretrained weights constrain architecture edits — Major

**Lenses:** YAGNI #3; migration #1.  
**Affected scope:** Starting code and model initialization; Autonomous experiments and editing boundaries.

An agent changes model size or layers so the fixed external or previous-run weights no longer load. Silently dropping incompatible weights or switching to random initialization breaks the recorded fine-tuning procedure.

**Advice:** Define supported architecture edits and handling of incompatible candidates without changing the agreed initializer silently. Resolve this within the task/model compatibility boundary rather than requiring arbitrary model support.

### M09 — Supported integration combinations need a bounded contract — Major

**Lenses:** YAGNI #3; maintenance #3.  
**Affected scope:** Version-one cost and a smaller first milestone; In-scope goals; User controls, closing, and recovery.

Demonstrating each provider, agent, and GPU mode once does not establish which combinations work. Separate lifecycle implementations can drift in their meanings of Pause, Stop, activity, or pending acceptance.

**Advice:** Identify common behavior, capability differences, and supported task/model/initialization combinations early in design. Investigate ordinary agent/provider interfaces and Git worktrees before bespoke replacements; reuse is not verified. Preserve both providers, both agents, multi-GPU execution, and all agreed version-one scope. The vertical milestone remains recommended staging, not an approved scope cut.

### M12 — Code source and weight source need distinct explanations — Major

**Lens:** UX #2.  
**Affected scope:** Starting code and model initialization; Project and run setup.

A user selects rejected experiment code expecting its trained weights, which may already have been deleted. Code reuse and previous-run-model fine-tuning are different choices.

**Advice:** Present the exact code source, initializer, source run/experiment, and weight availability together in an effective setup summary. Explain incompatible combinations before preparation. This adds no promise to retain non-winning weights.

### M13 — Graceful controls need phase-aware feedback — Major

**Lens:** UX #3.  
**Affected scope:** User controls, closing, and recovery.

Pause during candidate preparation leaves unclear whether training will start. Evaluation after the training clock reaches zero may appear stalled. Pause and Finish are agreed, but their effects outside training need exact transitions.

**Advice:** Show current phase, pending action, and remaining work; decide how graceful actions escalate to Stop. Preserve the agreed resumable Pause/Stop and permanent Finish distinctions rather than inventing transitions in this brief.

### M14 — Score roles and tie outcomes can be misread — Major

**Lens:** UX #4.  
**Affected scope:** Evaluation, ranking, and acceptance; Minimum observations and access.

Live values, checkpoint validation, completed validation, and held-out scores can look interchangeable. A fully tied valid but unselected candidate may appear rejected for poor quality.

**Advice:** Label each score’s role/status consistently. Acceptance explanations should name the incumbent, eligibility checks, decisive metric, and tie outcome. Retain the agreed score hierarchy and acceptable complete ties.

### M15 — App updates can create remote compatibility skew — Major

**Lens:** migration #2.  
**Affected scope:** User controls, closing, and recovery.

An updated Mac app may reconnect to an older remote safeguard and misread state, duplicate work, or release a reservation while cleanup is unresolved.

**Advice:** Define app/remote compatibility and upgrade/rollback handling for active runs, with safe reconciliation before explicit Resume. Protocol/schema choice is design work; no legacy-data migration is inferred for this new application.

### M16 — Hardware reassignment also needs environment compatibility — Major

**Lens:** migration #5.  
**Affected scope:** Compute and comparability; Retention and historical analysis.

Code and weights may not run under the new PyTorch/CUDA environment or GPU topology. Discovering this after releasing the prior assignment can strand a resumable run.

**Advice:** Specify preflight and actionable failure behavior, and record the execution environment needed to interpret/reuse retained models. Preserve permitted hardware changes after warning; do not add identical-hardware or automatic-rebaseline requirements.

### N01 — Bounded research does not bound provider rental cost — Nit

**Lens:** economics #5.  
**Affected scope:** User controls, closing, and recovery; Proposed observable success criteria.

Automatic pause during a long Mac outage leaves the manually managed instance billed. A warning cannot prevent that expense while the app is unavailable.

**Advice:** Carry this accepted limitation into design and validation. No automatic provider shutdown or billing reconciliation is proposed as an approved scope change.

### N02 — Preparation failures should identify the smallest repair — Nit

**Lens:** UX #5.  
**Affected scope:** Project and run setup.

A model/data mismatch discovered late can leave the user unsure which configuration to change.

**Advice:** Preserve valid settings, identify the incompatible choice, and offer an actionable supported alternative. Inherited defaults and an effective-configuration summary can reduce work. Final screens and the supported compatibility boundary remain design choices.

## Disagreements, alternatives, and decision boundaries

All lenses agree the concept can enter design; none reports implementation readiness. Inventive found no false compromise and classified three mechanisms as optional Nits, while economics/observability/maintenance classified their underlying failure consequences as Majors. The synthesis preserves both: risks are consequential design work; proposed mechanisms are optional, not required architecture.

M10 presents two checkpoint-selection policies and M11 presents two held-out-visibility policies. The reviewers did not choose between them. The brief’s existing user decisions remain authoritative until a deliberate clarification; these are not contradictions silently resolved by the synthesizer.

No reviewer asked to shrink agreed scope, reverse fixed initialization, require a new baseline after hardware changes, make complete ties failures, change counter definitions, resume interrupted training state, or automate provider lifecycle. No missing architecture, schema, code, or screen layout is treated as a concept blocker. The desired result remains unattended bounded work, trustworthy comparison, meaningful history, and a usable selected model; the report chooses no implementation mechanism.

## Recommended review handoff

Review M10/M11 first to clarify experiment meaning and held-out visibility; then address M01/M02 and M03/M05/M06 for execution bounds and recoverability. Confirm how remaining advice will be resolved or tracked during design. User confirmation and an explicit instruction are still needed before egm-draft; no formal design or code was produced by this review.

## Post-review decision log

* **2026-11-13 — M10 resolved by user approval:** select the highest-ranked checkpoint that satisfies applicable constraints. If none qualifies, the experiment cannot replace the current best. The concepts brief now records this rule. The findings above and immutable review input remain the original review record. M11 is still open.
* **2026-11-13 — M11 agent-context policy approved:** keep held-out scores out of the research agent's context, including historical summaries for later runs. Supply validation results, constraint outcomes, and acceptance explanations. The user requested clarification of what displaying the separate assessment means in the UI; the concepts brief now explains it without prescribing a screen layout. This later entry supersedes the previous entry's M11-open status.
* **2026-11-13 — experiment table clarified:** tested commit ID, change description relative to the last kept commit, and kept/discarded decision for evaluated candidates, with metrics and other retained records available. Failures and interruptions retain their distinct execution outcomes; exact table presentation remains design work.
* **2026-11-13 — later proposal pending clarification:** the user proposed validation-based within-experiment checkpoint selection and test/evaluation-based between-experiment acceptance using cached incumbent scores, with fixed split membership. This would amend the earlier validation-only acceptance policy. Training-only augmentation discovered mid-run was also raised; the concepts brief records the recommendation to allow training-recipe changes while protecting source data, split membership, and evaluation. These are pending discussion, not conclusions of the completed Goldfish reviews.
* **2026-11-13 — latest proposal resolved:** the user accepted the recommendation to retain validation-based checkpoint selection, acceptance, and metric-target stopping, with optional test scores for assessment only and outside agent context. Source data and split membership stay fixed within each run. Training-only augmentation, sampling, and loss weighting may be tested in committed candidate experiments; actual source-data, label, split, or evaluation-procedure updates require a new run and baseline. Cached incumbent scores may be reused under matching evaluation conditions. This decision supersedes the previous pending entry; it is a post-review clarification, not a new Goldfish pass.
* **Design handoff:** the concepts brief now maps every consolidated finding to resolved product behavior, accepted limitations, or an explicit design follow-up. Optional mechanisms and additional safeguards remain recommendations, not approved scope additions.
* **2026-11-13 — final alignment confirmed:** the user approved the final concepts brief, including its observable success criteria and labeled recommendations. The brief is finalized for handoff. Formal drafting, publishing, and implementation remain separate next-step instructions. The original review snapshot and reviewer findings remain unchanged.
