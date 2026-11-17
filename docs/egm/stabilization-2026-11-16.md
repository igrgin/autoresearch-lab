# Bounded publication and metadata-cache stabilization

One implementation owner repairs FAMILY-PERSIST-01 and FAMILY-CACHE-01 under
[the approved #17 security contract](https://github.com/igrgin/autoresearch-lab/issues/17#issuecomment-6867871329),
sections 3 and 5. No policy, SQL schema, dependency, provider lifecycle or research
execution change is introduced. Main/preload/renderer ship together.

The [previous acceptance report](acceptance/2026-11-16/README.md) and its raw
failures remain unchanged. Prior reservation, research, import-cleanup, deadline,
ranking and uncertain-effect evidence is preserved. This stabilization reopens
only shared publication, response transport and the affected metadata views.

## Repair

`SafeRecording.capture` owns matching policy inside its serialized operation,
through existing-record comparison, atomic write, error fencing and response
preparation. Nested owners are supported. Registration/remediation cannot mutate
matching material while the captured body is being committed. Release also runs
on failure; later recognition still quarantines historical records on reuse.

Main stamps configuration/import/provider/agent metadata replies with the policy
generation under which their complete handler ran. A changed generation rejects
the reply without replaying a mutation. Preload compares that stamp at fixed-field
FIFO barriers, including responses already queued in native IPC and notifications
that were missed. Initial matching loads before metadata views mount. Routine
barriers never join the credential-service queue, preserving reconciliation while
credential changes wait for an uncertain writer's lease.

Generation-bound renderer state clears mounted bodies and ignores setters from
older async continuations. Both Codex views, both Claude views, Runpod discovery
and details, Vast discovery, and completed imports use it; configuration retains
its existing operation generation guard over the shared notification source.
Opaque pending save identities survive invalidation. Codex drops cached payloads
and reconciles by request ID. Claude discards comparison payloads and requires an
authoritative read/recovery before another intent. No automatic write retry or
model substitution is added.

## Permanent verification

Normal `npm run check` runs four actual durable-capture consumer regressions and
metadata protocol tests, plus native production renderer/preload scenarios for
mounted and pending results. The latter includes lost notifications and late
save acknowledgements, checking absence of cached model bodies and duplicate
writes. Capture tests pause the actual private-file writer and inspect its bytes
before read-time quarantine. Native UI tests use an encrypted synthetic credential
service and controlled domain projections. Packaged smoke additionally exercises
real host/coordinator/store routing and existing recovery workflows.

Before repair, all four original capture regressions and the seven-view
mounted/delayed-response probes failed for the reported mechanisms. Initial
post-repair capture/protocol and 21 native UI scenarios pass. Final normal checks,
packaging, native smoke and the single focused independent review are recorded in
new stabilization receipts; their final disposition belongs to that evidence,
not to the historical acceptance report.

No live authentication, inference, GPU containment, signed distribution, physical
disk-full or power-loss qualification is claimed. If a family remains failing in
verification or focused review, its precise mechanism is returned before another
behavior patch. No PR merge is authorized.

The original candidate and its incomplete verification are preserved above.
The [targeted continuation](stabilization-continuation-2026-11-16.md) addresses
its five confirmed findings with native reproductions and one focused recheck.
