# Personal autonomous ML research application

* **Author:** igrgin
* **Date:** 2026-11-13
* **Status:** Finalized concepts brief, approved by igrgin on 2026-11-13. All seven EGM Goldfish concept reviews and the subsequent product clarifications are recorded. Remaining design work is explicitly tracked. Formal design drafting requires the user's next-step instruction; this approval does not authorize implementation.

## Overview

A personal macOS application for creating, running, and observing autonomous PyTorch research projects. It brings project setup, existing cloud GPU assignments, research agent activity, experiment history, training results, and selected model artifacts into one application.

A project identifies a research task and its dataset. A run is an autonomous research session with its own starting code or model, objective, agent integration and model, hardware assignment, metrics, experiment duration, and stopping expression. Each experiment tests a committed candidate, trains and evaluates it, and records an acceptance decision. The agent continues without permission between experiments until a user control or stopping rule ends the loop.

FER2013 emotion classification is the representative first example. The application should also support other PyTorch training tasks through generated research projects. This does not promise automatic support for arbitrary existing code or every model repository.

This brief consolidates the user's initial decisions and later refinements. Recommendations are labeled below. The earlier [working notes](../egm/project_and_run_setup.md) contain the discussion detail; they are not a second specification. The user requested a review of whether the concept is ready for design, not implementation.

## Analysis

### Readiness assessment

All seven fresh-context EGM concept reviews have completed. No concept-level blocker was reported. The post-review product clarifications are resolved, and the user confirmed alignment with this final brief on 2026-11-13. The foundation is sufficient to enter design on the user's instruction; remaining compatibility, integration, enforcement, and lifecycle details must be specified before implementation. Further broad product discovery is unnecessary.

**Latest decision, 2026-11-13:** after considering validation-based checkpoint selection followed by test-based acceptance, the user accepted the recommendation to keep validation in charge of checkpoint selection, experiment acceptance, and metric-target stopping. Test scores remain separate assessments and stay outside the research agent's context. Split membership and source data are fixed within a run; training-only augmentation, sampling, and loss weighting may be tested in new candidate experiments. Actual source-data, label, split, or evaluation-procedure changes require a new run and fresh baseline. The incumbent's recorded score may be reused while the evaluation context matches.

The central product behavior is now defined, including experiment acceptance against the best validated result so far. The remaining supported task/model compatibility boundary, agent authentication and integration, exact state transitions, and detailed cleanup limits need investigation and specification during design. They do not require restarting product discovery. Completed validation results guide research; separate held-out scores are recorded as an assessment and do not guide acceptance or stopping. Previous-run fine-tuning, a resumable immediate Stop, historical analysis at experiment and run levels, retention, and counter definitions are agreed for version one.

The user explicitly confirmed the anchored hypothesis’s readiness for Goldfish review on 2026-11-13. The completed findings below supplement the initial assessment. They do not silently change user decisions or turn recommendations into approved requirements.

### Goldfish concept review — completed 2026-11-13

All seven lenses completed: economics (`egm-design`), observability (`egm-codebase-details`), contrarian/YAGNI (`egm-zoom-out`), UX (`egm-comprehension`), migration/compatibility (`egm-implementation-readiness`), maintenance (`egm-structural`), and contradiction resolution (`egm-inventive-catalyst`). Each attested reading its full persona and the same full input snapshot; no failed reads, retries, or missing reviews were reported. See the [deduplicated report and verbatim reviewer reports](../egm/goldfish_reviews/2026-11-13/goldfish_review_report.md). Fresh parent-turn context was enforced with `fork_turns: "none"`; exclusion of host instruction files remains unverified. This is not a claim of full host isolation.

The raw reviews contain **0 Blockers, 24 Majors, and 5 Nits**; consolidation yields **0 Blockers, 16 Majors, and 2 Nits**. These severities are relative to concept readiness. The major findings identify consequential decisions and risks for design, not missing implementation that prevents design from starting. Every lens supports entering design subject to review resolution and the existing user gate. None claims implementation readiness.

**Behavioral clarification M10 resolved on 2026-11-13:** the user approved selecting the highest-ranked checkpoint that satisfies applicable constraints. A higher-scoring ineligible checkpoint does not displace a lower-scoring eligible one. If none qualifies, the experiment cannot replace the current best. This applies constraint-first selection within experiments as well as the already agreed comparison between experiments.

**Agent-context policy for M11 agreed on 2026-11-13:** keep separate test scores out of the research agent's context, including historical summaries supplied to later runs. Give the agent validation results, constraint outcomes, and acceptance explanations to guide its next experiment. The separate user-facing assessment and experiment table are defined below; exact UI placement remains for design. The existing warning that repeated assessment is not an untouched independent test still applies.

**Operational design risks group into bounds, recovery, and evidence.** A nested expression such as `attempt count ≥ 100 AND target reached` does not guarantee a ceiling, and the training clock does not bound preparation, repair, agent calls, evaluation, or finalization. **Review advice:** distinguish stopping-expression conditions from independent safeguards, explain the expression clearly, and prove bounded application work even with hung multi-GPU processes. Preserve the agreed counters and manual provider lifecycle; bounded research does not bound rental charges. Recovery also needs a single reconciled outcome per execution, control/completion precedence, app/remote version compatibility, and honest distinction between connection health, stale observations, progress, and safeguard health. These are design topics, not selected protocols or new approved features.

