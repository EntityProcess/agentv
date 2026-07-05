---
title: "Prefer Copilot CLI and replay over Copilot SDK for beta eval runs"
module: copilot provider runtime
date: 2026-07-05
problem_type: best_practice
component: tooling
severity: medium
tags:
  - copilot
  - copilot-cli
  - copilot-sdk
  - replay
  - provider-runtime
  - dogfood
applies_when:
  - Choosing the canonical Copilot target for live coding-agent evals
  - Copilot SDK child-runner starts but returns empty output or hangs
  - Comparing AgentV against Harbor/Entire-style Copilot integrations
---

# Prefer Copilot CLI and replay over Copilot SDK for beta eval runs

## Context

AgentV supports coding-agent targets through provider adapters plus normalized run
artifacts. For Copilot, there are three plausible paths:

- Active execution through `copilot-cli`.
- Import/replay from recorded Copilot session events.
- Active execution through `copilot-sdk`.

During `av-t2o5.3`, the SDK child-runner dependency and path issues were fixed and
live dogfood passed for Pi SDK, Codex SDK, and Claude SDK. Copilot SDK still produced
an empty result envelope and then hung until timeout, with the full eval reporting a
`SIGTERM` from the child runner. The earlier TCP transport fix avoided one stdio
`EPIPE` class, but did not make the SDK path reliable enough to be the canonical beta
Copilot runtime.

Peer-framework evidence points the same way for eval harnesses:

- Harbor runs Copilot through `copilot --prompt ... --yolo --output-format json` and
  converts the JSONL output into a trajectory.
- Entire captures Copilot CLI session events and has Copilot-specific token-validation
  handling for `~/.copilot/session-state/<session-id>/events.jsonl`.
- Promptfoo and DeepEval do not expose a Copilot SDK provider in their local clones.
- Vercel `next-evals-oss` result bundles provide normalized and raw transcripts, not
  a Copilot SDK execution path.

## Guidance

Use `copilot-cli` and replay/import as the supported Copilot paths for beta evals.
Keep `copilot-sdk` explicit and experimental until live dogfood shows stable process
lifecycle, non-empty output, and artifact finalization.

Do not model Copilot replay as a separate `copilot-log` target provider. Record or
import provider-specific events into AgentV's normalized transcript/cassette format,
then run graders against that replay source. This avoids one log target per provider
while preserving raw sidecars for debugging.

## Why This Matters

The eval result is only useful after AgentV writes the normalized transcript, raw
transcript sidecar, grader artifacts, and run indexes. A provider path that starts but
hangs after returning an empty envelope can waste live-agent budget and still leave
unclear artifacts.

CLI plus replay also matches the repo-native model: active runs create filesystem
artifacts, and later grading can reuse those artifacts without re-running an expensive
coding agent.

## When to Apply

Prefer this shape for live Copilot evals:

```yaml
targets:
  - id: copilot-local
    provider: copilot-cli
    config:
      command: ["copilot"]
```

Prefer a provider-neutral replay target for grader iteration:

```yaml
targets:
  - id: copilot-replay
    provider: replay
    transcript: .agentv/transcripts/copilot-session.jsonl
```

Use `copilot-sdk` only when the task explicitly exercises that provider:

```yaml
targets:
  - id: copilot-sdk-experimental
    provider: copilot-sdk
```

## Related

- `packages/core/src/evaluation/providers/copilot-sdk.ts` - SDK runtime boundary.
- `apps/cli/src/commands/import/copilot.ts` - Copilot session import boundary.
- `docs/solutions/best-practices/prefer-copilot-sdk-tcp-for-owned-runtimes.md` -
  narrower TCP transport lesson.
- `docs/solutions/best-practices/prefer-isolated-runtime-boundaries-for-agent-sdk-providers.md`
  - child-process boundary for SDK providers.
