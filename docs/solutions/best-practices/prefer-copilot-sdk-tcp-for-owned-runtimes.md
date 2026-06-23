---
title: "Prefer Copilot SDK TCP transport for owned runtimes"
module: copilot-sdk provider
date: 2026-06-23
problem_type: best_practice
component: tooling
severity: medium
tags:
  - copilot-sdk
  - subprocess
  - epipe
  - runtime-lifecycle
  - provider
applies_when:
  - Using @github/copilot-sdk to launch a local Copilot runtime process
  - Seeing uncaught stdin EPIPE after a Copilot SDK session appears to finish
  - Choosing between RuntimeConnection.forTcp and RuntimeConnection.forStdio
---

# Prefer Copilot SDK TCP transport for owned runtimes

## Context

AgentV's `copilot-sdk` provider can run against an external Copilot runtime URL or own
the local Copilot runtime process for an eval invocation. When AgentV owns the runtime,
`@github/copilot-sdk@1.0.3` offers both stdio and TCP runtime connections.

During eval smoke testing, the stdio transport could complete the assistant turn and
then crash the Node process with an uncaught child `stdin` `EPIPE`. The upstream SDK has
a matching lifecycle issue: `github/copilot-sdk#1427`.

## Guidance

Prefer `RuntimeConnection.forTcp()` when AgentV launches or auto-resolves the local
Copilot runtime. Keep `RuntimeConnection.forStdio()` only as backward compatibility for
older SDK releases that do not expose TCP.

This is not a reason to add global `uncaughtException` handlers or swallow all `EPIPE`
errors. The narrow fix is to choose the SDK-supported transport that avoids the stdio
stdin lifecycle edge case.

## Why This Matters

The provider result is only useful if AgentV can finish writing `index.jsonl`,
per-case artifacts, and benchmark summaries. A post-turn stdio `EPIPE` can crash the
process before result finalization even when the model already produced a usable answer.

TCP also keeps lifecycle handling inside the SDK transport boundary. AgentV should not
reach into private SDK fields such as `forceStopping`, and it should not install
process-wide exception filters for one provider's subprocess pipe behavior.

## When to Apply

- Local owned Copilot runtime: use `RuntimeConnection.forTcp({ path, args })`.
- External Copilot runtime URL: use `RuntimeConnection.forUri(url)`.
- Old SDK without TCP support: fall back to `RuntimeConnection.forStdio({ path, args })`.

## Related

- `packages/core/src/evaluation/providers/copilot-sdk.ts` — runtime connection selection
- `packages/core/test/evaluation/providers/copilot-sdk.test.ts` — TCP/URI constructor coverage
- Upstream issue: `github/copilot-sdk#1427`
