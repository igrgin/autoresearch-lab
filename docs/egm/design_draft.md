# Autoresearch Lab implementation design

* **Author:** igrgin
* **Status:** Overview & Goals approved by igrgin on 2026-11-13. The issue plan is approved and published. Detailed architecture decisions remain open in the spikes; application implementation has not started.
* **Date:** 2026-11-13
* **Source:** [Approved concepts brief](../designs/concepts_brief.md)

## Overview

Autoresearch Lab is a personal desktop application for creating, running, and inspecting autonomous PyTorch research projects on the user's existing Runpod Pods and Vast.ai instances. It brings dataset setup, generated training code, research agent activity, experiment results, compute observations, and selected model artifacts into one place.

macOS is the first build and continuous integration (CI) target. This initial delivery target leaves the choice of desktop application stack open; the technical design will consider future platform support when evaluating that choice.

A **project** identifies a research task and its local dataset. It has its own folder and local Git repository within the application's projects folder. A **run** records a research session's starting code and initialization, objective, selected agent integration and model, hardware assignment, metrics, constraints, experiment training duration, and stopping expression. An **experiment** tests a committed candidate, trains it, evaluates a selected checkpoint, and records its outcome and acceptance decision. The baseline establishes the starting result separately from candidate attempts.

The user supplies the task and data and resolves genuine setup ambiguity. The application uses an agent to prepare and check the research setup. During research, the agent proposes and tests candidates without asking permission between experiments. The user can inspect progress, pause after the current experiment, finish the run, or interrupt it immediately while preserving the ability to resume the run with a fresh experiment.

Full version one includes agent-designed architectures, external pretrained models, previous-run model initialization, both Codex and Claude with model choice, both cloud providers, and multi-GPU instances. Supported PyTorch tasks will use generated research projects; the supported compatibility boundary remains a design decision.

This document records the approved overview and goals. The approved brief takes precedence over historical setup proposals and review advice. The author approved an issue plan and selected Runpod, Codex, and external pretrained initialization for the first end-to-end workflow. Other agreed providers, agents, starting approaches, and multi-GPU execution remain in full version-one scope. Frameworks, storage, protocols, process boundaries, and implementation files remain to be decided through the corresponding spikes.

The design and acceptance checks describe supported tasks without requiring a particular named dataset or prediction task.

## The Problem

The user needs to turn a local dataset and task description into an unattended research session, then determine what happened and whether any candidate improved the selected result under the recorded conditions. That requires a checked baseline, repeatable initialization, comparable evaluation, visible agent actions, and a link between each result and the code that produced it.

Without those links, an apparent improvement can be hard to interpret. Different source data, changed evaluation rules, carried-over training progress, or a hardware change can alter a score. A live training value can differ from the saved checkpoint's final result. Failed and interrupted work can disappear from a history that records only successful experiments. The application must preserve the evidence needed to distinguish these outcomes.

Remote execution introduces a second problem: the local computer can sleep or lose contact, and the application can exit while training continues. A training-duration setting does not bound agent calls, setup, repairs, evaluation, or stuck processes. The design must make the agreed bounded remote completion and automatic pause work without a final instruction from the local application, while showing uncertainty when remote state cannot be confirmed.

Research history and model storage also have different lifetimes. The user needs to inspect whole-run trends and individual experiments after non-winning weights have been removed. The selected model must remain usable with its matching code, input processing, and configuration, including when another run uses it as a fixed starting model. Credentials and separate test scores need defined access boundaries before activity records are stored or reused as agent context.

## Goals

1. **Create a usable research project from a task and local data.** Provide in-app project creation, place copied or moved dataset files within the project folder, and generate the PyTorch training setup, protected evaluation files, research instructions, and a basic `AGENTS.md`. Resolve ambiguous labels, task interpretation, and splits during preparation. Demonstrate setup for a supported task without requiring the user to write network code, and establish a working baseline before candidate experiments. The exact setup sequence and copy/move interaction remain open.

2. **Support distinct starting approaches and isolated sessions.** Support agent-designed networks, selected external pretrained models, and a previous run's selected retained model with its matching code, configuration, and input processing. Allow initial or earlier-experiment code as a run's code source. Keep code source distinct from weight initialization: every experiment uses the run's fixed starting procedure and fresh optimizer state. Record external model versions. Save each run's settings independently of later default changes. Give runs separate branches and working directories in the project's shared repository.

