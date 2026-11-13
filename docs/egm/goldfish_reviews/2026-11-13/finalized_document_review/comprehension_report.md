**What this proposes**

A personal macOS application would create generated PyTorch research projects and run autonomous experiments on the user's existing Runpod or Vast.ai instances through Codex or Claude. Each run fixes its initialization procedure, research inputs, metrics, experiment duration, and stopping expression; candidates train afresh, select an eligible validation checkpoint, and compete against the best validated result so far. Separate test scores inform the user but stay outside research decisions and the agent's context. The application preserves experiment and run history, retains the selected model, provides distinct Pause/Finish/Stop controls, and requires bounded remote recovery when contact with the Mac is lost.

**How the existing system works, per this document**

The document describes reference implementations rather than an already implemented application. Karpathy's autoresearch establishes a baseline, commits candidate changes, trains from fresh initialization, and keeps or discards changes using a primary validation score while protecting preparation/evaluation code and dependencies. Other adaptations illustrate different checkpoint and metric practices; this application intentionally extends the reference with eligible-checkpoint selection, configurable ranking, richer history, and explicit lifecycle behavior. Compute already exists in the user's provider accounts, and provider lifecycle management remains manual.

**Findings**

No comprehension findings. After checking the entire target, I found no concrete internal contradiction, undefined project-specific concept essential to understanding the proposal, or essential workflow gap that prevents a coherent reading.

The brief distinguishes approved behavior from recommendations and explicitly deferred design decisions. In particular, it connects code acceptance to the incumbent result, separates accepted code from weight initialization, distinguishes validation from test assessment, and explains how interruption, recovery, retention, and provider reservations relate. The unresolved enforcement, compatibility, timeout, and state-transition details are identified as design work rather than presented as completed solutions.

**Required-read attestation**

I read the complete comprehension persona and the complete target, `concepts_brief.md`, lines 1–303. I did not read linked documents, earlier reviews, source pages, manifests, memory, or other files, and I performed no edits or source execution. Initial combined tool output was truncated; targeted rereads recovered the omitted text. No required material remains unread.

**Readiness assessment**

The finalized brief stands on its own and is ready to enter formal design upon the user's explicit instruction. It is not an implementation specification; the design follow-up register identifies the remaining decisions without preventing comprehension of the agreed product behavior.
