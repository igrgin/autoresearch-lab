# Autoresearch Lab

A personal desktop application for creating, running, and observing autonomous PyTorch research projects with a selected Codex or Claude model on existing Runpod or Vast.ai instances. macOS is the first build and continuous integration target; the application stack remains open for consideration of future platform support.

The concepts brief and the design draft's Overview & Goals are approved. The approved issue plan is published as 14 epics and 82 linked issues, including 15 spikes and 67 implementation tasks. Detailed architecture decisions remain open in the spikes. Application implementation has not started.

## System Overview

This repository contains the approved product definition, the initial design draft, and supporting EGM and issue-publication records. Architecture choices are assigned to the published spikes. The first end-to-end workflow uses Runpod, Codex, and an external pretrained model.

## Subdirectories & System Boundaries

| Directory | Purpose |
| --- | --- |
| [docs/designs/](./docs/designs/SITEMAP.md) | Approved specifications and the design sitemap, following EGM's recommended layout. |
| [docs/egm/](./docs/egm/) | Working notes and review evidence. This is the configured EGM artifact directory. |

## Project records

| File or directory | Purpose |
| --- | --- |
| [concepts_brief.md](./docs/designs/concepts_brief.md) | Approved product definition, scope, success criteria, and design follow-ups. Start here. |
| [design_draft.md](./docs/egm/design_draft.md) | Approved Overview & Goals, with the problem, non-goals, remaining technical questions, and published issue plan. |
| [project_and_run_setup.md](./docs/egm/project_and_run_setup.md) | Historical setup discussion and decision log. Later decisions in the concepts brief take precedence. |
| [Initial Goldfish review](./docs/egm/goldfish_reviews/2026-11-13/goldfish_review_report.md) | Brainstorm review, reviewer reports, and subsequent decisions. |
| [Finalized-document review](./docs/egm/goldfish_reviews/2026-11-13/finalized_document_review/consolidated_review_report.md) | Consolidated EGM review, source checks, and correction dispositions. Credential handling remains a design obligation. |
| [goldfish_reviews/](./docs/egm/goldfish_reviews/) | Archived inputs, complete reviewer responses, captured reference sources, and verification records. |
| [Issue publication records](./docs/egm/github_issue_publication.json), [publication state](./docs/egm/github_issue_publication_state.json), and [verification](./docs/egm/github_issue_publication_verification.json) | Published bodies and GitHub references, with verified labels, 82 parent links, and 139 blocker relationships. |
| [relocation_map.json](./relocation_map.json) | Original-to-current path mappings and hashes for the 47 relocated project files. |

## Interface

None implemented. The repository contains documentation and captured review evidence, with no application source, exported symbols, or component packages.

## Global Invariants

No runtime invariants are implemented. Product requirements are defined in the approved concepts brief; repository editing rules are in [AGENTS.md](./AGENTS.md).

## Global Side Effects

None implemented. Cloud and agent integrations are product requirements awaiting design and implementation.

## System Verification

No build manifest or automated application test command is configured. For documentation changes, run `git diff --check`, verify edited relative links resolve, and compare archived evidence with the hashes in `relocation_map.json`.

## Historical paths

Review records preserve absolute paths from the original home-repo worktree. Strip that recorded prefix and apply the file or directory mapping in `relocation_map.json` to locate each record in this checkout. Archived inputs, reviewer responses, and source captures retain their original bytes and hashes. The active brief includes the author's later drafting and planning clarifications. Its hash history is recorded separately in the relocation map; the historical setup notes retain their earlier proposals.

Paths to installed EGM personas and standards describe the review environment at the time. New work should use the skills available in its current environment.

## Next phase

Use the [published epics](https://github.com/igrgin/autoresearch-lab/issues?q=is%3Aissue%20label%3Aepic) and their linked issues to carry out the approved plan. GitHub labels distinguish `epic`, `spike`, and `implementation`; native parent and blocker relationships connect the work. The first route is Runpod, Codex, and external pretrained initialization. Both providers, both agents, all agreed starting approaches, and multi-GPU execution remain in full version-one scope.

Every spike must post a decision comment on its issue. Prefer the comment as the complete deliverable. Add supporting documentation only when the decision's size or complexity requires it; the comment must summarize the decision and link to that documentation. Integration feasibility, compatibility, execution safeguards, recovery, credential handling, and retention decisions remain assigned to the corresponding spikes.