3. **Run autonomous experiments with a traceable outcome for every attempt.** Use Codex or Claude with a selected research model. Commit each tested candidate and preserve its hypothesis, description, tested revision, comparator revision, diff from the then-accepted code, activity exposed by the integration, metrics, and explanation. Compare against the best validated result so far. Keep evaluated keep/discard decisions distinct from failures, interruptions, and pending decisions. Preserve rejected revisions and the code that actually produced each result, including after repairs.

4. **Make research decisions from valid, comparable validation results.** During training, select the highest-ranked saved checkpoint that satisfies applicable constraints. After training, evaluate that checkpoint again and establish final eligibility. Apply constraints before primary-metric ranking and secondary tie-breakers. Complete eligible ties are acceptable; record which model was selected and why. Use completed post-training validation results for acceptance and metric-target stopping. Keep optional test assessments separate and outside research-agent context, including inherited history. Preserve source examples, labels, split membership, evaluation processing, and metric definitions within a run. Permit committed training-only augmentation, sampling, and loss-weighting changes. Require a new run and fresh baseline for source-data, label, split, or evaluation-procedure changes. Keep dependencies and experiment budgets protected during autonomous research.

5. **Honor the agreed training duration, counters, and user controls.** Give every experiment, including the baseline, the run's fixed training duration; a live metric target does not end training early. Support nested AND/OR stopping expressions with primary-metric targets, candidate-attempt limits, and consecutive valid candidates without primary-metric improvement. Count started failed and interrupted candidates toward the attempt limit; exclude the baseline. Failures and interruptions do not change primary-metric stagnation; secondary-only improvements and accepted ties do not reset it. Pause completes the current experiment and leaves the run resumable. Finish completes the current experiment and permanently completes the run. Stop interrupts immediately and leaves the run resumable with a fresh attempt from the last accepted code and fixed initialization. Preserve initial/baseline recovery when no candidate has been accepted.

6. **Use existing compute without conflicting application assignments.** Discover and assign the user's running Runpod Pods and Vast.ai instances, including multi-GPU instances. Reserve each active run's instance and allocated GPUs exclusively against other application runs across all projects. Demonstrate concurrent runs on separate instances and rejection of conflicting reservations. Allow Resume on different hardware after warning and record the change with results. Show available GPU, CPU, RAM, and disk observations, and identify unavailable or stale observations explicitly.

7. **Bound remote work and recover honestly after loss of contact.** Allow a short reconnection grace period. After persistent loss, stop new experiments and exploration, complete only bounded work on the current committed experiment, preserve results remotely, and pause. Preserve untested work if no experiment is executing. Reconcile actual state and pending acceptance before explicit Resume. Retain reservations while work cannot be confirmed stopped. On confirmed native close or Cmd+Q, gracefully pause active runs before exit. Keep provider lifecycle manual and show the still-running warning and provider-console link after research pauses, stops, or completes. Exact limits, transition precedence, and close-failure behavior remain to be designed.

8. **Keep useful local history and selected artifacts.** Retain every experiment's records, metrics, training history, failure information, settings, hardware context, and visible agent conversation and command/tool activity, subject to a defined log-size policy. Exclude or redact authentication material before persistence or later context reuse. Provide experiment graphs and whole-run graphs, averages, and statistics without requiring the user to open each experiment. Preserve history when non-winning weights are removed. Retain one selected final model per completed run by default, with its supporting code and configuration, when a valid model exists. Make it available in the local project folder; show transfer failures separately from research completion and preserve remotely while retrieval is pending.

9. **Demonstrate the full scope through inspectable workflows.** Translate the brief's [observable success criteria](../designs/concepts_brief.md#observable-success-criteria) into acceptance checks covering generated setup, multiple autonomous candidates, ranking and constraints, controls and counters, both agents and providers, multi-GPU execution, isolation, recovery, history, artifacts, and training-only augmentation. A run that finds no improvement can satisfy the observability goal when its evidence and outcome are truthful. Any smaller first milestone must be labeled separately from full version-one completion.

## Non-Goals

