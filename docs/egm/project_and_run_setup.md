# Proposed project and run setup

**Status:** Working recommendation with user-confirmed refinements; not an approved concepts brief.
**Author:** igrgin
**Date:** 2026-11-12

**Review handoff:** The consolidated [EGM concepts brief](../designs/concepts_brief.md) now contains the complete foundation from the initial prompt and subsequent discussion, a retention recommendation, open decisions, and proposed success criteria. Use that brief for the readiness gate. These notes preserve the earlier discussion and recommendations.

**2026-11-13 decision:** The user approved completed post-training validation results for acceptance, ranking, and metric-target stopping. Separate held-out scores are recorded as an assessment and do not determine keep/discard or stopping. Earlier open-question language about this policy below is historical; the concepts brief records the agreed rule.

**2026-11-13 scope amendment:** The user approved previous-run fine-tuning for version one using that run's retained final model with matching code and configuration. The new run establishes a baseline under its own settings; each candidate restarts from the same source weights with fresh optimizer state. Earlier references to this feature as unapproved below are historical. The concepts brief records the current agreement.

**2026-11-13 Stop decision:** Stop interrupts the current experiment, records it as interrupted, preserves history and the selected model, and leaves the run resumable. Resume starts a fresh experiment from the last accepted code with the run's fixed initialization. Finish remains the control that permanently completes a run.

**2026-11-13 retention and observability decision:** The user accepted retaining each experiment's metrics, code reference, description, outcome, explanation, and visible agent activity; one selected best checkpoint per completed run with matching code/configuration and evaluation results; and execution checkpoints while needed. Other checkpoints may be removed after evaluation. Whole-run historical metrics, graphs, averages, and statistics must be available without opening individual experiments; individual experiments also have metric graphs. Removing checkpoints does not remove their recorded metric history. Exact cleanup limits and chart/statistic choices remain for design.

**2026-11-13 counting decision:** Every started candidate attempt counts toward the experiment limit, including failures and interruptions; baseline execution is separate. Stagnation counts completed, valid candidate experiments without primary-metric improvement. Failures and interruptions neither increment nor reset stagnation and have separate counts. Secondary-only improvements and accepted simplifications do not reset primary stagnation. The concepts brief carries the agreed definitions; exact condition-check timing and failure safeguards remain design work.

**2026-11-13 experiment acceptance clarification:** Compare the newest completed experiment's evaluated checkpoint against the run's best validated model so far using the configured constraints, primary metric, and secondary metrics. A better candidate replaces the incumbent; a worse or ineligible candidate is discarded. If all ranking metrics tie, both eligible results are acceptable and one is selected. Simpler code is not an additional requirement. Preserve the result and selection explanation for tied candidates. The incumbent checkpoint is a comparator, not the next experiment's training initializer.

**2026-11-13 final split/augmentation clarification:** The user accepted validation-based checkpoint selection, experiment acceptance, and metric-target stopping. Optional test scores are separate assessments and excluded from agent context, including later-run summaries. Source examples, labels, and split membership stay fixed within a run. Training-only augmentation, sampling, and loss weighting may change in committed experiments. Actual source-data, label, split, or evaluation-procedure changes require a new run and baseline. Cached incumbent scores may be reused when evaluation conditions match. These agreements refine the earlier blanket data-loading protection; the consolidated concepts brief is current.

## Recommended boundary

A project defines the task and dataset being researched. A run defines one research session: its starting model or code, objective, research agent integration and model, hardware, training budget, and stopping rules. Experiments change the permitted training code within that run.

This keeps project creation short while allowing the same dataset to support fine-tuning an external model, fine-tuning a model produced by an earlier run, and researching an architecture created by the agent.

## User refinements and proposed addition

