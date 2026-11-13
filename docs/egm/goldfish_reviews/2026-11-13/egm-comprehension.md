**Mode/role:** BRAINSTORM — UX and ergonomics (egm-comprehension).

**Files read in full:**

- `/Users/igrgin/.codex/plugins/cache/egm-local/egm/0.2.1/agents/comprehension.md`
- `/Users/igrgin/.t3/worktrees/home-repo/t3-6158f6d0/goldfish_reviews/2026-11-13/concepts_brief.input.md`

No other files or linked sources read.

**Readiness:** Ready to enter design after review resolution and user instruction. No UX blocker to concept readiness. Not implementation-ready; the following are prioritized design advice, not approved requirements.

1. **Major — UX & Developer Ergonomics — Training duration and stopping.** A nested expression such as `target reached AND attempt count ≥ 20` does not cap execution at 20 attempts. A user can reasonably mistake the “experiment-count limit” for an unconditional limit, especially when failures leave stagnation unchanged. **Advice:** provide a plain-language expression preview, current condition values, and examples showing when execution would continue. Visibly distinguish a condition inside the agreed expression from independent execution/failure safeguards. Preserve the agreed counters and AND/OR behavior.

2. **Major — UX & Developer Ergonomics — Starting code and model initialization; Project and run setup.** “Start from an earlier experiment’s code” and “fine-tune a previous run’s retained model” involve different source material. A user might choose rejected experiment code expecting its trained weights, even though those weights may have been deleted. **Advice:** distinguish code source from weight initialization in the user-facing setup summary; show the exact experiment/run, weight availability, and fixed initialization used by every candidate. Explain incompatible combinations before starting preparation. This clarifies existing choices without adding an artifact-retention promise.

3. **Major — UX & Developer Ergonomics — User controls, closing, and recovery.** Pause and Finish both wait for the current experiment, but an active run also spends time preparing, editing, evaluating, and transferring artifacts. A user pressing Pause while the agent is preparing a candidate cannot infer whether another training attempt will begin; during a long evaluation, “remaining training time: 0” may look stalled. **Advice:** carry the current phase and pending action into control feedback, explaining what work remains before pause/completion. Design how a pending graceful action can be escalated to immediate Stop while preserving the agreed distinctions. Exact transition rules can properly remain design work.

4. **Major — UX & Developer Ergonomics — Evaluation, ranking, and acceptance; Minimum observations and access.** One experiment exposes live training values, checkpoint-selection validation values, completed validation results, and optional held-out scores. Without consistent presentation, the user may interpret a high live or held-out score as the accepted result or stopping trigger. Fully tied candidates also risk appearing “rejected” when merely unselected. **Advice:** use consistent labels for each score’s role and status, and make acceptance explanations identify the compared incumbent, eligibility checks, tie outcome, and decisive metric. Preserve the agreed ranking and held-out policies.

5. **Nit — UX & Developer Ergonomics — Project and run setup.** The agent is intended to remove training-code work, but users still choose a substantial configuration before model-specific generation is checked. An unsupported model/data pairing discovered late could leave them unsure which choice to change. **Advice:** make preparation failures actionable: identify the incompatible choice, preserve completed settings, and offer the smallest repair or supported alternative. Use inherited defaults and a concise effective-configuration summary to keep simple runs approachable. This supports, rather than prematurely defines, the deferred compatibility boundary.