**Compatibility and retention must protect experiment meaning.** Fixed pretrained weights may not load after an architecture edit. Concurrent setup or later edits can change shared datasets, splits, preprocessing, evaluators, and environments. A previous-run model can remain an active dependency after its source run ends, and peak storage includes more than one retained model. **Review advice:** define supported task/model/initialization combinations, stable research input identities, hardware preflight, source-artifact dependencies, low-space behavior, and evidence-preserving cleanup. Do not silently switch a fine-tuning run to random initialization, require identical hardware, promise every checkpoint forever, or reduce the agreed version-one scope.

**UX advice concerns meaning rather than screen layout.** Distinguish earlier experiment code from trained-weight initialization; identify each score’s role and the incumbent used for acceptance; explain valid but unselected ties; and show the current phase and pending Pause/Finish/Stop action. Preparation failures should identify the incompatible choice and preserve usable settings. Provider/agent capability differences should not create conflicting lifecycle rules.

The inventive lens found no false compromise. Its optional patterns are to separate authoritative supervision/evaluation from editable candidates, give bounded remote completion an explicit owner, and separate durable records from removable weight files. These could help preserve flexibility, recovery, and history, but add coordination, compatibility, and consistency costs. They are **advice, not approved architecture**. The desired result remains flexible research within trustworthy limits, one understandable outcome per attempt, and useful history after non-winning weights are removed.

The review does not reopen agreed acceptance against the best validated result, acceptable complete ties, fixed initialization, previous-run fine-tuning, resumable immediate Stop, counter definitions, comprehensive history, manual provider lifecycle, or full version-one scope. Checkpoint eligibility, exclusion of test scores from agent context, validation-based research decisions, and the training-only augmentation boundary are now agreed. Remaining operational recommendations are tracked as design work in the report and the register below; they are not automatically approved features or architecture. The review input and original reports remain unchanged, and post-review decisions are logged separately. The added augmentation clarification has not received a new Goldfish pass. Formal drafting still requires the user's instruction.

### Verified autoresearch foundation

Karpathy's [program.md](https://github.com/karpathy/autoresearch/blob/master/program.md) establishes a baseline, commits candidates before training, records outcomes separately, and keeps or discards changes using a primary validation score. It protects preparation/evaluation code and forbids dependency additions during experimentation. It permits simplicity judgments, although its prose allows approximately equal simplifications while its numbered loop rejects equal scores. The user has resolved the application's policy separately: compare against the best validated result using the configured criteria; fully tied valid candidates are acceptable, with one selected. Simplicity is not an additional acceptance requirement.

The reference's five-minute duration, single GPU, and validation bits per byte are reference defaults, not application requirements. Its [training script](https://github.com/karpathy/autoresearch/blob/master/train.py) initializes each experiment afresh, evaluates final weights, and does not save a best checkpoint. This application's agreed best-validation-checkpoint selection is an intentional extension.

