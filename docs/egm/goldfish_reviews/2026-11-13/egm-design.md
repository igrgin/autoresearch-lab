Mode: **BRAINSTORM**. Role: **Cost, quota, and infrastructure economics Brainstormer (egm-design)**.

Files read in full:

- `/Users/igrgin/.codex/plugins/cache/egm-local/egm/0.2.1/agents/design_critic.md`
- `/Users/igrgin/.t3/worktrees/home-repo/t3-6158f6d0/goldfish_reviews/2026-11-13/concepts_brief.input.md`

No linked documents, memory, history, or external sources were read. Host instruction-file exclusion remains unverified.

**Readiness:** Ready to enter design. No concept-level blocker found. Not ready for implementation: resource limits, remote enforcement, and retention behavior still need concrete decisions. The following recommendations are **advice, not approved requirements**.

1. **Major — Run limits may never stop a run.**  
   **Affected section:** Training duration and stopping.  
   **Dimension:** Cost, quota, and token economics.  
   With `experiment count ≥ 100 AND target reached`, an unreachable target permits experiments indefinitely after attempt 100. Similarly, failures cannot advance stagnation. The agreed counters are coherent, but an expression containing a count does not necessarily provide a ceiling.  
   **Advice:** During design, distinguish research success conditions from unconditional resource safeguards. Consider a separate elapsed-work, attempt, or spending ceiling, or explicitly warn when the configured expression offers no guaranteed bound. Preserve the agreed counters.

2. **Major — Experiment duration does not bound agent consumption.**  
   **Affected sections:** Project and run setup; Autonomous experiments; Training duration and stopping.  
   **Dimension:** Cost, quota, and token economics.  
   An agent could spend hours generating code, repeatedly invoking tools, repairing setup, or reconsidering a candidate before starting training. Neither candidate counts nor the training clock necessarily advances. This also matters while an assigned GPU remains idle and billed.  
   **Advice:** Specify bounded setup, candidate preparation, repair, and agent-call behavior separately from training. Expose agent authentication/quota exhaustion as a recoverable state and account for agent usage where the integration exposes it. Exact limits belong in design.

3. **Major — Steady retention understates peak storage needs.**  
   **Affected sections:** Starting code and model initialization; Retention and historical analysis.  
   **Dimension:** Cost and storage economics.  
   One retained model per completed run still grows with run count. During replacement or interrupted transfer, a source model, incumbent, candidate, download cache, and temporary transfer copy may coexist. Concurrent runs multiply this footprint; a full disk could prevent saving the winning checkpoint or the records required to explain it.  
   **Advice:** Size local and remote peak storage before starting work; define low-space behavior and safe cleanup ordering. Protect a previous run’s model while another run depends on it. Make model cleanup, cache cleanup, and retained-history limits separate policies.

4. **Major — Remote bounds must survive the work they supervise.**  
   **Affected sections:** Autonomous experiments and editing boundaries; Compute and comparability; User controls, closing, and recovery.  
   **Dimension:** Resource bottlenecks and infrastructure risk.  
   The agent may change training-loop implementation and use multiple GPUs. A hung evaluation, blocked distributed worker, or surviving subprocess could outlive the training budget and prevent graceful pause after Mac sleep. The brief recognizes execution bounds; the economic consequence makes their enforcement a central feasibility question.  
   **Advice:** Prove that an independent remote supervisor can terminate all application-owned training and agent processes, preserve recoverable records, and report uncertain cleanup without relying on candidate cooperation. Include multi-GPU and finalization hangs in that proof.

5. **Nit — Research stopping and rental spending remain different outcomes.**  
   **Affected sections:** User controls, closing, and recovery; Proposed observable success criteria.  
   **Dimension:** Infrastructure economics.  
   The agreed manual provider lifecycle means a successful automatic pause can leave rental charges continuing throughout a long Mac outage. The warning is useful when the app is visible, but cannot prevent that expense while it is unavailable.  
   **Advice:** Carry this accepted limitation into design and validation explicitly: bounded research work does not imply bounded rental cost. No automatic provider shutdown or billing reconciliation is proposed as an approved scope change.
