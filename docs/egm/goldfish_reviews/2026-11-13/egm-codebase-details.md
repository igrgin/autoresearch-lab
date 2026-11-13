Role: **BRAINSTORM — Observability and operational debuggability**, using `egm-codebase-details`.

Files read in full:

- `/Users/igrgin/.codex/plugins/cache/egm-local/egm/0.2.1/agents/codebase_details.md`
- `/Users/igrgin/.t3/worktrees/home-repo/t3-6158f6d0/goldfish_reviews/2026-11-13/concepts_brief.input.md`

Reviewed only the supplied snapshot. No working notes, history, source code, or linked sources were retrieved. Host instruction-file exclusion remains unverified.

**Readiness:** Ready to enter design; no observability blocker to concept readiness. Not ready for implementation. The brief already establishes unusually strong expectations for retained history, pending decisions, disconnected state, artifact-transfer state, and honest uncertainty. The following are design advice, not approved requirements.

1. **Major — Minimum observations and access; User controls, closing, and recovery.**  
   **Dimension:** Observability & Operational SRE Debuggability.  
   **Scenario/consequence:** A connection remains open while the remote controller or telemetry collector stalls. The last GPU sample and experiment state can look current even though neither demonstrates forward progress or that the safeguard is functioning. “Disconnected” and “measurement unavailable” do not fully cover stale-but-present observations.  
   **Advice:** During design, distinguish connection health, observation freshness, experiment progress, and remote safeguard health. Show when state was last confirmed and preserve uncertainty when these signals disagree. This strengthens the agreed recovery behavior without choosing a heartbeat mechanism or timeout.

2. **Major — Autonomous experiments and editing boundaries; Training duration and stopping; User controls, closing, and recovery.**  
   **Dimension:** Observability & Operational SRE Debuggability.  
   **Scenario/consequence:** After a failed attempt is repaired and the Mac reconnects, records may share a candidate commit but refer to different executions. A delayed result or repeated recovery event could then be mistaken for another attempt, obscuring why counters changed, which result replaced the incumbent, or whether Stop was acknowledged. The existing commit/result linkage is necessary but does not alone distinguish executions.  
   **Advice:** Make cross-component execution correlation and a recoverable lifecycle timeline explicit design topics: distinguish baseline, candidate, actual attempt, and evaluation; retain requested versus confirmed controls, counter changes, acceptance comparisons, and their reasons. Choose identifiers and replay semantics in design.

3. **Major — Retention and historical analysis; Minimum observations and access.**  
   **Dimension:** Observability & Operational SRE Debuggability.  
   **Scenario/consequence:** Verbose agent output fills the remote disk, or the activity integration stops emitting records while training continues. A generic failure record or apparently quiet activity feed would leave the user unable to distinguish collection failure, truncated evidence, and an idle agent. It could also hide the reason the selected artifact was lost.  
   **Advice:** Specify observation-pipeline failure behavior alongside the already-deferred log-size policy: expose collection errors, truncation, dropped intervals, and storage pressure; preserve compact lifecycle/outcome evidence when detailed logs cannot be retained. Decide how loss of essential audit evidence affects continued execution without assuming all telemetry failures should stop research.

4. **Major — Retention and historical analysis; Compute and comparability; Project and run setup.**  
   **Dimension:** Observability & Operational SRE Debuggability.  
   **Scenario/consequence:** Two experiments use the same code and nominal settings but different generated environments, dataset contents, or random initialization. Months later, the retained curves show a gain that cannot be explained from hardware identity and code alone. Exact external model revision is already covered; equivalent provenance for other result-producing inputs is less explicit.  
   **Advice:** Define the minimum immutable evaluation context needed to interpret a result: dataset/split identity, protected evaluator version, environment/dependency context, initialization and randomness settings, and any unavailable provenance. Record this context with results; do not turn the concept into a guarantee of deterministic reproduction.

These findings concern diagnosability and evidence quality. They do not reopen the agreed acceptance policy, fixed initialization, manual provider lifecycle, or resumable Stop behavior, and they do not require architecture, schemas, or screen layouts in the concepts brief.
