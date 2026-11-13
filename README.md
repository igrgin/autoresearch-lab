# Autoresearch Lab

A personal macOS application for creating, running, and observing autonomous PyTorch research projects with a selected Codex or Claude model on existing Runpod or Vast.ai instances.

The concepts brief is approved. Formal design is the next phase; application implementation has not started.

## System Overview

This repository currently contains the approved product definition and its supporting EGM records. The application architecture will be defined during formal design.

## Subdirectories & System Boundaries

| Directory | Purpose |
| --- | --- |
| [docs/designs/](./docs/designs/SITEMAP.md) | Approved specifications and the design sitemap, following EGM's recommended layout. |
| [docs/egm/](./docs/egm/) | Working notes and review evidence. This is the configured EGM artifact directory. |

## Project records

| File or directory | Purpose |
| --- | --- |
| [concepts_brief.md](./docs/designs/concepts_brief.md) | Approved product definition, scope, success criteria, and design follow-ups. Start here. |
| [project_and_run_setup.md](./docs/egm/project_and_run_setup.md) | Historical setup discussion and decision log. Later decisions in the concepts brief take precedence. |
| [Initial Goldfish review](./docs/egm/goldfish_reviews/2026-11-13/goldfish_review_report.md) | Brainstorm review, reviewer reports, and subsequent decisions. |
| [Finalized-document review](./docs/egm/goldfish_reviews/2026-11-13/finalized_document_review/consolidated_review_report.md) | Consolidated EGM review, source checks, and correction dispositions. Credential handling remains a design obligation. |
| [goldfish_reviews/](./docs/egm/goldfish_reviews/) | Archived inputs, complete reviewer responses, captured reference sources, and verification records. |
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

Review records preserve absolute paths from the original home-repo worktree. Strip that recorded prefix and apply the file or directory mapping in `relocation_map.json` to locate each record in this checkout. Archived inputs, reviewer responses, and source captures retain their original bytes and hashes. The active brief and setup notes have updated navigation links.

Paths to installed EGM personas and standards describe the review environment at the time. New work should use the skills available in its current environment.

## Next phase

Use the approved brief and its design follow-up register when drafting the formal design. Integration feasibility, compatibility, execution safeguards, recovery, credential handling, and retention mechanisms still need design decisions. The smaller first milestone remains a staging recommendation within the full version-one scope.
