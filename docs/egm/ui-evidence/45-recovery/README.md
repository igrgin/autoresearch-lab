# Codex quarantine recovery

Both captures use isolated profiles, synthetic credentials, and the controlled stdio fixture; no live account authentication or inference.

Before: the packaged stack at766d442 restarts after a stored model becomes a registered credential value. Strict metadata reads correctly withhold it, but Settings cannot obtain the safe credential choices, so authentication and replacement controls remain unavailable. The executable baseline smoke failed selecting its existing active key.

After: the repaired packaged app recovers independently admitted references, selects an explicitly clean default through Settings, and appends project selection revision2 through Runs. The image shows that clean replacement. The old incident and quarantine remain; no old model value is returned. The captures intentionally show the initial Settings failure and resulting Runs replacement, not identical panels.

The regression is in scripts/smoke-codex.mjs. Unit tests also verify safe recovery after restart, clean default/project replacement, retained incident identities after remediation, and refusal when projection admission fails.
