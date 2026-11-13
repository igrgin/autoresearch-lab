Files read in full:

- `/Users/igrgin/.codex/plugins/cache/egm-local/egm/0.2.1/agents/implementation_readiness.md`
- `/Users/igrgin/.t3/worktrees/home-repo/t3-6158f6d0/goldfish_reviews/2026-11-13/concepts_brief.input.md`

Role: **BRAINSTORM — Migration and compatibility Brainstormer.** Reviewed only the supplied snapshot. No separate standard, history, working notes, or linked sources consulted.

**Readiness:** Ready to enter design. No migration blocker prevents concept readiness. Not ready for implementation, as explicitly acknowledged by the brief. No existing application or legacy schema is identified, so a mandatory legacy-data migration cannot be inferred.

1. **Major — Starting code and model initialization; Autonomous experiments and editing boundaries.**  
   **Compatibility hazard:** A fine-tuning run reloads fixed source weights, while candidates may change layer structure and model size. A changed architecture may no longer load those weights. Silently dropping incompatible weights or restarting randomly would violate the recorded initialization and weaken experiment comparisons.  
   **Advice, not an approved requirement:** During design, define compatible architecture edits and explicit handling of incompatible candidates for both external-pretrained and previous-run initialization. Preserve the agreed fixed source weights; do not implicitly convert a fine-tuning run into scratch training.

2. **Major — User controls, closing, and recovery.**  
   **Compatibility hazard:** The Mac app could be updated while a disconnected remote safeguard still runs an older protocol or state model. Reconnection could misinterpret “paused,” duplicate an experiment, or release a reservation despite unresolved remote work.  
   **Advice, not an approved requirement:** Design an app/remote compatibility contract and an upgrade/rollback policy for active runs. Include how incompatible peers reconcile safely before explicit Resume. Exact protocols and schemas can remain design decisions.

3. **Major — Retention and historical analysis; Starting code and model initialization.**  
   **Compatibility hazard:** A new run can depend on an earlier run’s retained model, matching code, configuration, and preprocessing. Later deletion or replacement of the source artifact could leave the dependent run unable to reproduce its fixed initialization, including after Stop or a hardware move.  
   **Advice, not an approved requirement:** Define artifact dependency ownership during design—for example, immutable copied inputs or retained references protected while needed. Decide what deletion means for dependent runs and preserve truthful availability reporting. This does not imply keeping every historical checkpoint.

4. **Major — Project and run setup; Compute and comparability.**  
   **Compatibility hazard:** Concurrent runs share the project’s dataset, while generated setups can use different model preprocessing. If setup work or an external edit changes labels, files, or split membership, a resumed run could compare results obtained from different evaluation inputs despite unchanged metric names.  
   **Advice, not an approved requirement:** Define how each run identifies and preserves its dataset, split, label, and evaluation versions, and what happens when those inputs change. This supports the agreed protected evaluation boundary without prescribing a storage implementation.

5. **Major — Compute and comparability; Retention and historical analysis.**  
   **Compatibility hazard:** Resumption on different hardware is agreed, but recorded code and weights alone may not execute under a different installed PyTorch/CUDA environment or GPU topology. Discovering incompatibility after releasing the old assignment could strand a resumable run.  
   **Advice, not an approved requirement:** Specify a preflight compatibility check and actionable failure behavior for hardware reassignment, preserving the user’s right to resume after a warning when execution is supported. Record the environment needed to interpret and reuse retained models; do not infer a requirement for identical hardware or a mandatory new baseline.