Adaptations differ. The [MLX port](https://github.com/trevin-creator/autoresearch-mlx/blob/main/program.md) preserves validation-score selection and establishes a hardware-specific baseline. The [CIFAR-10 adaptation](https://github.com/GuillaumeErhard/autoresearch-cifar10/blob/main/train.py) tracks best observed test accuracy during training without saving corresponding weights. Its [evaluator](https://github.com/GuillaumeErhard/autoresearch-cifar10/blob/main/prepare.py) uses the test split to guide search, so that split is not an independent final assessment. A [generalized adaptation](https://github.com/uditgoenka/autoresearch/blob/master/guide/autoresearch.md) uses a chosen metric and an optional required guard. These examples inform alternatives; they do not replace the user's agreements.

### Product tensions to preserve in design

* **Simple creation versus trustworthy research:** a name can create a project shell, but usable training needs a task, interpretable data, splits, compatible model outputs, and a checked evaluation procedure. The setup agent should prepare these and ask about genuine ambiguity rather than require the user to write training code. The exact supported task range remains to be bounded.
* **Metric priority versus evaluation validity:** constraints determine eligibility; the primary metric determines rank; secondary metrics resolve ties. A numerically high score cannot replace a valid evaluation. Separate held-out scores provide assessment and do not guide acceptance or stopping. Acceptance compares the newest experiment with the best validated model so far. Fully tied eligible models are acceptable and one is selected; simplicity is not an extra gate.
* **Flexible hardware versus comparable results:** the user may change hardware after a warning. Hardware must be recorded with results. A score change after moving to different hardware is not evidence of a code improvement by itself.
* **Local supervision versus remote recovery:** the Mac can sleep or crash. The instance must independently stop launching experiments after persistent loss of contact and finish only bounded work. The mechanism is for design, but the remote behavior is agreed.
* **Audit history versus model storage:** historical metrics and agent activity are retained across attempts and across each run; saving all checkpoints can consume substantial storage. The agreed policy preserves experiment records and whole-run analysis while retaining one selected final model per run by default. Non-winning experiment checkpoints may be removed after evaluation.

The desired outcome is a checked research setup that can run unattended within explicit limits, preserve an understandable record of its experiments, and return a usable selected model without leaving an uncontrolled remote loop.

### Version-one cost and a smaller first milestone

The full scope is more than a basic experiment dashboard. Each provider needs discovery, authentication, connectivity, telemetry, and failure reconciliation. Each agent integration needs model selection, authentication, activity capture, and recovery behavior. Multi-GPU execution adds coordinated training, correct metric aggregation, and stopping all participating processes. Generated setup must make both architecture creation and pretrained-model training work against supported data layouts. Every path must respect the same history, evaluation, isolation, and lifecycle rules.

**Recommended implementation staging, not an approved scope reduction:** first prove one complete FER2013 workflow using one provider, one agent integration with model selection, and a single GPU. Include project creation, generated training, a baseline, multiple recorded experiments, checkpoint selection, and the agreed pause/recovery behavior. Then add the other initialization path, remaining provider and agent, multi-GPU execution, and a second supported PyTorch task before declaring the full version one complete. Exact sequencing belongs to later planning. Both providers, both agent integrations, project creation, and multi-GPU instances remain in version-one scope.

## Goals vs. Non-Goals

### In-scope goals

* A personal application targeting macOS.
* In-app guided project creation in an application workspace, with a projects folder and a separate project folder and local Git repository for each project.
* Dataset files copied or moved into the project folder.
* Generated PyTorch research setup, evaluation files, autoresearch instructions, and a basic AGENTS.md. The timing of model-specific generation is recommended below.
* Agent-designed architectures, fine-tuning selected external pretrained models, and fine-tuning a previous run's selected retained model. Hugging Face is the proposed first source for external models.
* Codex and Claude integrations, including selection of the specific research agent model.
* Multiple runs per project, isolated run branches and working directories within the shared project repository, and concurrent runs on different instances.
* Discovery and assignment of the user's existing running Runpod Pods and Vast.ai instances, including multi-GPU instances.
* Application-wide exclusive reservations that prevent its own runs from sharing an assigned instance or overlapping allocated GPUs.
* Autonomous experiments, linked code and outcome history, selected-checkpoint evaluation, primary and secondary metrics, constraints, and nested AND/OR run-stopping expressions.
* Training-only augmentation, sampling, and loss-weighting experiments while the source dataset, labels, split membership, and evaluation procedure remain fixed for the run.
* Pause, Finish, immediate Stop, native-close behavior, and recovery after persistent loss of application contact.
* Views of experiments, runs, and project progress, including agent activity, training progress, compute observations, outcomes, and retained artifacts.

### Out-of-scope non-goals

* Rental-offer browsing, hardware rental, and instance provisioning.
* Automatic provider instance start, stop, termination, or destruction. The user accepted manual provider lifecycle management for version one.
* Shared-instance scheduling, queues, alternating experiments between runs, and control over unrelated external processes or an entire provider physical host.
* Resuming an interrupted training procedure from optimizer state or training-progress checkpoints.
* Repository imports, arbitrary existing-code compatibility, team collaboration, and Windows support.
* Keeping every model artifact forever or building a model-serving/deployment product.

**Agreed scope amendment, confirmed on 2026-11-13:** a new run may fine-tune a previous run's selected retained model. This explicitly amends the original prohibition on experiment output weights becoming training inputs. Each experiment in the new run restarts from the same selected source weights with fresh optimizer state; experiments do not accumulate training progress from preceding candidates.

## Alternatives Weighed

| Alternative | Disposition and reason |
| --- | --- |
| Put all research choices into project creation | User moved hardware, metrics, stopping, and other session choices to runs. Keep project creation short and use optional defaults. Exact generation timing remains a recommendation. |
| Permanently bind a project to one model | Recommend against this. The same task and dataset should support distinct starting models and agent-designed networks in separate runs. |
| Require the user to specify network layers | The user wants the agent to design an initial architecture from the task and dataset. Layer-by-layer input is unnecessary. |
| Combine metrics into a weighted score | Does not match the user's rule: primary metric first, secondary metrics only for ties, and constraints for eligibility. |
| Select checkpoints with validation and accept experiments using test scores | Considered by the user, who accepted the recommendation to retain validation-based research acceptance. Repeated test-based acceptance would make the test split part of the search rather than a separate assessment. |
| Require simpler code before accepting a complete metric tie | User clarified that fully tied eligible experiment results are acceptable and one is selected. Simplicity is not an additional acceptance requirement. |
| Always select the final training weights | Rejected by the initial agreement. Select the best validation checkpoint and evaluate it after training. |
| Fix the application to five-minute experiments or validation bits per byte | Rejected by the initial agreement. Duration and metrics are configured for each run. |
| Allow dependency or evaluation edits during autonomous research | User adopted autoresearch's protected boundary. Setup must establish the required environment before the loop. |
| Carry weights automatically between successive experiments | Excluded by the agreed fixed-initialization rule. Previous-run fine-tuning explicitly selects a source model when creating a new run; it does not carry progress between candidate experiments. |
| Block resumption on different hardware | User explicitly allows it after a warning. |
| Leave remote research running through persistent loss of application contact | User accepted bounded completion of the current experiment followed by automatic pause and explicit Resume. |
| Automatically interrupt every transient connection drop | User accepted a short reconnection grace period and bounded completion rather than immediately discarding current work. |
| Automatically shut down provider instances | Considered and deferred from version one with the user's agreement. Provider lifecycle remains manual; the app warns when an instance remains running. |
| Build a model marketplace in the application | Recommend accepting a Hugging Face model URL or identifier first. A full browsing interface has not been approved or rejected. |
| Retain every experiment's model weights indefinitely | User accepted comprehensive experiment and run history with one selected final model per completed run. Other experiment checkpoints may be removed after evaluation. Exact cleanup limits remain design work. |

Other exclusions come from the user's stated version-one boundary; no additional rejection rationale is inferred.

## Key Decisions & Staging for Next Steps

### Project and run setup

**Settled direction:** project creation should be simple. A project has a name, a local dataset within its folder, and optional defaults. Each run saves its own configuration; global defaults feed project defaults, and later default changes do not silently modify existing runs. The primary metric is now a run setting, superseding the initial project-only metric requirement.

**Recommended setup flow, carried forward for design consideration:** the user names the project, chooses the dataset folder, and describes the prediction task briefly. The setup agent inspects inputs, labels, and existing splits and asks only about ambiguity. Copy the dataset by default; offering a move operation remains open. Confirm or establish fixed training/validation/optional held-out splits before research.

At run setup, select the starting approach or existing code, research objective, agent integration and model, hardware, metrics and constraints, fixed experiment training duration, and stopping expression. Generate and check model-specific training code after these choices are known. This moves that part of generation from project creation to run preparation; the timing change is a recommendation. Run preparation must produce a working setup and baseline before candidate experiments.

For FER2013, the user supplies the downloaded dataset and says that the task is facial-emotion classification. The setup agent interprets the layout and labels with confirmation where needed. The user selects an external model or an agent-designed network, configures the run, and assigns existing hardware. The agent prepares the training/evaluation setup, establishes the baseline, and enters autonomous experimentation. This brief selects no particular FER2013 model, label interpretation, split, metric, or duration.

### Starting code and model initialization

**Agreed:** a run may start from the project's initial code or an earlier experiment's code and receives relevant recorded results as context. Candidate experiments do not automatically continue the preceding experiment's training progress.

**Requested starting approaches:** fine-tune an external pretrained model or let the agent create a network architecture suitable for the dataset. Record the external model's exact starting version; Hugging Face supports [revision-specific downloads](https://huggingface.co/docs/huggingface_hub/en/guides/download). Fine-tuning starts from pretrained weights, as distinguished from random initialization in [PyTorch's transfer-learning tutorial](https://docs.pytorch.org/tutorials/beginner/transfer_learning_tutorial.html).

Each experiment initializes afresh from the run's recorded starting procedure. A scratch model initializes new weights; fine-tuning reloads the same recorded starting checkpoint.

**Agreed on 2026-11-13:** version one also supports selecting a previous run's retained final model, including its matching code and configuration, as a new run's fixed starting model. Every experiment in the new run starts from those same source weights with fresh optimizer state. Establish a baseline under the new run's settings before candidate changes. Reusing saved weights is explicit and must carry the input processing required by that model. This starts a new fine-tuning procedure; it does not restore an interrupted training session or continue the previous candidate's training progress. Arbitrary historical experiment weights need not be available for this source option.

### Autonomous experiments and editing boundaries

Each candidate has a description and hypothesis, a tested commit, training and evaluation results, and an acceptance decision with an explanation. The candidate commit describes what changed and what it tests. Later outcomes are linked to it without rewriting the tested commit. Rejected candidates remain accessible even when the working branch returns to accepted code; Git retention must preserve those tested revisions.

**Experiment history table clarified by the user on 2026-11-13:** include the tested commit ID, a description of what changed compared with the last kept commit, and a decision column indicating kept or discarded for evaluated candidates. Retain validation metrics and the previously agreed experiment records with each row; exact metric column arrangement is for design. Record the accepted base/comparator commit so the description and diff remain anchored to the last kept code at the time of that experiment, rather than changing meaning when later experiments are accepted. The comparator is the run's current best validated result, not the preceding rejected attempt.

Execution failures and interruptions retain their separate outcomes under the existing agreement. Their rows must not imply that a completed performance comparison occurred. Design should represent their execution status separately from an absent or pending kept/discarded decision. All rows remain inspectable, with access to code changes and the recorded explanation.

The agent can change architecture, layer structure, model size, optimizers, schedules, regularization, hyperparameters, batch size, and training-loop implementation, including task-appropriate training-only augmentation, sampling, and loss weighting. The generated setup protects source data and labels, split membership, evaluation data loading/processing and metric definitions, and configured experiment budgets. This refines the earlier blanket protection of data-loading code: training-only strategies may change while data identity and evaluation remain fixed. No dependency additions or package installation occur during autonomous experimentation. Setup permissions and the enforcement mechanism remain design work.

The agent runs without inter-experiment permission requests. Failures, rejection, interruption, and unevaluated attempts must be distinguishable. Changing candidate code while repairing a failed attempt must not obscure which code actually produced each recorded result.

### Evaluation, ranking, and acceptance

**Agreed, clarified on 2026-11-13:** during training, save and select the highest-ranked checkpoint that satisfies applicable constraints, using the primary validation metric and secondary validation metrics for ties. A checkpoint that fails an applicable constraint cannot displace an eligible checkpoint even when its primary score is better. If none qualifies, the experiment cannot replace the current best. After training, evaluate the selected saved checkpoint again and check its final eligibility. Only a completed, valid post-training result can count toward acceptance or a metric-target stopping rule. Baselines and candidates follow the same procedure. Live training values do not satisfy a run's metric-target condition.

Eligible results satisfy configured constraints. Rank them by the primary validation metric and its maximize/minimize direction; secondary validation metrics break primary-score ties. A secondary improvement cannot compensate for a worse primary score or a failed constraint. Recommend a priority order and direction for each secondary metric. Numerical tie precision and the deterministic choice between completely tied candidates can be resolved during design; complete ties are already agreed to be acceptable.

**Agreed:** apply the configured constraints first, then compare the completed validation metrics to decide whether to keep the candidate. If separate held-out evaluation data exists, also evaluate the selected checkpoint on it and record those scores separately as a final assessment. Held-out scores do not determine keep/discard decisions, model ranking for research, or run stopping. They do not substitute for the validation score. This preserves per-experiment post-training evaluation while resolving the earlier ambiguity about its role. Repeated reporting is not a claim of an untouched, independent post-search test.

**Split terminology:** training data is used to fit model weights; validation data supplies the metrics used to select checkpoints and compare experiments. An optional separate test set contains additional examples reserved for assessment after training. A test score is the chosen model's measured performance on that test set. "Evaluation" describes measuring performance on a split; it is not the name of a fourth required split. Test scores are not keep/discard criteria.

**Agreed agent visibility:** do not give separate held-out evaluation scores to the research agent, including through inherited history or summaries for later runs. Supply validation results, constraint outcomes, and acceptance explanations so the agent can choose its next test. The information boundary must apply to agent-accessible result records and activity, not merely a single summary field; enforcement belongs to design.

**User-facing assessment:** show separate test results to the user with a clear label such as "Evaluation on separate test data," distinct from the validation metrics that decided acceptance. Experiment details are a proposed placement, not a new required screen. If the project has no separate test set, there is no separate score to display. Exact presentation remains for design.

**Experiment acceptance clarified by the user on 2026-11-13:** first select and evaluate a checkpoint within the newest experiment. Then compare that completed experiment's result against the run's current best validated model/checkpoint, using the configured constraints, primary metric, and secondary tie-breakers. The comparator is the best validated result so far, not simply the most recent attempt. Keep a candidate that ranks better, replacing the incumbent selected result and accepted code; discard a candidate that ranks worse or fails eligibility. Preserve every tested candidate's history regardless of adoption.

If every configured ranking metric ties and both candidates are valid and eligible, both are acceptable and one is selected. The selected candidate may remain the incumbent or become the new candidate; the selection policy and recorded tie explanation belong to design. Do not require a simplification or invent an extra quality criterion to resolve this tie. Selecting one tied candidate does not imply that the other failed or was objectively worse. Only the selected candidate supplies the continuing accepted code and selected model.

An accepted simplification that ties the metrics, or a secondary-only improvement, does not reset primary-metric stagnation. The incumbent checkpoint is a performance comparator, not an automatic training input: experiments still use the run's fixed initialization. Previous-run fine-tuning remains the explicit way to select prior trained weights as a new run's initializer.

### Training duration and stopping

Every run requires a fixed training duration for each experiment, including its baseline. This is shown next to metric and stopping settings but is distinct from the run-stopping expression. Reaching the duration ends training, followed by evaluation and recording; it does not automatically finish the whole run. The agent cannot extend its budget or stop early merely because a live target is reached. Failures or immediate Stop can interrupt an attempt.

Every run also requires a nested AND/OR stopping expression. Required condition types are a primary-metric target, an experiment-count limit, and consecutive experiments without primary-metric improvement. A true expression finishes the run and records the reason. Failures are counted separately from metric non-improvements. Explicit changes to paused-run stopping rules may be supported and must be recorded.

**Counting rules agreed on 2026-11-13:** the experiment-count limit counts every candidate attempt that starts, including failed and interrupted attempts. Baseline execution is separate and does not consume that candidate limit. The primary-metric stagnation counter counts completed, valid candidate experiments without primary-metric improvement. Failures and interruptions neither increment nor reset stagnation and have separate counts. Secondary-only improvements and accepted simplifications do not reset primary-metric stagnation.

The metric-target condition uses the completed post-training validation result, not a live value or the separate held-out score. **Design decisions still needed:** exact event timing for expression evaluation, how configured conditions are checked before Resume or after interrupted attempts, and bounded handling of repeated failures, including baseline failures. Recommend checking result-based conditions after a recorded valid result and before starting another experiment. Define separate bounds on stuck execution and finalization work; the training duration alone is insufficient. Do not silently change the agreed counters to implement failure safeguards.

Recommend excluding startup, compilation, and final evaluation from measured training duration in line with the reference; periodic-validation accounting remains open. User-initiated changes to an existing run's training budget have not been agreed.

### Fixed splits and training augmentation

**Status:** Agreed on 2026-11-13 after the user reviewed the recommendations.

Fix the source examples, labels, and split membership for a run. Reuse the same validation and test inputs, metric definitions, and evaluation procedure for every comparable result. An incumbent's stored validation score can be reused when its evaluation context matches; it need not be rerun solely because a new candidate is tested.

Allow the agent to discover a training-data imbalance during research and address it in the next committed experiment. Training-only augmentation, sampling, or loss weighting are changes to the training recipe, not changes to which source examples belong to the evaluation splits. Apply augmentation after splitting, derive it only from training examples, and keep augmented relatives out of validation/test membership. Prefer on-the-fly transformations so original dataset files need not be rewritten. Appropriate transformations depend on the task and must preserve target meaning. Augmentation adds training variation; it does not create new independent labeled observations or guarantee that imbalance is solved.

For example, an experiment can test more variation of minority-class training examples, different sampling frequencies, or class-weighted training loss. [PyTorch's transfer-learning tutorial](https://docs.pytorch.org/tutorials/beginner/transfer_learning_tutorial.html) separates random training augmentation from fixed validation processing, and [CrossEntropyLoss](https://docs.pytorch.org/docs/stable/generated/torch.nn.CrossEntropyLoss.html) supports class weights for imbalanced training sets.

Keep the run's fixed training duration and initialization procedure. Commit and record each changed augmentation/sampling/weighting policy before the experiment starts, evaluate it against the same fixed evaluation inputs, and compare its result with the incumbent under the chosen acceptance policy. Discovering the idea midway through a run does not itself require a new baseline or restarting the run.

This agreement refines the earlier protected-data-loading boundary: source identities, labels, split membership, and evaluation processing remain protected, while explicitly training-only transformations and sampling policy may be edited as part of candidate code. It does not authorize rewriting shared data, modifying the evaluator, or changing dependencies during autonomous experimentation.

For genuinely new source examples, corrected labels, changed split membership, or a changed evaluation procedure, perform an explicit dataset/evaluation update followed by a new run and a fresh baseline under that context. Retain the previous run's recorded input identity so earlier results are not silently treated as measurements of the updated problem. This establishes a product boundary, not a new dataset-version-management subsystem.

**Alternative considered and not selected:** validation-based checkpoint selection followed by test-based experiment acceptance is mechanically possible, but repeatedly using the test split for keep/discard makes it research/model-selection feedback. It is not an untouched final test, even if exact scores are withheld and the agent receives only acceptance decisions. [Scikit-learn's guidance](https://scikit-learn.org/stable/common_pitfalls.html) explains that test data should not guide model choices when used for independent performance assessment.

**Selected policy:** retain validation-based checkpoint selection, experiment acceptance, and metric-target stopping; use the optional test set for separate assessment only. Test scores remain outside the research agent's context. No fourth split is added, and repeatedly reported test scores are not presented as a guaranteed independent final-test estimate.

### Compute and comparability

Discover the user's existing running Runpod Pods and Vast.ai instances. Do not rent or provision resources. Each active run exclusively reserves its instance and allocated GPUs against all other application runs, across every project. Multiple runs can operate on different instances. These reservations do not control unrelated external processes or claim ownership of the provider's physical host.

Each run has a separate branch and isolated working directory in its project's shared Git repository. Design must preserve that isolation across local coordination and remote execution.

A paused run may resume on different hardware after a warning that training behavior and result comparisons can change. Record hardware/GPU allocation with each experiment and mark changes in the history. A new run is not mandatory. Whether to re-establish a baseline or alter counter comparisons after hardware changes remains open; neither is automatically required by this brief.

### User controls, closing, and recovery

| Action or event | Agreed behavior |
| --- | --- |
| Pause | Finish the current experiment, record its result and acceptance decision, then pause the same resumable run. Start no further experiments. |
| Finish | Complete the current experiment and permanently complete the run. Further research starts a new run from its code and history. |
| Stop | Immediately interrupt the current experiment and record it as interrupted. Preserve history and the previously selected model, and leave the same run resumable. Resume starts a fresh experiment from the last accepted code using the run's fixed initialization. |
| Stopping expression becomes true | Finish the run and record the reason. |
| Native window close or Cmd+Q with active runs | Warn and ask whether to proceed. If confirmed, gracefully pause all active runs before exit. There is no separate in-app close button. Do not intentionally leave research loops running. |
| Short loss of contact | Allow a short reconnection grace period and show disconnected state. Do not equate missing telemetry with an experiment failure. |
| Persistent loss of contact, app failure, or Mac sleep | A remote safeguard stops new experiments and further exploration, lets the current committed experiment finish within execution bounds, preserves results remotely, and pauses. If no experiment is executing, preserve untested work and pause. |
| Acceptance unavailable after unexpected disconnect | Preserve the candidate and result with decision pending. Reconcile before resuming instead of inventing an outcome. |
| Reconnection or restart after automatic pause | Recover actual state and saved results; resolve pending outcomes; require explicit Resume. |
| Remote work cannot be confirmed stopped | Retain the resource reservation and show uncertainty until reconciliation. |

The remote safeguard must work without a final message from the Mac. A disappeared or destroyed instance may make artifacts unrecoverable; report what is missing instead of claiming recovery. Final grace periods, hard timeouts, and native-close failure behavior are design details that still need specified limits and states.

**Stop behavior agreed on 2026-11-13:** Pause completes the current experiment before becoming resumable; Stop interrupts it and remains resumable; Finish completes the current experiment and permanently completes the run. An interrupted experiment remains in history and its partial training state is not resumed. If no candidate has yet been accepted, initial/baseline-code recovery must be specified during design rather than relying on a nonexistent accepted experiment.

Provider lifecycle is manual in version one. These actions stop the application's work and leave the provider instance running. Release the reservation after confirming the application's work has stopped. Show a warning in ordinary sentences: **"Research was stopped. Cloud instance is still running."** Adapt the first sentence to paused or completed outcomes, and report unknown provider state honestly. The warning's location is for UI design. A provider-console link was part of the accepted recommendation.

Continuing provider charges are the explicit trade-off. [Runpod](https://docs.runpod.io/pods/manage-pods) and [Vast.ai](https://docs.vast.ai/guides/instances/manage-instances) have different storage and restart consequences when an instance is stopped; the app does not perform that action automatically.

### Retention and historical analysis

**Agreed on 2026-11-13:** keep the records of every experiment, the selected final model for each completed run, and temporary checkpoints needed during execution. The user also requires historical metrics, graphs, averages, and statistics for each whole run, as well as graphs and metrics for individual experiments. Inspection must not require selecting experiments one by one.

* **Keep locally with the project:** every experiment's tested code reference, description, reported rationale, metrics and training history, outcome and acceptance explanation, failure information, run settings, hardware identity, and visible agent conversation/activity records. Keep historical run metrics and the records needed for whole-run statistics and graphs. Include captured commands/tool actions and training/evaluation logs needed to inspect what happened, subject to a defined log-size policy. Exclude or redact authentication material before saving these records or supplying them to later agent context, including through historical summaries. Store emitted records the integration actually exposes; do not promise access to an agent's hidden internal reasoning.
* **Keep one selected model per completed run by default:** the best eligible completed model under the run's agreed ranking and acceptance policy, with matching code, model configuration, initialization reference, input processing, and its evaluation result. "Final checkpoint" means the selected model at the end of research, not automatically the weights from the last experiment. If no valid model exists, report that outcome rather than invent a final artifact.
* **During execution:** preserve the candidate checkpoint needed for evaluation and the current selected model until it is safely replaced. Other historical experiment checkpoints may be removed after their evaluations and records are preserved. Their historical metrics and activity records remain inspectable. This keeps best-checkpoint selection in scope without requiring a permanent artifact library for every attempt.
* **At run completion:** make the selected retained model available in the local project folder and link it from the run. Keep completion state separate from artifact-transfer state; if the Mac is unavailable, preserve remotely until retrieval. A failed transfer must remain visible.

Whole-run history supports progress charts and summary statistics without drilling into individual experiments. Individual-experiment history supports learning curves and metric graphs. Recommend run charts for completed experiment scores and best-so-far progress, plus explicitly labeled averages and outcome counts. Detailed statistics and chart layout remain design choices. Missing or invalid scores must not be represented as zero-valued successful evaluations; summaries should identify their included outcomes and preserve hardware-change context. Averages describe the run and do not replace the agreed model-ranking rule.

The agreed previous-run fine-tuning option uses the prior run's selected retained final model as its source. Detailed deletion, storage limits, transcript/log retention limits, and access to non-winning weights remain design decisions. Removing model weights must not silently remove retained metric history. No promise to keep every artifact forever is made.

### Minimum observations and access

The user requested experiment, run, and project views with training progress, agent activity, compute usage, outcomes, and improvement history. Whole-run metric history, averages/statistics, and graphs, plus individual-experiment graphs, are now explicit requirements. The following information set refines that direction; individual fields and final screen layouts remain for design:

| View | Information needed |
| --- | --- |
| Experiment | Hypothesis and description, tested commit/diff, visible agent activity, training progress, metric graphs and learning curves, validation history, selected checkpoint and final evaluation, constraint results, outcome, and acceptance explanation. |
| Run | State and pending control action, agent integration/model, hardware assignment and connection state, current experiment, elapsed and remaining training time, retained primary/secondary metric history, whole-run progress graphs, averages and summary statistics, selected result, stopping-expression progress, failure/non-improvement counts, and retained-artifact availability. |
| Project | Task/dataset, runs and starting points, selected results with their metrics and evaluation context, and which runs are active, paused, or finished. Compare different configurations with their hardware/budget context visible. |
| Compute | Provider instance identity/state, application's reservation and assigned GPUs, per-GPU utilization and memory, and CPU/RAM/disk observations where available. Show measurement unavailability explicitly. Include the agreed still-running warning after research stops. |

Universal observations concern time, state, progress, resources, and outcomes. Project-defined observations include the primary and secondary task metrics and relevant learning curves. Language-model-specific values such as tokens/second or bits/byte are not universal requirements. No exact screen arrangement, provider billing reconciliation, or universal model-quality metric is promised.

### Observable success criteria

These outcomes were approved with the concepts brief on 2026-11-13. Design will turn them into concrete acceptance checks; no implementation test plan is specified here.

1. Create the FER2013 example from a local dataset and task description; the agent prepares a working baseline without requiring the user to write network code. Demonstrate both external-pretrained and agent-designed starting approaches before full version-one completion.
2. Start a run and observe multiple autonomous candidate experiments without inter-experiment permission requests. Inspect each tested code revision, attempted idea, visible activity, metrics, and decision afterward, including failures and rejected candidates.
3. Demonstrate primary-score selection, secondary tie-breakers, constraint rejection, and evaluation of the saved best-validation checkpoint. Compare each newest experiment with the best validated model so far, and allow either eligible model to be selected when all ranking metrics tie. A transient live target does not finish a run.
4. Demonstrate the required stopping-expression types and distinct Pause, Finish, and immediate Stop behavior with recorded reasons and counters. Candidate attempts include failures and interruptions for the experiment limit, the baseline is separate, and failures/interruptions do not change primary-metric stagnation.
5. Run isolated sessions on separate instances, reject a conflicting reservation across projects, and demonstrate both providers, both research agent integrations with model choice, and multi-GPU execution before calling version one complete.
6. Confirmed native close pauses active runs. Persistent loss of the controller produces bounded remote completion and a paused run, followed by visible recovery and explicit Resume.
7. After a run ends, inspect its local history and activity records and access its selected retained model when one exists. Inspect whole-run graphs and averages/statistics without opening experiments individually, and inspect individual-experiment metric graphs. These historical views remain available when non-winning checkpoints have been removed. See the cloud-instance warning while provider lifecycle remains manual.
8. Determine whether research improved under the recorded metric and conditions. A useful run need not guarantee a scientific improvement; a truthful, inspectable negative result also satisfies the observability goal.
9. Test a training-only augmentation or balancing change midway through a run while preserving original split membership and evaluation inputs. Compare the new completed validation result with the incumbent's stored result. Keep optional test scores separate from research acceptance and agent context.

### Design follow-up register

The Goldfish findings are retained as design questions and verification topics. Their presence here does not approve optional features or a particular architecture. The design must explain how the already agreed behavior is achieved and identify any proposed additions that still need user approval.

| Topic and report references | Work to resolve during design |
| --- | --- |
| Credential handling — [finalized-document review F01](../egm/goldfish_reviews/2026-11-13/finalized_document_review/consolidated_review_report.md#f01--credential-handling-needs-an-explicit-design-follow-up--major-new) | Define which setup, research, and provider-integration components may access each credential. Specify how authentication material is excluded or redacted from conversations, command/tool arguments and results, logs, retained history, and later agent context before persistence or reuse. Define how to contain and handle accidentally emitted secrets without reproducing their values in further records. Credential storage, access mechanisms, redaction coverage, and exposure-response details remain design decisions; no mitigation has been implemented yet. |
| Stopping expressions and execution bounds — M01, M02 | Explain AND/OR semantics and condition values. Specify behavior for setup, repairs, agent calls, compilation, evaluation, finalization, and hung multi-GPU work. Decide whether additional safeguards are needed without silently changing counters or adding mandatory run-level limits. |
| Retention and observation failures — M03, M04 | Define peak-space checks, safe cleanup, protection of source models used by dependent runs, transfer failures, and visible log truncation or collection failures. Preserve metric/activity history when non-winning weights are removed. |
| Research input identity and compatibility — M05, M08, M09, M16 | Define supported task/model/initialization combinations and environments, fixed dataset/split/evaluator identity, compatible architecture edits with fixed weights, and hardware preflight. Preserve both providers, both agents, multi-GPU support, and permission to change hardware after warning. |
| Recovery and upgrades — M06, M07, M15 | Define attempt identities, one reconciled outcome, control/completion precedence, reservation release, stale observations, safeguard health, and app/remote compatibility. |
| Setup and result interpretation — M12, M13, M14, N02 | Define code source versus initialization, pending controls in each phase, score labels and comparison explanations, and actionable preparation failures. Final UI layout is not specified here. |
| Resolved product clarifications — M10, M11 | Implement constraint-aware checkpoint selection and keep test scores out of agent context, while exposing validation results, constraints, and acceptance explanations. |
| Accepted provider-cost limitation — N01 | Research stopping leaves provider lifecycle manual; preserve the human-written still-running warning and do not imply provider charges end with research. |

Agent authentication/integration feasibility, numerical tie precision, deterministic tie selection, detailed log/storage limits, metric aggregation choices, exact counter-check timing, and native-close failure behavior also remain design work. Project setup defaults, generation timing, and the smaller implementation milestone remain labeled recommendations carried forward for design consideration; approval of the brief does not silently convert every recommendation into a fixed implementation choice.

### Next steps and review boundary

1. Completed: the user reviewed the anchored hypothesis and explicitly authorized Goldfish review on 2026-11-13.
2. Completed: all seven EGM fresh-context brainstorming lenses reviewed the immutable input on 2026-11-13. Their actual reports and the deduplicated findings are saved under `docs/egm/goldfish_reviews/2026-11-13/`; the Analysis section records the results and review limitations.
3. Completed: the user resolved checkpoint eligibility (M10), test-score exclusion from agent context (M11), validation-based research acceptance, fixed splits, and training-only augmentation. Remaining operational advice is explicitly tracked in the design follow-up register. The user confirmed alignment with the final brief, its success criteria, and its labeled recommendations on 2026-11-13.
4. Await the user's handoff choice. Start egm-draft only on explicit instruction; no formal design drafting, publishing, or implementation has been authorized by the final brief confirmation alone.
