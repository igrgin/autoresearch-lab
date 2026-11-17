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

- Attribute defects to the reviewed change and its delivered contract. Inspect
  later-issue ownership before classifying unfinished functionality as a defect.
  Report false readiness claims and broken existing contracts as current defects.
- Support material findings with a concrete counterexample or source-supported
  mechanism and consequence. Separate the required outcome from an optional
  implementation suggestion; preferences alone do not establish defects.
- Inspect tests as carefully as production code. They must exercise the actual
  failing path and assert the required behavior. A substitute success-only
  fixture or unrelated refresh must not conceal rejection/lifetime failures.
- Match readiness claims to the final source, executed checks, reviewer scope,
  and stated limits. Local fixtures do not establish live service/GPU behavior.
  Main-only CI intentionally supplies no hosted PR check.

## Recurring findings

The author classifies findings as independent defect, incomplete repair,
repair-induced regression, missing evidence, or requirement disagreement, while
preserving raw reviewer reports. Review relevant previous counterexamples as
regression requirements without adopting an earlier verdict as authority.

When rejecting a repair, name the failed assumption or omitted consumer/lifecycle
path. Repeated counterexamples trigger the shared workflow's diagnostic recovery;
new independent defects may require further review. Review completion depends on
resolving confirmed material findings and adequate evidence, not a default round
cap or score.
