# Targeted stabilization continuation

This continuation starts at `1f8859f` and addresses STAB-R1-F01 through F05
under the existing [approved security decision](https://github.com/igrgin/autoresearch-lab/issues/17#issuecomment-6867871329).
It preserves prior acceptance records and does not change that policy, SQL
schemas, provider contracts, credentials, or execution scope. One author owns
implementation; one independent reviewer rechecks these findings and caused
regressions. No broad review round or merge is authorized.

## Repairs and permanent regressions

- Capture and correction share a serialized protected-publication operation.
  Ownership covers replacement and tombstone writes and releases on failure.
  Security tests pause each boundary and inspect actual retained file bytes.
- Preload settles its policy barrier after successful **and rejected** native
  calls. Unavailable authority invalidates caches. Rejections retain their
  original operation diagnostic; no mutation is retried automatically.
- Codex pending-save invalidation lasts as long as its module cache. Lookup
  also checks its generation. Only opaque request IDs survive policy changes,
  including while both settings views are unmounted.
- Vast and Runpod credential recovery reload once per confirmed matching-policy
  revision. Focus callbacks use current-generation setters. Failed barriers
  clear caches without creating an automatic read retry loop.
- Configuration smoke accepts the specific intentional policy-barrier rejection
  as denial and continues its body-removal, ordering and restart assertions.
  Dropped notifications do not require a body to survive an earlier response
  barrier. The suite independently observes the durable owner commit, original
  request identity and single dispatch when a changed policy denies its reply;
  the renderer must report success or explicitly uncertain acknowledgement.

`npm run check` includes `scripts/test-stabilization-native.mjs`. It bundles the
actual application main, coordinator, credential entry, preload and renderer.
The rejected-response regression drops the policy notification during a real
Runpod discovery route, registers matching material in the real encrypted vault,
and observes rejection and body removal **without an unrelated metadata read**.
The Codex regression commits through the real save route with a lost reply,
unmounts both settings views, recognizes the cached model, then remounts with a
failed reconciliation. It checks that the next request contains only the same
opaque reconciliation ID. External HTTP, Codex subprocess and reply loss are
controlled; production sender admission, policy, stores and routing remain real.
Both regressions failed on the original production candidate before repairs.

Existing controlled-view tests no longer use an unrelated metadata request to
mask the settlement of a delayed reply. `npm run smoke` runs all four packaged
suites: application, Vast, Codex, and configuration protection. Evidence and the
single recheck are retained separately from previous review inputs. These local
fixtures do not qualify live authentication, inference, GPU execution, physical
power-loss behavior or signed distribution.