- Run configuration must identify both the research agent integration (Codex or Claude) and the model used by that agent. This model is distinct from the PyTorch model being trained.
- The selected dataset must be copied or moved into the project folder. Referencing only its original external folder is insufficient. Copying by default is a recommendation; whether moving is also offered remains open.
- Model ranking uses one primary validation metric. Secondary validation metrics break ties in the primary score. Optional lower or upper bounds on additional values determine whether a candidate is eligible. Secondary metrics are ranking criteria, not a request for statistical proof.
- Autonomous editing follows Karpathy's autoresearch boundary: the agent may change model architecture and training code, including layers, model size, optimizer, hyperparameters, batch size, and training-loop implementation. This explicitly includes agent-designed custom networks. The evaluation procedure, data-loading and split definitions, configured training budget, and dependency set are protected during the loop.
- Every run must configure a fixed training duration for each experiment. This required setting is shown alongside metric and run-stopping settings. It limits each experiment's training independently of the Boolean expression that determines when the run finishes.
- A paused run may resume on different hardware. Warn the user that hardware differs from the earlier experiments and may affect training behavior, scores, and comparability, but allow the user to proceed. Do not force a new run merely because the hardware changes.
- After persistent loss of application contact, automatically pause research after bounded completion of the current experiment. Preserve remote results, reconcile on reconnection, and require explicit Resume once paused. Keep the resource reserved until the application's remote work is confirmed stopped. This recovery policy stops only the application's work; provider lifecycle is manual as agreed below.
- Provider instance lifecycle management is manual in version one. The app stops its own research work and leaves the instance running. Show a human-written warning in the UI: "Research was stopped. Cloud instance is still running." The warning's exact location remains a design choice. Use wording appropriate to the actual run outcome while keeping the cloud-instance warning explicit.
- Proposed addition: a new run may fine-tune a saved model produced by a previous run. If adopted, this changes the original version-one prohibition on starting from earlier experiment weights. Which source checkpoint is selected remains open.

These refinements do not imply approval of every recommendation in this document.

## Project creation

| Information | What the user supplies | What the application and setup agent do |
| --- | --- | --- |
| Name | A project name. | Create the project folder and local Git repository. |
| Task | A short description of what the model should predict or produce. | Inspect the dataset and identify any missing information about inputs, labels, or expected outputs. Ask only where the description and files are insufficient. |
| Dataset | A local folder containing the downloaded dataset. | Copy or move the dataset into the project folder, inspect its layout, and record the data used by the project. Recommend copying by default so the original remains available. Do not silently reinterpret later changes as the same dataset. |
| Data splits | Confirm existing training, validation, and optional held-out evaluation splits, or approve proposed splits if the dataset has none. | Establish consistent splits and the evaluation procedure so runs can be compared. |
| Optional defaults | Defaults the user wants to reuse, including metric and direction, research agent integration and model, training budget, or stopping expression. | Prefill future runs without changing configurations already saved by runs. |

A project can be named and saved before all research inputs are ready. Its task, usable dataset, and agreed splits are required before research starts. The wizard should obtain these through a short guided interaction rather than requiring the user to specify network layers or write a training script.

The dataset and task belong to the project because changing either changes the research problem. Dataset editing and version management beyond recording the data used are not proposed as additional version-one features.

## Run setup

