# Autoresearch Lab delivery workflow

Read the shared Home Repo workflow named in [AGENTS.md](../AGENTS.md) for
cross-repository coordination, review, and diagnostic recovery. This file owns
Autoresearch Lab's project-specific delivery requirements.

## Research and PR deliverables

Apply these rules when using research and PR skills. They take precedence over
the skills' default output formats.

Present research findings and comment drafts in the conversation. Create
repository documents only when requested or required by the agreed
deliverable.

PR descriptions explain the delivered behavior, resolved issue, and relevant
final validation. Put transient CI updates in brief comments when posting
is authorized.

## Artifacts and evidence

Keep approved specifications and their index in `docs/designs/`, and retained
project review records in `docs/egm/`. Preserve archived review inputs, raw
reviewer responses, and captured source files. Record corrections separately
and put new reviews in new artifacts. Use the
[relocation map](../relocation_map.json) to translate historical paths.

Keep temporary diagnostics and fix-helper snapshots and receipts in persistent
host scratch outside the repository. Follow the applicable helper procedure for
its artifacts. Link required external evidence from the delivery record.