* Rental-offer browsing, hardware rental, or instance provisioning.
* Automatic provider instance start, stop, termination, or destruction. Ending application work does not end provider charges.
* Shared-instance scheduling, queues, alternating experiments between runs, control of unrelated external processes, or ownership of an entire provider physical host.
* Resuming an interrupted training procedure from optimizer state or partial training progress. Resuming a run starts a fresh experiment under its fixed initialization.
* Repository imports or automatic compatibility with arbitrary existing code, datasets, model repositories, or checkpoints.
* Team collaboration or Windows releases in version one.
* Keeping every checkpoint forever, or building model serving and deployment.
* Guaranteeing scientific improvement or presenting repeatedly reported test scores as an untouched independent post-search test.
* Capturing hidden agent reasoning. Retained activity is limited to records an integration exposes.

## Open Questions

These questions carry forward the brief's design obligations. They do not reopen settled product behavior or approve review recommendations as architecture.

* **Application and execution architecture:** Which desktop application stack, component boundaries, persistence approach, and local/remote coordination protocol will implement the agreed behavior? How will the stack support the initial macOS build and possible future platform support? Which component owns supervision, evaluation, acceptance, and recovery?
* **Agent integration and credentials:** How will Codex and Claude support model choice, authentication, activity capture, interruption, and recovery? Which components can access which credentials, and how will exposure be prevented or contained before records are persisted or reused?
* **Supported tasks and initialization:** Which generated task/data/model combinations are supported first? How will preparation verify input processing, fixed-weight compatibility after architecture edits, environment requirements, multi-GPU behavior, and hardware capacity? Hugging Face as the first external source remains a proposal.
* **Setup flow and defaults:** When will dataset inspection, split confirmation, and model-specific generation occur? How will copying or moving datasets work? Which global and project defaults will be offered without mutating saved run settings?
* **Evaluation details:** What numerical tie precision, secondary-metric ordering, deterministic complete-tie selection, and metric aggregation rules will be used? How will input/evaluator identity and test-score exclusion be enforced? What happens to baseline comparisons and counters after an allowed hardware change?
* **Execution limits and transitions:** How will training time be measured, including periodic validation? When will stopping expressions be checked? What bounds apply to setup, agent calls, repairs, compilation, evaluation, finalization, repeated failures, and hung multi-GPU processes? How will controls and completion events be reconciled, including before a baseline exists?
* **Recovery and compatibility:** What are the grace periods and hard limits? How will attempt identity, pending outcomes, reservations, stale observations, safeguard health, native-close failures, and app/remote version compatibility be represented and reconciled?
* **Retention and presentation:** What are the storage and log limits, peak-space checks, cleanup rules, source-model dependency protections, and transfer-recovery behavior? Which chart aggregates and score labels will preserve outcome and hardware context? How will collection failures and truncation be visible?
* **Remaining implementation sequence:** How should work beyond the selected Runpod/Codex/external-pretrained route be scheduled as spike decisions resolve? The remaining provider, agent, initialization paths, multi-GPU support, and broader supported-task demonstration remain part of full version one. GitHub blocker relationships record the current task prerequisites.

## Issue plan

The approved plan is published as [14 epics and 82 linked issues](https://github.com/igrgin/autoresearch-lab/issues), including 15 spikes and 67 implementation tasks. GitHub labels distinguish `epic`, `spike`, and `implementation`. Native relationships connect all 82 linked issues to their epics and record 139 blockers. Alternative prerequisite paths use the selected Runpod/Codex/external-pretrained route for the first workflow.

Every spike requires a decision comment on its issue. The comment is the preferred complete deliverable. Additional documentation is needed only when the decision's size or complexity requires a larger record; the comment must summarize the decision and link to that record. Implementation issues deliver code or code-related changes with actionable acceptance criteria.

The [publication records](./github_issue_publication.json), [state](./github_issue_publication_state.json), and [verification](./github_issue_publication_verification.json) retain the published bodies, GitHub references, and checked relationships.

## Additional Resources

* [Approved concepts brief and design follow-up register](../designs/concepts_brief.md#design-follow-up-register)
* [Design sitemap](../designs/SITEMAP.md)
* [Historical setup discussion](./project_and_run_setup.md) — superseded where it differs from the approved brief.
* [Initial concept review and recorded clarifications](./goldfish_reviews/2026-11-13/goldfish_review_report.md)
* [Finalized-brief review](./goldfish_reviews/2026-11-13/finalized_document_review/consolidated_review_report.md)

---

*Drafted with EGM*