| Information | Recommendation |
| --- | --- |
| Starting approach | Choose an external pretrained model, a retained trained model from a previous run, or an architecture the agent designs for the task. |
| Pretrained model | Supply a Hugging Face model URL or identifier. Resolve and record the exact model revision and starting weights. A built-in model marketplace is not required for the first version. |
| Previous run's trained model | Start a new fine-tuning run from a retained checkpoint produced by a previous run, with its matching model definition and required input processing. Record the source run, experiment, code, and checkpoint. The checkpoint selection rule remains open. |
| Existing code | A run may also start from the project's initial code or a selected earlier experiment, carrying forward the relevant history. Code reuse and trained-weight reuse are explicit separate choices. Selecting earlier code alone does not imply loading its trained output weights. |
| Research objective | State what the agent should try to improve and any constraints. |
| Ranking metrics | Choose one primary validation metric supported by the project's evaluation procedure and whether to maximize or minimize it. Optionally select secondary validation metrics to break primary-score ties. Recommend an explicit order and maximize/minimize direction for each secondary metric. |
| Optional constraints | Configure lower or upper bounds on additional measured values. A candidate must satisfy every configured constraint before it is eligible for ranking. |
| Research agent | Choose the Codex or Claude integration and the specific model used by that agent. Save both in the run configuration. Model availability, authentication, and integration remain open; this setting is distinct from the model being trained. |
| Hardware | Assign an existing running Runpod Pod or Vast.ai instance, including its GPU allocation, subject to application-wide exclusive reservations. A paused run may resume on different hardware after a warning about affected comparisons; changing hardware does not require a new run. |
| Experiment training duration | Required fixed amount of training time for each experiment in the run. Show it alongside metric and run-stopping settings. The autonomous agent cannot change it. Rules for user-initiated budget changes or hardware changes remain open. |
| Stopping expression | Configure the required nested AND/OR expression. Detailed counting and timing rules remain open. |

Metric selection remains a run setting, following the user's latest direction. A project may provide a default. Results from different metrics or evaluation procedures must be identified as different comparisons rather than combined into a single improvement claim. Merely choosing a metric name is insufficient if its calculation has not been implemented and checked for the task.

## Experiment duration and run stopping

Each run requires a fixed training duration that applies to every experiment, including its baseline. Reaching that duration ends the experiment's training and leads to the already agreed selected-checkpoint evaluation, result recording, and acceptance decision. A failure or user interruption can end an attempt before that normal completion.

The duration is separate from the required run-stopping expression. It is not a Boolean condition that may be bypassed by an OR group, and it does not itself finish the run after the first experiment. After completing and recording an experiment, the run continues only if its run-stopping rules and user controls allow another experiment.

The autonomous agent cannot extend its training duration or stop training early merely because a live metric reaches the run's target. The existing requirement remains: a metric target requires a completed, valid evaluation.

Following the reference, recommend measuring training time separately from startup, compilation, and final evaluation. The user has confirmed the fixed training duration but has not yet settled detailed accounting, periodic-validation overhead, or the execution timeout used to identify a stuck experiment. These are distinct from the configured training duration.

## Resuming on different hardware

The user permits resuming the same paused run on different hardware. Before resuming, show a warning that the selected hardware differs from the hardware used for earlier experiments and that training behavior and measured results may change. The warning informs the user's choice; it does not block the hardware change or require a replacement run.

Record the hardware and GPU allocation used for each experiment and identify where a hardware change occurred in the run history. This supports the warning and lets the user distinguish results measured under different conditions. Equal training duration does not guarantee equal work completed or directly comparable scores after a hardware change.

The normal application-wide resource reservation checks still apply to the new assignment. Permission to change hardware does not grant permission to use an instance reserved by another active run.

No requirement to rerun a baseline, reset stopping counters, discard earlier results, or change the experiment training duration has been agreed. The brief should retain those comparison-policy details as open rather than infer them from permission to resume on different hardware.

## Behavior when application contact is lost

**Status:** Agreed after the user reviewed and accepted the recommendation.

Use a short reconnection grace period followed by an automatic pause. This should cover loss of the application-to-instance connection, application failure, and macOS sleep when the application can no longer supervise its work. The application should not depend on receiving a final shutdown message to enforce this policy.

