# Bug fix standard

A patch is ready when it corrects the established behavior, preserves relevant
existing behavior, and has sufficient evidence on the final reviewed inputs.

## Contract and cause

Identify the source of expected behavior. Reconstruct the failing path from
source and observations. Distinguish a cause from a guard that only hides the
symptom. Challenge an incorrect diagnosis even when supplied by the user.

## Regression and nearby behavior

Inspect assertions and execution receipts. Check that original-production
evidence fails for the reported reason and final checks cover the patched
subject. Exercise relevant boundaries, callers, error paths, and invariants.
An exit code alone does not prove a useful assertion.

For a justified presentation-only exemption, inspect the captured evidence.
Missing meaningful proof for a logic defect is a verification limit.

## Patch scope

Check the smallest coherent repair, existing code conventions, compatibility,
and changed callers. Identify unrequested cleanup or overlooked consequences.
Code size alone does not determine risk. Inspect test source as carefully as
production source; avoid demanding documentation of unrelated internals.

## Evidence and findings

Read the source, tests, contract, diff, and receipts directly. Report inaccessible
required inputs as incomplete. Cite a concrete path/symbol, failure mechanism,
and consequence for each finding. Distinguish actual defects from speculative
preferences.

Use Blocker for a demonstrably incorrect or unsafe correction, Major for a
material gap affecting correctness or verification, and Nit for optional
clarity/style work. Missing required reads or an unavailable review capability
changes review status to incomplete rather than producing zero findings.
