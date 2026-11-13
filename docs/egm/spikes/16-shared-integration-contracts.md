# Shared integration contracts — spike decision and evidence

Date: 2026-11-13. Issue: [#16](https://github.com/igrgin/autoresearch-lab/issues/16).
Status: research decision for review; **not an approved product specification** or permission to implement.

## Decision and scope

Use language-neutral records and command/event boundaries with one logical owner per record. Provider and agent adapters translate vendor identities, capabilities, observations, and errors; they do not decide experiment acceptance, run lifecycle, or reservation release. Preserve immutable saved run settings and research input references through every attempt, evaluation, and decision. Distinguish command acknowledgement, confirmed operation completion, experiment execution, evaluation validity, acceptance, and artifact availability.

This is a contract vocabulary and minimum interoperability decision. It selects no application language, database, IPC transport, deployment topology, or distributed ownership algorithm. Those choices must realize these semantics rather than exposing their storage types to every component. [#15](https://github.com/igrgin/autoresearch-lab/issues/15) owns stack and persistence. The approved [concepts brief](../../designs/concepts_brief.md) takes precedence; the [design sitemap](../../designs/SITEMAP.md) identifies approved records.

First proof route remains **Runpod + Codex + external pretrained initialization + one GPU**. Vast.ai, Claude, agent-designed initialization, previous-run selected-model initialization, concurrent isolated runs, and multi-GPU execution remain full v1 scope. Unsupported capabilities must be visible, not used to redefine that scope. Provider provisioning and automatic start/stop/termination remain excluded.

## Evidence that constrains the boundary

These are current primary-source observations, retrieved 2026-11-13. Contract consequences below are this spike's design judgments, not vendor guarantees.

| Verified integration fact | Contract consequence |
| --- | --- |
| Runpod API v2 discovery is cursor-paginated; list examples have `runtime=null` and `ssh.direct=null`, while detail exposes runtime/direct-SSH information. Responses also contain environment fields. [List Pods](https://docs.runpod.io/api-reference-v2/pods/list-pods), [Pod detail](https://docs.runpod.io/api-reference-v2/pods/get-a-pod) | Normalize complete discovery separately from access/telemetry readiness; list nulls alone do not prove unsupported capabilities. Project safe fields instead of retaining raw responses. Follow #34's selected v2 route. |
| Runpod documents basic SSH without SCP/SFTP and full SSH with SCP/SFTP. [SSH connection methods](https://docs.runpod.io/pods/configuration/use-ssh#connection-methods) | Remote connectivity and artifact transfer are separate capabilities. A reachable shell does not prove file-transfer support. |
| Vast.ai documents paginated instance discovery with a cursor and distinct desired/actual state fields. Its example response also includes environment and token-bearing fields. [Show instances](https://docs.vast.ai/api-reference/instances/show-instances) | Hide pagination behind the adapter or expose a normalized cursor; represent incomplete discovery; never equate raw inventory with a safe retained record. |
| Codex app-server has thread/turn/item identities, initialize/initialized negotiation, version-specific generated schemas, and a turn interrupt request. An error with `willRetry` can leave the turn active; terminal status arrives separately. [Protocol, schema, lifecycle, and errors](https://learn.chatgpt.com/docs/app-server) | Preserve vendor correlation separately from application identity. An error notification or cancellation acknowledgement is not a terminal experiment outcome. Pin adapter fixtures to the tested upstream version, following #44's selected App Server route. |
| Claude Agent SDK streaming input supports interactive interruption; single-message input does not support real-time interruption. [Streaming and single-message input](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode) | Capabilities depend on integration mode as well as vendor. #49 must prove a compatible control path; a simple one-shot call is not evidence of the required Stop behavior. |
| Hugging Face downloads accept a revision; the default follows `main`, and commit-pinned downloads require the full commit hash. [Specific versions](https://huggingface.co/docs/huggingface_hub/guides/download#from-specific-version) | Store resolved immutable model revision and input-file identities, not only a model name or moving branch. #27 owns supported combinations and package details. |

No provider account, rented hardware, authenticated agent action, model download, or training was exercised. These sources establish constraints, not production feasibility or supported-model entitlement.

### Decisions published during this investigation

Live rechecks found completed decisions for [task/data preparation #22](https://github.com/igrgin/autoresearch-lab/issues/22#issuecomment-6859424772), [Runpod #34](https://github.com/igrgin/autoresearch-lab/issues/34#issuecomment-6859427760), [Codex #44](https://github.com/igrgin/autoresearch-lab/issues/44#issuecomment-6859425713), and [Claude #49](https://github.com/igrgin/autoresearch-lab/issues/49#issuecomment-6859442290). Consume their decisions rather than reopen them: fixed confirmed data/split membership and model-specific run preparation; Runpod v2/direct SSH/SFTP with remote UUID inventory; local supervised Codex App Server actions; and a local Claude SDK worker with scoped tools and fresh-session recovery from safe application records. These are owning-spike decisions, not implementation proofs or a choice for #15's desktop stack. Authentication details remain in their owners' decisions and #17, not a new credential policy here.

Their contributions require shared action identity, selected/observed model metadata, phase/input/workspace references, finite bound-policy references, structured-output validation evidence, partial-effect receipts, and explicit activity gaps. SDK/native history is not a portable replay guarantee: Codex supports evidence inspection subject to its policy checks; Claude's selected no-native-session-persistence route requires fresh-session recovery. Record capabilities accordingly.

## Components and record ownership

An owner validates and publishes authoritative logical changes. Storage is a mechanism used by owners, not another domain authority. UI views and history projections read records and submit commands; they do not write outcomes directly. Local and remote replicas preserve original identities and provenance. The local/remote authority handoff, fencing, recovery, and process-enforcement protocol belongs to #54/#73; this table does not select it.

| Record / identity | Logical owner | Required identity and references; mutation rule |
| --- | --- | --- |
| Project / `project_id` | Project catalog | Stable application ID, name, project-folder binding, repository binding, task reference. Rename or relocation preserves ID; name/path is not identity. Defaults are separately revisioned inputs. |
| Saved run configuration / `snapshot_id` | Run configuration component | Immutable resolved settings associated with `project_id`, `run_id`, objective, agent integration/model choice, code source, initialization procedure, task/data/split/evaluator identities, metric/constraint policy reference, training-duration setting, stopping-expression reference, selected hardware intent. Record defaults' origin revisions for explanation; never reread changed defaults during execution. |
| Prepared inputs / `manifest_id` | Trusted project/run preparation component | Snapshot, confirmed task/data/split references, resolved initializer revision/content, matching processing and environment identities. Publish immutable manifests; reject unresolvable or incompatible inputs before launch. Dataset/split records remain preparation-owned under #22/#25, not agent-owned edits. |
| Run / `run_id` | Run coordinator | Project, configuration revision references, run branch/work-directory binding, accepted-code/result references, state revision, pending control references. Actual hardware allocations are recorded per attempt. Any permitted explicit settings change creates a new snapshot; which changes are permitted is not decided here. |
| Candidate / `candidate_id` | Research coordinator, accepting agent proposals | Run, hypothesis, description relative to last kept commit, immutable tested commit, accepted-base commit and comparator result at proposal time. Agent output is a proposal, not an accepted result. A repaired code revision gets a new candidate identity. |
| Attempt / `attempt_id` | Execution component | Run, snapshot, candidate (absent for baseline), role `baseline` or `candidate`, tested commit, fixed initializer/input references, actual allocation/reservation, environment/protocol versions, execution action IDs. Each fresh execution gets a new ID, including a rerun of identical code. Dispatch retries retain the ID. |
| Execution outcome / `execution_outcome_id` | Execution component | Attempt, confirmed `completed`, `failed`, or `interrupted`, evidence references and reason. Unknown execution stays unresolved; missing telemetry is not a failure. One reconciled logical outcome per attempt; conflicting evidence is retained for reconciliation, not last-writer-wins. |
| Evaluation / `evaluation_id` and `result_id` | Protected evaluation component | Attempt, selected checkpoint artifact, tested commit, evaluation-context identity, completed validation metrics/constraints and validity evidence. Distinct optional test-assessment record/view, excluded from research context. Final results and live samples have different record kinds. |
| Acceptance / `decision_id` | Research coordinator applying evaluation policy | Attempt, result when available, comparator result and commit for a comparison, policy revision, kept/discarded/pending/not-applicable status and explanation. Decision revisions retain evidence and earlier pending status. Baseline has establishment semantics rather than a fictitious candidate keep/discard comparison. Exact policies remain #61/#73. |
| Reservation / `reservation_id` | Application-wide reservation coordinator | Run, canonical provider/resource key plus access-account metadata, allocated GPU identities, grant revision, confirmation/uncertainty evidence. Grant uniqueness spans projects and credential aliases; an instance is exclusive to its run, even when only some GPUs are allocated. Adapter connectivity never grants/releases a reservation. Release requires confirmed stopped application work under #73. |
| Artifact / `artifact_id` | Artifact registry/transfer component | Producing attempt/result, role, content digest, matching code/config/initializer/input-processing references, dependency references, and locations with independent availability/transfer state. Retained identity/history survives deleted or missing weight bytes. Package/cleanup details remain #92. |
| Event / `event_id` | Component that owns the stated fact | Immutable source event identity, ordered source stream, entity references, version, causation and correlation. History component stores validated safe copies and builds local projections without rewriting producer facts. |
| Operation / `operation_id` | Receiving adapter or domain component | Command, stable idempotency key, caller/entity scope, dispatch state, vendor correlation, progress, final operation outcome or unknown effect. Agent conversation/session/action IDs never replace application run/attempt IDs. |
| Agent action / `action_id` | Agent adapter under coordinator supervision | Project/run and optional attempt, setup/research/repair phase, selected and observed integration/model/effort, input/workspace identity, finite bound-policy references, vendor session/turn/item mapping, mutation receipts, structured-output validation, terminal/effect evidence and activity completeness. One bounded proposal action, not the autonomous experiment loop. |

### Record rules shared by all implementations

IDs are opaque application-assigned strings, unique within their record kind across the workspace, persisted before dispatch, never reused. Fixture labels below are deliberately readable. For Runpod, canonical resource identity is `(provider, resource_id)`; `account_id` is access-scope metadata, not a second reservation namespace. Different credentials/account aliases reaching the same Pod must conflict. Other adapters must document provider ID scope, adding a canonical owner namespace only where IDs are actually owner-scoped; unresolved alias equivalence blocks assignment rather than allowing duplicate grants. Account metadata is an opaque non-secret identity, not an access credential. GPU identity distinguishes concrete devices, not count/display name: #34 selected remote UUID inventory plus current ordinal mapping for Runpod; #54 owns launch/fencing mechanics.

Every record carries `record_kind`, `schema_version`, its stable ID, owner, and relevant project/run/attempt references. Mutable records use a monotonic `revision` and an expected-revision precondition for commands; immutable snapshots/results cannot be silently edited. Corrections append provenance-bearing superseding records/revisions. References must resolve to the same project/run, or be an explicit cross-run initializer dependency. Missing input resolution blocks launch, without replacing pretrained weights with random initialization.

Run configuration is saved before preparation. If resolved data/model/environment identities are not known at save time, preparation publishes an immutable input manifest linked to that snapshot. Launch pins **both** snapshot and prepared manifest. Preparation may resolve a moving requested model revision to an exact revision, but cannot silently change the requested initialization approach. No attempt can depend on mutable defaults, a branch tip, or an unversioned evaluator. Exact identity algorithms and compatibility rules remain #22/#27/#54/#61; stack-specific serialization and digest canonicalization remain implementation work.

## Language-neutral command and observation contracts

The shapes below are semantic field contracts; JSON examples are a portable notation, not a chosen wire protocol or executable schema. `Ref` is a typed stable ID; `Version` is a major/minor pair; timestamps are UTC strings for display/audit, not ordering. Counts and source sequence positions are nonnegative integers; an absent measurement never means zero. Domain-policy payloads are typed, versioned references owned by the relevant spike, not unvalidated arbitrary maps.

| Shape | Required fields and meaning |
| --- | --- |
| Command | `contract_version`, `command_id`, `operation_id`, `idempotency_key`, `kind`, caller/target entity refs, relevant `expected_revision`, `payload`. A retry repeats identity and equivalent payload. Reusing a key with different payload returns `idempotency_conflict` before work. |
| Reply | `command_id`, `operation_id`, `status: accepted \| rejected \| completed \| pending`, typed value or structured error. `accepted` means recorded for processing, not work complete. `pending` carries reason and reconciliation reference. |
| Structured error | `code`, `origin`, `operation_id`, safe `message`, `effect: none \| partial \| unknown`, `retry: never \| after_reconcile \| same_key`, affected entity refs, optional safe vendor code and evidence reference. Error codes include `unsupported_capability`, `authentication_required`, `permission_denied`, `not_found`, `invalid_input`, `conflict`, `idempotency_conflict`, `incompatible_version`, `rate_limited`, `unavailable`, `deadline_exceeded`, `internal`. |
| Capability | Name and version, `availability: available \| unsupported \| unavailable \| unknown`, reason code, observation time, integration/version/mode, and scope (account/resource/model). `unsupported` describes the implementation/mode; `unavailable` describes current conditions. Unknown is not supported. |
| Observation | Typed value plus unit, scope, source, source time when known, and receipt time, or explicit unavailable/unknown reason. Preserve last-good value/time separately from current collection failure. Provider state, transport health, training progress, and safeguard health are separate observations. Receipt time must not imply a known source sample time; staleness thresholds are #73/#86 policy. |
| Event | `contract_version`, `event_id`, `kind`, `producer_id`, `stream_id`, `sequence`, project/run/attempt refs where applicable, `operation_id` where applicable, `caused_by`, `observed_at`, `payload`. Store receipt time separately. `caused_by` refers to commands/events, not wall-clock proximity. |

### Provider, execution, and agent ports

| Port | Operations and returned facts | Authority limit |
| --- | --- | --- |
| Provider adapter | `capabilities`, `discover_existing(cursor)`, `inspect(resource)`, `observe(resource)`, `connection_options(resource)`; discovery returns items, next cursor, and completeness/error status. Connections are opaque runtime handles plus safe descriptors. | Read existing resources; normalize provider identity and state. No renting, provisioning, instance start/stop/termination, reservation decisions, or experiment outcomes. Cancellation of discovery/observation stops that operation only. |
| Execution adapter | `preflight(snapshot, manifest, reservation)`, `submit_attempt(attempt, operation)`, `inspect_operation`, `request_cancel(operation)`, evidence/event retrieval. Return actual environment, allocation, process-scope references, observed execution state and durable outcome evidence. | Scope all actions to application work. No provider lifecycle operations; no keep/discard decisions. #54 selects process supervision and remote transport. |
| Agent adapter | `capabilities`, `list_models`, `start_action(action_id, context_ref, work_scope_ref, selected_model)`, exposed activity, `inspect_action`, `request_cancel(action_id)`, recovery/retrieval where supported. Return vendor session/turn/item mappings, activity kinds, proposed changes and final action status. | A completed agent action is not a completed training attempt. No hidden-reasoning guarantee, direct acceptance, protected evaluation edits, or unrestricted historical-result access. Model choice remains recorded; do not silently substitute another model/integration. |
| Evaluation port | `evaluate(attempt, checkpoint, evaluation_context)`, typed final validation result and separate assessment reference, validity/constraint evidence. | Only protected evaluation publishes final metrics; agent-reported numbers and live training values cannot substitute. #61 owns metric semantics. |
| History/UI port | Safe records/events, versioned run/experiment/project projections, explicit gaps and pending controls; commands back to owners. Separate agent-context projection. | User projections may include separate test assessments; agent context must exclude them, including inherited summaries, logs and tool results. #17/#66 own enforcement, not an arbitrary visibility flag on raw data. |

Required workflow capabilities are checked before launch. Missing optional telemetry yields an explicit unavailable observation; missing safe cancellation, bounded execution, or required initialization support blocks that route until its owning spike supplies a proven compatible path. No claim is made that every upstream exposes operation inspection or replay: adapters must declare unsupported behavior and expose uncertainty; #44/#49/#54 decide reconciliation alternatives.

Agent model discovery carries catalog source, observation time, pagination/completeness, selected and effective identity, and supported effort/mode. Catalog presence is not entitlement proof. A reroute or model discrepancy is recorded and prevents scheduling further actions until resolved under the integration decision. Accept an action proposal only with confirmed terminal success, application-validated structured output and permitted artifact/effect evidence; progress or a plausible final text is insufficient. Bounds are required finite references supplied by the owning policies; this spike sets no numerical limit.

Cancellation has its own `command_id`/`operation_id` and targets an existing operation/action/attempt. Repeating the same cancellation is idempotent. Report `requested`, `confirmed_stopped`, `already_terminal`, `unsupported`, or `unknown`; only scope-specific evidence justifies confirmation. Closing a stream, timing out, or receiving a cancel acknowledgement does not prove training or all child processes stopped. A cancelled agent action does not cancel training by implication. Run Pause/Finish/Stop are domain commands interpreted by the coordinator, not aliases for a vendor cancellation method. #73 owns simultaneous completion/Stop precedence and all run/reservation transitions.

Secret-free durable records are a boundary requirement from the brief: no authentication values, raw environment dumps, credential-bearing URLs, or raw vendor request/response objects in these shapes. Runtime access material is out of band; records contain safe opaque references only. Captured commands, activity, errors, tool results, and model metadata need the #17 safe-recording contract before persistence, display, replay, or agent reuse. This spike chooses no credential store, access entitlement, redaction algorithm, exposure response, or authentication method. A vendor error message is not safe merely because it is called an error.

## Delivery, ordering, idempotency, and compatibility

Adopt at-least-once delivery as the contract assumption, with durable deduplication rather than an exactly-once claim. Each producer owns a stable stream and monotonic sequence. Restart preserves sequence, or starts a new uniquely identified stream with an explicit predecessor; sequence values from different streams are not globally comparable. Mirror/replay preserves the original `event_id` and producer/stream/sequence. Vendor messages without replay identity gain an application event identity at first durable capture; reconnect duplicates cannot be assumed distinguishable without evidence, so adapters disclose gaps/uncertain replay rather than promising exact vendor deduplication.

Consumers deduplicate by `event_id` and validate `(producer_id, stream_id, sequence)` uniqueness and entity references. Same ID with different content is a conflict, never an overwrite. Out-of-order facts can be retained, but no projection advances past a causal prerequisite for a decision. A detected sequence gap requests replay/inspection or remains visibly incomplete. Recorded retention gaps use an explicit range/reason under #86. The local store may give receipt positions to projections; receipt order is not remote execution order. No clock-based last-writer-wins resolution of terminal outcomes.

Before dispatch, persist the operation ID, idempotency key, and pinned inputs. Duplicate commands return the recorded operation rather than launch again. If an upstream cannot deduplicate and the application crashes between dispatch and recording its response, report `effect: unknown`, inspect/reconcile before any resend, and retain the same attempt. A genuinely new execution requires a new attempt ID. Durable deduplication/fencing mechanics and recovery ownership are #15/#54/#73 work; this decision is not evidence they already exist.

Use separate versions for application contract, adapter implementation, upstream API/CLI/SDK, remote execution protocol, and policy/input manifests. Capability handshake advertises supported contract majors/minors and required features before mutable work. Select a common major and supported feature set; incompatible peers may read a supported historical projection but cannot launch work or produce an accepted result. A missing capability is not fixed by a matching version string.

Within a major version, additive optional fields may be ignored; new required fields, changed meaning, or changed enum behavior require negotiation or a new major. Unknown critical event/outcome kinds remain visible as unsupported and block dependent decisions; they must never map to success. Versioned source records stay intact through migrations, with explicit conversion provenance. New policy revisions do not retroactively reinterpret historical results. Exact remote handshake/enforcement belongs to #54, and database migrations/packaging to #15.

## One run traced through saved settings and four outcomes

All IDs, commits, resources, digests, times, and values here are **synthetic fixtures**, not executions or availability claims. A fixture `*_ref` identifies an immutable versioned record whose policy values are deliberately not invented here. A full implementation must validate those records before launch.

1. Project catalog creates `p_demo`; configuration owner saves `cfg_1` for `r_demo`, resolving global/project defaults. Editing defaults later leaves `cfg_1` unchanged. Preparation resolves external source `fixture/model` to the full revision below in `inputs_1`; this manifest pins fixed weights and input processing separately from starting code.
2. Reservation owner grants `res_1` on the existing synthetic Runpod Pod/GPU. Coordinator binds the run branch/work directory; execution preflights pinned settings, inputs, and actual allocation. Agent action `act_1` uses safe research context and records vendor session/turn correlations; it cannot create evaluation facts.
3. Execution creates baseline attempt `a_base`; protected evaluator publishes `v_base`; coordinator records baseline establishment `d_base`. Every candidate still reloads `inputs_1` weights with fresh optimizer state. The incumbent is a comparator, never an implicit training source.
4. Agent proposes candidate `c_1` against `v_base`/baseline commit. Execution attempt `a_ok` completes; evaluator publishes `v_ok`; coordinator records `d_ok` as kept, given an eligible better validation result supplied by the evaluation-policy owner. Artifact owner links selected weights `art_ok`. This is successful execution **and** a completed acceptance decision, unlike the cases below.
5. Candidate `c_2` creates `a_fail`; a confirmed training error produces `x_fail`. No final evaluation exists; acceptance is not applicable, not discarded by a performance comparison. A repair would create another candidate/tested commit and attempt.
6. Candidate `c_3` creates `a_stop`. Stop command `cmd_stop` leads to scope-confirmed interrupted execution `x_stop`. No training-progress resume or acceptance occurs. Previously selected `v_ok`/`art_ok` is preserved. This fixture assumes no completion race; it does not decide race precedence. Reservation changes only after #73-required stop confirmation.
7. After reconciliation and explicit Resume, reserve again as `res_2` and create fresh `a_pending` for `c_4`, initialized again from `inputs_1`. It finishes training and final validation remotely, but local acceptance is unavailable after disconnection. `v_pending` is retained and `d_pending` remains pending; no next candidate launches before reconciliation. Resource stopping uncertainty retains `res_2` rather than releasing it on lost contact. The coordinator later resolves the same decision identity with a new revision using recovered evidence; no guessed keep/discard result is supplied here.
8. Run completion and selected-model retrieval are separate. Artifact records retain identity if a transfer is pending/failed or bytes are missing. User history includes every attempt and decision state, while the agent view contains validation/constraint/explanation facts and excludes test assessments. Selected model packaging and local retrieval follow #92, not a completed-transfer assumption.

The fixtures are compact projections: omitted timestamps/owners/envelopes are supplied by the common rules above. They are sufficient to check joins and distinct outcome meanings; they are not a complete launch payload or evaluation schema.

```json
{
  "snapshot": {
    "snapshot_id": "cfg_1", "project_id": "p_demo", "run_id": "r_demo",
    "agent": {"integration": "codex", "model_ref": "selected_model_1"},
    "code_source_commit": "1111111111111111111111111111111111111111",
    "initialization": {"kind": "external_pretrained", "requested_source": "fixture/model"},
    "objective_ref": "objective_1", "data_ref": "data_1", "splits_ref": "splits_1",
    "evaluation_context_ref": "eval_ctx_1", "ranking_policy_ref": "ranking_1",
    "training_duration_ref": "duration_1", "stopping_expression_ref": "stop_expr_1"
  },
  "prepared_inputs": {
    "manifest_id": "inputs_1", "snapshot_id": "cfg_1",
    "source_revision": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "weights_digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "input_processing_ref": "processing_1", "environment_ref": "environment_1"
  },
  "reservations": [
    {"reservation_id": "res_1", "run_id": "r_demo", "provider": "runpod", "account_id": "acct_demo", "resource_id": "pod_demo", "gpu_ids": ["gpu_demo_0"]},
    {"reservation_id": "res_2", "run_id": "r_demo", "provider": "runpod", "account_id": "acct_demo", "resource_id": "pod_demo", "gpu_ids": ["gpu_demo_0"]}
  ],
  "attempts": [
    {"attempt_id": "a_base", "role": "baseline", "candidate_id": null, "run_id": "r_demo", "snapshot_id": "cfg_1", "input_manifest_id": "inputs_1", "reservation_id": "res_1", "tested_commit": "1111111111111111111111111111111111111111"},
    {"attempt_id": "a_ok", "role": "candidate", "candidate_id": "c_1", "run_id": "r_demo", "snapshot_id": "cfg_1", "input_manifest_id": "inputs_1", "reservation_id": "res_1", "tested_commit": "2222222222222222222222222222222222222222"},
    {"attempt_id": "a_fail", "role": "candidate", "candidate_id": "c_2", "run_id": "r_demo", "snapshot_id": "cfg_1", "input_manifest_id": "inputs_1", "reservation_id": "res_1", "tested_commit": "3333333333333333333333333333333333333333"},
    {"attempt_id": "a_stop", "role": "candidate", "candidate_id": "c_3", "run_id": "r_demo", "snapshot_id": "cfg_1", "input_manifest_id": "inputs_1", "reservation_id": "res_1", "tested_commit": "4444444444444444444444444444444444444444"},
    {"attempt_id": "a_pending", "role": "candidate", "candidate_id": "c_4", "run_id": "r_demo", "snapshot_id": "cfg_1", "input_manifest_id": "inputs_1", "reservation_id": "res_2", "tested_commit": "5555555555555555555555555555555555555555"}
  ],
  "results": [
    {"result_id": "v_base", "evaluation_id": "eval_base", "attempt_id": "a_base", "evaluation_context_ref": "eval_ctx_1", "checkpoint_artifact_id": "art_base", "validation_evidence_ref": "validation_base"},
    {"result_id": "v_ok", "evaluation_id": "eval_ok", "attempt_id": "a_ok", "evaluation_context_ref": "eval_ctx_1", "checkpoint_artifact_id": "art_ok", "validation_evidence_ref": "validation_ok"},
    {"result_id": "v_pending", "evaluation_id": "eval_pending", "attempt_id": "a_pending", "evaluation_context_ref": "eval_ctx_1", "checkpoint_artifact_id": "art_pending", "validation_evidence_ref": "validation_pending"}
  ],
  "messages": [
    {"kind": "execution.outcome", "execution_outcome_id": "x_ok", "attempt_id": "a_ok", "operation_id": "op_ok", "status": "completed", "evidence_ref": "exit_ok"},
    {"kind": "acceptance.recorded", "decision_id": "d_ok", "revision": 1, "attempt_id": "a_ok", "result_id": "v_ok", "comparator_result_id": "v_base", "comparator_commit": "1111111111111111111111111111111111111111", "policy_ref": "ranking_1", "status": "kept", "explanation_ref": "eligible_better_1"},
    {"kind": "execution.outcome", "execution_outcome_id": "x_fail", "attempt_id": "a_fail", "operation_id": "op_fail", "status": "failed", "error": {"code": "internal", "origin": "execution", "operation_id": "op_fail", "message": "Training process exited unsuccessfully.", "effect": "partial", "retry": "after_reconcile", "evidence_ref": "exit_fail"}, "acceptance_status": "not_applicable"},
    {"kind": "execution.outcome", "execution_outcome_id": "x_stop", "attempt_id": "a_stop", "operation_id": "op_stop", "status": "interrupted", "caused_by": "cmd_stop", "evidence_ref": "application_process_scope_stopped_1", "acceptance_status": "not_applicable"},
    {"kind": "acceptance.recorded", "decision_id": "d_pending", "revision": 1, "attempt_id": "a_pending", "result_id": "v_pending", "comparator_result_id": "v_ok", "comparator_commit": "2222222222222222222222222222222222222222", "policy_ref": "ranking_1", "status": "pending", "reason": "acceptance_unavailable", "reconciliation_ref": "reconcile_1"}
  ]
}
```

For example, wrap the `x_ok` fact with `event_id: ev_exec_7`, `producer_id: execution_demo`, `stream_id: execution_demo_s1`, `sequence: 7`, `project_id: p_demo`, `run_id: r_demo`, `attempt_id: a_ok`, `operation_id: op_ok`, `contract_version: {major: 1, minor: 0}`, `caused_by: cmd_launch_ok`, and `observed_at: 2026-11-13T12:00:00Z`. Replaying it twice produces one fact. Receiving sequence 9 before 8 reveals a gap; it does not establish causal completion. The acceptance event has a different coordinator stream and cites result `v_ok`, so its arrival time cannot replace result validation.

## Independently checkable adapters and change propagation

Implement a shared, versioned contract fixture bundle and conformance runner in the stack selected by #15, without requiring the UI or live cloud access. Each adapter must accept the same commands and produce normalized facts that pass semantic checks. The bundle is future implementation work; only the illustrative fixtures and checks described below exist in this spike.

| Independent check | Pass condition |
| --- | --- |
| Provider discovery with fake pages, missing telemetry, and vendor errors | All pages normalized or completeness marked false; same canonical Pod through two credential aliases still conflicts; unavailable observation is explicit, never numeric zero; raw environment/token fields excluded. |
| Codex/Claude recorded or synthetic activity translation | Vendor session/action IDs correlate to application operation; duplicate/progress/error/cancel messages never fabricate an attempt outcome; only exposed activity is promised. Pin source version/mode and fixture provenance. |
| Duplicate submit and crash-after-dispatch | Same idempotency key returns one operation; altered payload conflicts; unknown upstream effects require reconciliation instead of a second launch. Verify persistence behavior in the chosen storage implementation. |
| Execution cancel and reconnect | Ack, agent interruption, process-scope stop confirmation, and unknown contact are distinct. No instance lifecycle API invoked; uncertain stop retains reservation. Multi-process confirmation must later be proven on real hardware. |
| Result and context boundaries | Attempt/snapshot/input/checkpoint/evaluator joins validated; no final scores for failed/interrupted attempts unless separately evidenced evaluation exists; pending acceptance retained; no test scores in any agent-facing fixture or inherited history. |
| Event replay, ordering, and compatibility | Duplicate IDs are harmless; conflicting payload rejected; gaps/out-of-order causality visible; unknown critical kind and incompatible major cannot advance acceptance; older supported history remains inspectable. |
| Artifact transfer and input reuse | Transfer failure leaves run/outcome history unchanged; missing bytes visible; previous-run dependency points to selected package; fixed source identity survives candidate edits. #92 supplies packaging/cleanup assertions. |

For the first real smoke test, dependent implementations of #34/#44 together with #54 must prove discovery of an existing running Runpod Pod, one bounded Codex action, a pinned external-model baseline and multiple experiments, cancellation/recovery, and retrieval. No provision/rent/stop-instance command is needed. Vast.ai/Claude/multi-GPU adapters then run the same applicable conformance suite plus their specific integration proofs. Fake fixtures cannot prove safe process termination, secret containment, account access, telemetry freshness, or GPU behavior.

Contract changes must update the owning decision/implementation artifact, version, field semantics, compatibility table, fixtures, and affected consumer checks in the same reviewed change. Consumer map: provider/resource changes → reservations, preparation, execution and compute UI; agent changes → setup/research coordinator, activity/history and context projection; attempt/event changes → execution/recovery, evaluation, history and UI; result changes → ranking/stopping/context/history; artifact changes → preparation, dependency tracking, retrieval/cleanup and UI. This is a propagation map, not a new dependency graph replacing native GitHub relationships.

Generate language-specific bindings/validators from a canonical versioned schema when implementation chooses its representation; generated types alone cannot check ownership, causality, safe recording, or allowed state transitions. CI should run producer/consumer fixture compatibility checks for touched contracts and refuse undocumented breaking changes. Adapters absorb upstream-only changes; normalized contract changes require affected consumers' checks and migrations. Remote upgrade compatibility additionally needs the #54 handshake and #73 recovery protocol, not automatic remote replacement during an active attempt.

Tradeoff: explicit records and reconciliation cost more than vendor-shaped callbacks and mutable UI state, but allow independent integrations and truthful recovery/history. Separate outcome dimensions avoid fabricated success/failure and protect evaluation meaning. No distributed event platform, global total order, credential solution, or schema tooling is selected by this research decision.

## Policy handoff and remaining uncertainty

Live owning issue bodies were checked on 2026-11-13, and completed #22/#34/#44/#49 decisions were read as noted above. References below retain existing ownership; they do not change native parent/blocking relationships. Closed spikes' decisions remain inputs, while their implementation qualification remains outstanding.

| Owning spike | Deliberately unresolved here |
| --- | --- |
| [#15](https://github.com/igrgin/autoresearch-lab/issues/15) | Stack, persistence transactions, physical record layout, schema/binding tools, migrations and build/CI. |
| [#17](https://github.com/igrgin/autoresearch-lab/issues/17) | Credential inventory, readers/storage, safe-recording/redaction coverage, exposure containment. No credential policy selected. |
| [#27](https://github.com/igrgin/autoresearch-lab/issues/27) | Remaining model/initializer compatibility matrix, compatible architecture edits, exact environment and source packaging. Apply completed #22's task/data/preparation boundary; do not invent a replacement task scope. |
| [#39](https://github.com/igrgin/autoresearch-lab/issues/39), with completed [#34](https://github.com/igrgin/autoresearch-lab/issues/34), [#44](https://github.com/igrgin/autoresearch-lab/issues/44), [#49](https://github.com/igrgin/autoresearch-lab/issues/49) | Vast.ai method choice remains open. Other route choices are recorded above; account/model access, telemetry, interruption and recovery need qualification in their dependent implementation tasks, not renewed route selection here. |
| [#54](https://github.com/igrgin/autoresearch-lab/issues/54) | Actual local/remote execution authority, fencing/dedup storage, process scope, protected boundaries, training-clock definition, phase bounds and compatibility enforcement. No timing/budget values selected. |
| [#61](https://github.com/igrgin/autoresearch-lab/issues/61) | Metric schema/aggregation, tie precision, complete-tie selection, invalid/missing/non-finite results, exact evaluation protocol. Approved validation/test separation is preserved. |
| [#67](https://github.com/igrgin/autoresearch-lab/issues/67) | Stopping evaluation timing, counter transitions, repeated failures/repairs, safeguards. No new ceiling or failure policy invented. |
| [#73](https://github.com/igrgin/autoresearch-lab/issues/73) | Lifecycle states, control/completion precedence, disconnect/close behavior, reservation release protocol, baseline-free recovery and hardware changes. No race winner or grace-period value selected. |
| [#86](https://github.com/igrgin/autoresearch-lab/issues/86), [#92](https://github.com/igrgin/autoresearch-lab/issues/92) | Historical aggregation, truncation/retention limits, artifact package/integrity/space/transfer/cleanup rules and dependent-model protection. |

Implementation must fill these versioned policy references from their owners before dependent behavior can be considered proven. This spike supplies interoperability seams, not implementation readiness or new product approvals.

## Completion evidence and validation limits

| Live #16 completion criterion | Evidence in this decision |
| --- | --- |
| Trace saved settings through attempt/result and name owners | Ownership table, immutable snapshot/preparation rule, eight-step run trace, five joined attempt fixtures and three result fixtures. |
| Successful, failed, interrupted, pending messages with stable IDs | `x_ok`/`d_ok`, `x_fail`, `x_stop`, `d_pending`; fixed snapshot/input/run IDs, comparator identities, explicit pending reconciliation and distinct baseline. |
| Independently check adapters and explain change propagation | Seven conformance scenarios, real first-route proof boundary, version/consumer propagation map and upgrade rules. |
| Summarize decision in issue comment and link supporting document | Publication must post the concise decision to #16 with an exact-commit link to this file; PR body uses `Closes #16`. Verify returned comment URL before reporting complete. |

Validation executed for this documentation spike: JSON parsed; five unique attempts, three results, and two reservation records joined to the fixed snapshot/manifest/run; comparator commits matched their result's tested commit; failed/interrupted fixtures had no fabricated final result; all four outcome examples were present. Negative checks rejected a changed comparator commit, a different initializer manifest, and a reservation pointing at another run. Both local Markdown links resolved. Final publication additionally checks the staged diff, Markdown table structure, `git diff --check`, and secrets/private details. These checks validate internal evidence consistency, not a schema implementation or live adapters. No application code or automated application tests are introduced.