1. A temporary communication loss is shown as disconnected, not immediately reported as an experiment failure. Give the connection a brief opportunity to recover. The exact grace duration is a design detail, not a new user-facing setting required by this recommendation.
2. If contact does not recover within that grace period, the instance stops launching new experiments and stops further agent-led exploration. If no training experiment is executing, preserve any unfinished work as an untested attempt and pause.
3. If a committed experiment is executing, let that one bounded experiment complete its remaining training and evaluation. Save its selected checkpoint, metrics, and logs remotely. Enforce a separate hard execution timeout so a stuck training or evaluation process cannot continue indefinitely. If completion is impossible, stop the application's processes and record an interrupted or failed outcome as appropriate to the actual cause.
4. Pause after the current experiment. Record its acceptance decision if the required decision-making component is available. Otherwise mark the decision as pending; retain the candidate and do not advance or discard it until reconciliation. Disconnection alone is not evidence that an experiment failed or that a change should be rejected.
5. On reconnection or application restart, reconcile the actual remote state, retrieve saved results and artifacts, and settle any pending outcome before offering Resume. Once the remote safeguard has paused a run, require the user's explicit Resume action. A restored network connection alone does not restart research. Reconnection during the grace period can continue the existing session after checking its state.

This requires a remote safeguard that can detect loss of application contact and enforce the bounded completion and pause behavior without the Mac. The mechanism is a design choice; the behavioral guarantee is that losing the controller cannot leave an unrestricted research loop running. Separate execution limits are needed for training and finalization work; the training duration alone cannot bound an agent or a hung evaluator.

Keep the application's resource reservation while remote activity is unknown. Release it for other runs only after confirming the application's work has ended. A missing connection must not make an instance appear free while its experiment may still be running. If an instance disappears, preserve the recorded history and report the unresolved or interrupted attempt; do not claim that missing artifacts were recovered.

Apply this policy only to the application's agent and experiment processes. It does not stop or destroy the provider instance or stop unrelated external processes. The subsequent provider-lifecycle decision below establishes manual management for version one.

The trade-off is that a persistent outage ends autonomous progress after the current experiment, even if the cloud machine remains healthy. It avoids both unbounded unattended research and unnecessarily discarding a nearly completed bounded experiment. Immediate Stop retains its already agreed interrupt behavior; ordinary Pause and graceful native close retain their already agreed complete-and-record behavior. A decision pending after unexpected disconnection is a recovery state, not a redefinition of a successfully completed graceful pause.

## Provider lifecycle policy for version one

**Status:** Agreed for version one. The user requested a UI warning written as complete, human-readable sentences.

Version one stops only its own research work and leaves provider instance lifecycle management to the user. Apply this after Pause, Finish, immediate Stop, a stopping expression, native application close, and automatic pause following persistent disconnection. None of these research actions automatically stops, restarts, terminates, or destroys the provider instance.

After the application's processes are confirmed stopped, release its reservation. Keep research state and provider state distinct in the interface. Present the ongoing-instance message as a UI warning, with the user's preferred wording: "Research was stopped. Cloud instance is still running." For paused or completed research, describe the actual outcome in a full sentence while keeping the cloud-instance warning. The exact warning location is deferred to UI design. When contact is unavailable, show the provider state as unknown until it is verified. Do not describe a machine as globally idle merely because the application's research has ended; unrelated external processes may exist.

Show that a running instance can continue incurring provider charges and provide a link to its provider management page so the user can stop it manually. This is an observation and handoff, not a proposed provider-management subsystem.

Reasons for recommending this first-version boundary:

