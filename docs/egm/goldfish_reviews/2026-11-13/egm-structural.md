Mode: **BRAINSTORM**  
Role: **Long-term maintenance Brainstormer (egm-structural)**  
Dimension: **Long-Term Tech Debt & Maintainability**

Files read in full:

- `/Users/igrgin/.codex/plugins/cache/egm-local/egm/0.2.1/agents/structural.md`
- `/Users/igrgin/.t3/worktrees/home-repo/t3-6158f6d0/goldfish_reviews/2026-11-13/concepts_brief.input.md`

No other files, history, or linked sources were consulted.

1. **Major — Shared project inputs need stable research identities.**  
   **Affected sections:** Project and run setup; Autonomous experiments and editing boundaries; Compute and comparability.  
   Separate branches protect candidate code, but concurrent runs still belong to a shared project containing dataset files and generated evaluation material. If setup for a later run changes shared labels, splits, preprocessing, or environment inputs, an older paused run could resume against different conditions while its history still appears comparable.  
   **Advice, not an approved requirement:** During design, define which research inputs become immutable for a run and how their identities are recorded and checked on Resume. Include dataset contents, splits, evaluator, preprocessing, and execution environment; this need not prescribe a storage mechanism.

2. **Major — Recovery needs one authoritative experiment outcome.**  
   **Affected sections:** Autonomous experiments and editing boundaries; User controls, closing, and recovery; Training duration and stopping.  
   After a disconnect, the remote side may possess a completed result while the Mac retains an earlier state or pending Stop. Replaying completion during reconciliation could otherwise count one attempt twice, adopt a candidate twice, or release a reservation prematurely. These defects become difficult to repair once history and statistics depend on them.  
   **Advice, not an approved requirement:** Carry an explicit design invariant that each attempt has one durable identity and one reconciled outcome; repeated delivery must not repeat acceptance, counters, or resource-release effects. Define precedence for competing control and completion events without changing the agreed Pause/Finish/Stop behavior.

3. **Major — Provider and agent combinations can multiply maintenance paths.**  
   **Affected sections:** Version-one cost and a smaller first milestone; In-scope goals; User controls, closing, and recovery.  
   Two providers, two agent integrations, and single-/multi-GPU execution create many combinations. If each combination implements its own lifecycle and recovery rules, later integration changes can produce different meanings of Pause, Stop, pending acceptance, or activity history.  
   **Advice, not an approved requirement:** Use the design phase to identify common behavioral contracts and capability differences. Keep research decisions and run lifecycle rules independent of provider connectivity and agent-specific activity formats. Preserve the agreed full version-one scope; the proposed staging remains advice.

4. **Major — Previous-run initialization creates retention dependencies between runs.**  
   **Affected sections:** Starting code and model initialization; Retention and historical analysis.  
   A new run may repeatedly reload a previous run’s retained model. Deleting or relocating that source while the new run is paused could make its next experiment impossible or tempt an implementation to substitute another checkpoint, violating fixed initialization. Configuration and preprocessing files can have the same dependency.  
   **Advice, not an approved requirement:** Specify how a dependent run preserves or pins its complete initialization package, and what deletion means while dependencies exist. Preserve the agreed selective checkpoint retention; this does not require keeping all historical weights.

**Readiness:** Ready to proceed to design, subject to the existing user instruction gate. No concept-readiness blocker found. Not implementation-ready: the risks above need concrete contracts and recovery/retention policies during design. Architecture, schemas, and screen layouts can remain deferred at this stage.
