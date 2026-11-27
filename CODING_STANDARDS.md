# Reviewer standards

Read the approved contract and its current amendments through
[the design sitemap](docs/designs/SITEMAP.md), then inspect the actual diff,
callers, and assertion source. Mechanical formatting/type rules belong to the
existing tools. These standards cover judgments those checks cannot replace.

## Shared contracts and lifetimes

- Verify that the same invariant covers every affected entry point and consumer.
  Use the [ownership/test map](docs/BUILD.md#shared-ownership-and-test-map) to
  inspect related paths; a fix in one caller does not certify another.
- Check that authority lasts through the protected operation's actual settlement.
  A caller timeout or lost acknowledgement is not proof that its writer stopped.
  Include relevant failure, restart, and delayed-completion paths.
- Check that cache protection lasts as long as the cache, including while views
  are unmounted. Rejected or late replies must not restore withheld content.
- Preserve immutable domain identities and uncertain-effect reconciliation.
  Clearing an unsafe payload must not lose the opaque request identity needed to
  reconcile a write or cause a mutation to be silently resent.
- Verify recovery remains usable after protection activates. Safe withholding
  must retain the approved means of clean replacement and reconciliation.

## Requirements and evidence

- Apply the shared delivery and review guidance named in [AGENTS.md](AGENTS.md)
  for finding classification and evidence.
- Inspect tests as carefully as production code. They must exercise the actual
  failing path and assert the required behavior. A substitute success-only
  fixture or unrelated refresh must not conceal rejection/lifetime failures.
- Match readiness claims to the final source, executed checks, reviewer scope,
  and stated limits. Local fixtures do not establish live service/GPU behavior.
  Main-only CI intentionally supplies no hosted PR check.

## Recurring findings

Review relevant previous counterexamples as regression requirements and assess
them independently. When rejecting a repair, name the failed assumption or
omitted consumer or lifecycle path. Follow the shared workflow's diagnostic
recovery procedure for recurring failures.
