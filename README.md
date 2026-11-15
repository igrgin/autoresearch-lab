# Autoresearch Lab

A personal desktop application for autonomous PyTorch research. Set up a task and dataset, assign an existing cloud GPU instance, and let a research agent iterate on training code while you track experiments, metrics, and selected models.

Planned capabilities:

- Codex and Claude research agents with model selection.
- Runpod and Vast.ai instances, including multi-GPU hardware.
- Agent-designed architectures and fine-tuning of external or previous-run models.
- Experiment history, training graphs, run controls, and model retention.

## Getting started

On Apple Silicon macOS, install Node 24.22.3 and Apple Command Line Tools, then run:

```sh
npm ci
npm run build
open "out/Autoresearch Lab-darwin-arm64/Autoresearch Lab.app"
```

The initial shell provides Projects, Runs and Compute navigation. See the
[build instructions](./docs/BUILD.md) for prerequisites, development, packaged
smoke checks, CI output and current limitations.

## Documentation

- [Design index](./docs/designs/SITEMAP.md) — specifications and supporting records.
- [Design draft](./docs/egm/design_draft.md) — goals, open technical questions, and implementation plan.
