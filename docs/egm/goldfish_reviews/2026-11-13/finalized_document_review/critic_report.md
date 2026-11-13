# Critic Review

**Stage:** 7, Mode REVIEW, audit round 1. **Target:** `concepts_brief.md`, lines 1–303, unchanged. The design and structural reviewers applied `feature-spec-standard.md`; the style reviewer applied its persona without a separate standard.

## Reviewer status

| Reviewer | Status | Required reads | Raw findings |
| --- | --- | --- | --- |
| Design critic | Completed | Persona, feature-spec standard, target, local context read in full; source reads attested | 4 Majors: one new security question, three tracked design obligations |
| Structural | Completed | Persona, feature-spec standard, target, local context read in full | 1 Major full-spec readiness limitation; 1 Nit |
| Style | Completed | Persona, target, local context read in full; no separate standard supplied | 1 Major approval-label ambiguity |

No missing reviewers or unresolved required-read failures. Complete responses are preserved in [design](./stage7_design.raw.md), [structure](./stage7_structural.raw.md), and [style](./stage7_style.raw.md).

## Assessment and review boundary

The document remains a coherent concepts brief suitable for entry into formal design on instruction. It is not yet a complete feature specification under the supplied pre-implementation standard. The distinction is material: architecture, feasibility, trust boundaries, and several mitigations are intentionally deferred and have not been proved.

This is a read-only audit, not remediation. No fixes or scope changes were applied. The user selected a consolidated report, so findings are returned to the outer review without interactive repair checkpoints. A two-clean-round antagonistic-loop convergence claim is not made. Additional review rounds or approved remediation would be separate work.

## Consolidated findings

### C01 — Credentials need a retained-records policy — Major, new design follow-up

**Raw source:** S7-D-1. **Target:** lines 139, 246, 296.

Activity records may include authentication material in commands, URLs, or tool results. Retaining and replaying those records could retain or expose secrets. The present brief does not define credential exclusion, redaction, or handling of accidentally emitted secrets.

**Disposition:** PROPOSE FIX / open. Add this question to the design follow-up register and resolve it in the formal design. Preserve useful agent activity without promising literal retention of authentication material. No existing leak has been demonstrated.

### C02 — One setup-flow label still implies pending overall approval — Nit, editorial

**Raw sources:** S7-S-1 (Nit), S7-T-1 (Major). **Target:** line 131 versus lines 5 and 302.

“Recommended setup flow, awaiting overall confirmation” conflicts with final approval elsewhere. Recommended replacement: “Recommended setup flow, carried forward for design consideration.” Preserve recommendation status for copy/move defaults and generation timing.

**Disposition:** PROPOSE FIX / open, not applied. Severity is calibrated to Nit because the finalized status and decision log make the actual overall approval clear; the remaining issue is one stale label. The style reviewer's higher severity is retained in its raw report and this mapping.

### C03 — Execution bounds and recovery still need a design — Major, already tracked

**Raw sources:** S7-D-2; corresponding part of S7-S-2. **Target:** lines 39, 181–189, 223–238, 288, 291–292.

Resolve phase bounds, independent enforcement, event precedence, one reconciled outcome, and confirmed reservation release. Existing M01/M02/M06/M07/M13/M15 already track this work.

**Disposition:** KEEP AS DESIGN OBLIGATION. Contest treating this as a newly discovered contradiction or a reason that concepts are incomprehensible; retain it as a substantive gap before a complete design can pass the feature-spec standard. No mechanism is chosen.

### C04 — Input, initializer, storage, and hardware compatibility still need contracts — Major, already tracked

**Raw sources:** S7-D-3; corresponding part of S7-S-2. **Target:** lines 41, 141–155, 195–205, 215–217, 247–253, 289–290.

Resolve supported combinations, fixed research input identities, compatible edits with fixed source weights, dependent-run artifact retention, low-space behavior, and hardware preflight. Existing M03/M05/M08/M09/M16 track these questions.

**Disposition:** KEEP AS DESIGN OBLIGATION, not a new product-policy contradiction. No silent initializer replacement, forced identical hardware, or scope reduction is proposed.

### C05 — Evaluation and agent-context separation need enforcement — Major, already tracked

**Raw sources:** S7-D-4; corresponding part of S7-S-2. **Target:** lines 155, 161–175, 195–209, 246, 293.

Training-loss changes must not alter authoritative evaluation, and retained logs must not leak test scores into agent context. Existing M05/M11 and the explicit design deferral acknowledge the obligation but do not demonstrate it.

**Disposition:** KEEP AS DESIGN OBLIGATION. Preserve resolved validation-based acceptance and permitted training augmentation.

## Traceability

| Raw finding | Consolidated item | Treatment |
| --- | --- | --- |
| S7-D-1 | C01 | New open security design follow-up |
| S7-D-2 | C03 | Previously tracked design gap |
| S7-D-3 | C04 | Previously tracked design gap |
| S7-D-4 | C05 | Previously tracked design gap |
| S7-S-1 | C02 | Duplicate approval-label issue |
| S7-S-2 | C01, C03, C04, C05 and stage-readiness assessment | Full-spec standard is not yet met; does not make the concepts brief incoherent |
| S7-T-1 | C02 | Duplicate label issue; severity disagreement preserved |

**Consolidated counts:** 0 Blockers, 4 Majors, 1 Nit. Of the Majors, one is a newly identified design follow-up and three are already tracked obligations. All proposed changes remain unapplied. Source checks found no false external-behavior claims in the material reviewed. No implementation was run.

Continue to Stage 8 under the selected consolidated preset. The approved target remains unchanged.