- The user provisions and starts instances outside the application. Its reservation authorizes exclusive use among its own runs, not control over unrelated processes on the instance.
- Stopping can change restart availability and storage behavior. [Runpod documents](https://docs.runpod.io/pods/manage-pods) that stopping releases its GPU and clears container disk data, while persistent volume data survives and continues incurring storage charges. [Vast.ai documents](https://docs.vast.ai/guides/instances/manage-instances) that stopping preserves instance data, continues storage charges, and restarting depends on GPU availability.
- Safe automatic instance shutdown would require additional provider actions, authorization behavior, artifact-persistence checks, and restart expectations. Supporting both providers amplifies this cost. The recommendation keeps those concerns outside version one while preserving both provider integrations for discovering, assigning, observing, and running research.

The cost of this simpler policy is explicit: a completed or paused run can leave paid compute running until the user stops it. Automatically pausing the research loop after loss of application contact does not eliminate provider billing. The application must make this distinction visible rather than imply that pausing research stops the rental.

Automatic instance stopping is an alternative considered, not an approved feature. If the user prioritizes automatically eliminating idle compute charges, reconsider this boundary explicitly rather than silently implementing shutdown. Automatic termination or destruction is not recommended.

## Ranking and eligibility

The user clarified the intended ranking behavior:

1. Require a valid completed evaluation and satisfaction of the optional constraints.
2. Compare eligible candidates by the primary validation metric in its configured direction.
3. If primary scores are equal, use the secondary validation metrics to rank the tied candidates.

A better secondary score cannot compensate for a worse primary score or a failed constraint. The metrics are not combined into a weighted score. Constraints and tie-breakers serve separate purposes even if they refer to the same measured value.

Recommended refinement: give secondary metrics an explicit priority order and their own maximize/minimize directions. Compare the first secondary metric, then the next only if there is still a tie. Numerical tie precision or tolerance and the outcome when every configured metric ties remain open details. Formatting two distinct values to the same displayed number should not silently make them equivalent.

These ranking rules explain how to choose among candidate models; they do not change the original requirement that primary-metric stagnation only resets when the primary metric improves. A secondary-only improvement is not a primary improvement. Whether the same ranking is used for within-experiment checkpoint selection, between-experiment acceptance, and the source model offered for a future fine-tuning run should be made explicit in the concepts brief. The role of the post-training held-out evaluation in acceptance remains open.

## Preparation before autonomous experimentation

Before the first autonomous experiment, the setup agent prepares the model-specific training code, required evaluation integration, autoresearch instructions, and basic AGENTS.md. It checks data loading, model output compatibility, metric calculation, and execution on the assigned hardware. It then establishes a baseline using the same checkpoint selection and final evaluation procedure as candidates.

The user describes the task and chooses the research settings; the setup agent handles the initial architecture and training implementation. Preparation may ask about unresolved task or data meaning. After the user starts the prepared autonomous loop, the agent does not ask permission between experiments.

Generating model-specific code during run preparation updates the original decision that project creation produces the complete working training project. The timing change is a recommendation, not yet agreed. Whether model-independent evaluation files are prepared at project creation or immediately before the first run does not need an architecture decision now.

Both initial approaches still produce PyTorch research code. Downloading a model is distinct from importing an existing application repository, which remains out of scope. Version one should validate compatibility with the supported training setup rather than promise that every Hugging Face repository can be trained automatically. The exact supported task and model range remains open.

## Autonomous editing boundary

The user accepted the scope defined by Karpathy's autoresearch instructions and explicitly included editing the layers and training choices of custom models. Apply that boundary to the generated project by responsibility rather than requiring every project to put its training implementation in a single file.

During autonomous experimentation, the agent may change:

- Model architecture, including the number and types of layers, their connections, and model size.
- Optimizers, learning-rate schedules, regularization, hyperparameters, and batch size.
- Training-loop implementation within the configured experiment budget.

The agent may not change the protected evaluation implementation, metric definitions, data-loading and split definitions, or configured training budget to make a candidate appear better. It may not install new packages or modify the dependency set during this loop. The original [program.md](https://github.com/karpathy/autoresearch/blob/master/program.md) makes its preparation/evaluation module read-only and limits experiments to the existing dependencies.

The same training-code permissions apply to pretrained-model and custom-model approaches. Changes must remain compatible with the selected initialization procedure; the agent cannot silently replace the run's recorded source weights or objective. A change that cannot execute successfully has a failure outcome under the already agreed experiment model.

Setup must produce a working baseline and define which generated files contain editable training responsibilities and which are protected. Its dependency and evaluation preparation happens before the autonomous loop; exact setup permissions and checks remain to be defined. Selecting a model with additional requirements is not permission to change dependencies midway through a run.

This boundary defines allowed behavior, not an implementation for enforcing it. The concepts brief should preserve evaluation protection while leaving enforcement architecture for design.

## Fresh training and pretrained weights

Fine-tuning initializes a model from externally pretrained weights. PyTorch documents this distinction from random initialization in its [transfer learning tutorial](https://docs.pytorch.org/tutorials/beginner/transfer_learning_tutorial.html).

The user has proposed fine-tuning from a previous run's saved model. Adopting this option would revise the original blanket prohibition on using experiment output weights as inputs. Recommended rules for keeping the new run's experiments comparable:

- For fine-tuning an external model, every experiment starts again from the same recorded external pretrained checkpoint.
- For fine-tuning a previous run's model, select and record its source checkpoint when setting up the new run. Every experiment in the new run starts again from that fixed checkpoint. This per-experiment behavior remains a recommendation pending confirmation.
- For an architecture trained from scratch, every experiment initializes its model afresh.
- Experiments do not automatically carry training progress from one candidate into the next. Fine-tuning from a previous run starts a new training procedure; restoring an interrupted experiment's optimizer or training progress remains outside version one.
- Each experiment still saves and evaluates its best validation checkpoint, as already agreed.

Reusing a retained checkpoint requires compatible model code and input processing; weights alone are not a complete starting model. The new source option therefore depends on artifact retention, whose wider policy remains open. Availability must be checked before starting a run.

Record the exact external model version so a later upstream update cannot silently change the starting point. Hugging Face supports downloads at a [specific repository revision](https://huggingface.co/docs/huggingface_hub/en/guides/download).

## FER2013 walkthrough

1. Create a project named FER2013, select the local dataset folder to copy or move into the project folder, and describe the task as predicting facial emotion from an image.
2. The setup agent inspects the data and presents its interpretation of the labels and existing splits for confirmation. It asks about ambiguities instead of inventing their meaning.
3. Configure a run: starting model or existing code, primary metric and direction, research objective, research agent integration and model, hardware, training budget, and stopping expression. A retained trained model from a previous run is an allowed starting source.
4. The setup agent prepares and checks the training and evaluation setup for that selection, then establishes the baseline before candidate changes.
5. Research proceeds under the already agreed autonomous experiment loop. A separate run may investigate another starting approach against the same task and data; comparison must account for differing metrics, budgets, and pretrained starting points.

No particular architecture, model identifier, metric, split interpretation, or training duration for FER2013 is selected by this recommendation.

## Alternatives and scope

- Name-only creation can remain the first action, but task and dataset information cannot be omitted before research begins. The application cannot infer the intended prediction task reliably from a folder name.
- Putting the starting model permanently on the project would make it harder to compare different model approaches on the same task. Recommend a run setting, optionally prefilled from a project default.
- Requiring a full architecture specification from the user would conflict with the requested agent-designed model path. Recommend that the setup agent creates it.
- A built-in Hugging Face browsing interface adds discovery UI beyond accepting and validating a selected model reference. Recommend accepting a URL or identifier first; this staging suggestion is not an agreed removal of model selection.
- Keeping a primary metric fixed for the whole project would simplify ranking, but the user has moved metric selection to runs. Recommend preserving that choice and keeping comparisons explicit.
- External pretrained models and agent-designed architectures remain in scope, alongside both research agent integrations with model selection, both cloud providers, and multi-GPU instances. Fine-tuning from previous runs is the user's proposed scope addition. This document does not settle their implementation or remove agreed capabilities.

## Source check: how autoresearch selects results

Checked against upstream sources on 2026-11-12. These findings explain existing implementations; they do not approve new application policies.

Karpathy's [program.md](https://github.com/karpathy/autoresearch/blob/master/program.md) uses validation bits per byte (`val_bpb`), minimized. The agent first establishes a baseline, commits each candidate, trains, reads the evaluation, logs the outcome, and keeps an improved code revision or reverts a non-improvement. Memory is a soft constraint; simplicity is a judgment call. Its simplicity guidance permits an approximately equal result with simpler code, while its numbered loop says equal or worse scores are reverted. Our acceptance rules need to resolve that ambiguity explicitly.

In the original [train.py](https://github.com/karpathy/autoresearch/blob/master/train.py), each process initializes a fresh model, trains for its budget, and evaluates the final model. The script does not select a best checkpoint during training or save trained weights. The best code recipe and a retained trained checkpoint are therefore different concepts. The application's already agreed checkpoint selection and artifact retention go beyond this original script.

The protected [evaluate_bpb function](https://github.com/karpathy/autoresearch/blob/master/prepare.py) computes the score on validation data. A fixed evaluator and comparable experiment conditions support the comparison; they do not constitute statistical proof that an observed gain will generalize. The original script does not implement repeated-seed confirmation or a separate post-search test evaluation.

Selected adaptations show different policies, not one universal autoresearch standard:

- [trevin-creator/autoresearch-mlx](https://github.com/trevin-creator/autoresearch-mlx/blob/main/program.md) retains the lower-validation-BPB keep/revert policy and explicitly requires establishing a baseline on the actual hardware.
- [GuillaumeErhard/autoresearch-cifar10](https://github.com/GuillaumeErhard/autoresearch-cifar10/blob/main/program.md) maximizes `best_test_acc`. Its [training script](https://github.com/GuillaumeErhard/autoresearch-cifar10/blob/main/train.py) evaluates after each epoch and records the best observed accuracy, but does not save the corresponding checkpoint. Its [evaluator](https://github.com/GuillaumeErhard/autoresearch-cifar10/blob/main/prepare.py) uses the CIFAR-10 test split. Because that score guides the search, the split functions as validation for this research process; it is not an independent final test. This is a reason to preserve the application's distinction between validation and held-out evaluation.
- [uditgoenka/autoresearch](https://github.com/uditgoenka/autoresearch/blob/master/guide/autoresearch.md) generalizes the loop to a chosen numeric metric and direction plus an optional guard command. Its documented keep rule requires an improved metric and a passing guard. It is a general optimization adaptation, not evidence about ML checkpoint selection.

The user subsequently clarified the application rule: primary validation metric first, secondary validation metrics as tie-breakers, and optional bounds as eligibility constraints. The earlier reference to proof meant these additional ranking criteria, not statistical confirmation. Preserve the existing within-experiment rule of saving the best validation checkpoint and evaluating it after training. How final held-out results affect acceptance and ranking still needs to be settled; this research does not silently replace the earlier evaluation agreement.

For the proposed previous-run fine-tuning option, recommending the source run's best eligible completed result is more natural than asking the user to choose among all checkpoints without guidance. Exact eligibility, ties, acceptance status, and source retention remain open.

## Decisions still needed

The broader proposed project/run boundary still needs user feedback. For fine-tuning from previous runs, checkpoint selection and the recommendation to reuse one fixed starting checkpoint throughout the new run need clarification. Dataset copying is the recommended default; offering a move operation is not settled. The autonomous editing boundary, prohibition on dependency changes, required fixed training duration per experiment, permission to resume on different hardware after a warning, automatic-pause recovery after persistent loss of application contact, and manual provider lifecycle management with a human-written UI warning are established. Setup permissions and the supported dataset/model range, research agent model selection behavior, detailed time accounting and execution timeouts, baseline/counter policies after hardware changes, user-initiated budget changes, remaining lifecycle details, retention, stopping semantics, observations, and success criteria remain for the continuing brainstorm. This document authorizes no Goldfish review, formal design, or implementation.
