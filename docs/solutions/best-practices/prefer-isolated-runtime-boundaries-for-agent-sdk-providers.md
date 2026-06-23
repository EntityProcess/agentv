---
title: "Prefer isolated runtime boundaries for agent SDK providers"
module: provider runtime
date: 2026-06-23
problem_type: best_practice
component: tooling
severity: medium
tags:
  - provider-runtime
  - subprocess
  - sdk-providers
  - pi-coding-agent
  - epipe
  - agent-eval
applies_when:
  - Integrating a long-running coding-agent SDK as an AgentV provider
  - Seeing post-run stream errors such as `write EPIPE` after an agent turn appears complete
  - Choosing between a CLI provider, an in-process SDK provider, and an isolated SDK runner
---

# Prefer isolated runtime boundaries for agent SDK providers

## Context

While validating Next Evals OSS-style cases, the `pi-coding-agent` SDK path could handle short AgentV examples but crashed during a tool-heavy long-running case after the agent lifecycle had already reached `agent_end`. The crash surfaced as an unhandled `write EPIPE`, which can terminate the AgentV parent process before it finalizes `index.jsonl`, per-case artifacts, benchmark summaries, and Dashboard-visible evidence.

A separate Copilot SDK `EPIPE` was addressed by switching owned Copilot runtimes to the SDK-supported TCP transport. That does not generalize to PI SDK: a standalone `createAgentSession()` smoke did not reproduce the PI failure, and no narrow upstream SDK fix was identified. Adding a broad process-level `uncaughtException` or global `EPIPE` swallow would hide unknown stream failures in a concurrent eval runner.

Vercel `agent-eval` points to the safer integration pattern: long-running coding agents are executed through sandboxed CLI commands or command-like runners, and the evaluator parent process observes command exit status and captured output instead of directly owning every SDK stream in-process.

## Investigation Findings

The PI SDK investigation traced the `createAgentSession` path, `AgentSession.prompt()`, disposal, RPC client code, output guard code, built-in bash tool execution, clipboard subprocess handling, and OpenAI Responses streaming. A standalone SDK smoke script against the local OpenAI-compatible endpoint with built-in tools enabled reached `agent_end`, resolved `prompt()`, and disposed cleanly.

That passing smoke does not disprove the long-running failure. It suggests the crash depends on the tool-heavy workload shape: many tool calls, delayed teardown, or a provider/socket cleanup race that does not appear in a short SDK run.

Several obvious PI-owned closed-pipe write paths were already guarded:

- `RpcClient` consumes child stdin `error` events.
- The built-in bash tool attaches a child stdin `error` listener before writing or ending command input.
- Clipboard subprocess stdin handling also tolerates expected early exits.

The failing socket remains unidentified. It could be process stdout or stderr, child-process stdin, provider HTTP transport, or another stream created during teardown. Without a stack or async-context trace naming the socket owner, an upstream SDK patch would be speculative.

## Guidance

Prefer CLI-backed providers for long-running coding agents when a working CLI path exists. For PI, the `pi-cli` provider with the Azure/local-endpoint shape should be the default path for Next Evals OSS-style work until the SDK path has a stronger isolation boundary.

Do not add a broad AgentV-level `EPIPE` workaround for PI SDK teardown. If an SDK offers a supported transport that avoids the failing pipe lifecycle, as Copilot SDK does with TCP, use that targeted transport. If the SDK does not expose an equivalent narrow fix, isolate the SDK rather than swallowing process-wide errors. If a temporary guard is ever needed for debugging, it must be narrowly scoped to a known teardown window, match `code === "EPIPE"` and `syscall === "write"`, and preserve all unrelated errors.

If AgentV needs an SDK-backed provider for PI or similar agents, wrap the SDK in a subprocess or sandbox runner with a small AgentV-owned protocol:

```text
AgentV orchestrator
  -> spawn isolated SDK runner with cwd, env, target config, and request JSON
  -> stream structured events and raw logs back to AgentV
  -> receive final ProviderResponse JSON or a provider error
  -> always finalize run artifacts from the parent process
```

The child process may still hit an SDK stream bug, but the parent should convert that into a provider failure for the affected case rather than losing the whole eval run. The parent owns run artifact finalization, cleanup, timeout enforcement, and Dashboard-visible error reporting.

Lazy-loading an SDK is still useful for package footprint and optional dependencies, but it is not a runtime isolation boundary. A lazily imported SDK can still crash the parent process if it emits an unhandled stream error in-process.

## Why This Matters

Eval artifacts are the product boundary: failed provider calls are diagnosable only if AgentV finishes writing the run bundle. A global exception filter can make the CLI appear to survive while leaving the orchestrator in an unknown state. Subprocess or sandbox isolation keeps provider instability local to one target invocation and preserves the parent runner's ability to record the failure.

This also aligns AgentV with Vercel `agent-eval`'s practical harness shape without copying its product model. AgentV can remain repo-native and zero-infra while still treating long-running agent runtimes as external commands for reliability.

## When to Apply

- A provider invokes a full coding agent runtime that can run tools, mutate workspaces, stream logs, or manage its own child processes.
- A provider SDK emits stream or socket errors during teardown after a response has already been produced.
- A CLI path exists and is good enough for the eval use case.
- A future SDK-only capability is important enough to justify an isolated runner protocol.

## Examples

**Prefer a CLI provider for the current PI path:**

```yaml
targets:
  pi-cli-local:
    provider: pi-cli
    base_url: ${AGENTV_OPENAI_BASE_URL}
    api_key: ${AGENTV_OPENAI_API_KEY}
    model: ${AGENTV_CODEX_MODEL}
```

**Avoid broad parent-process exception handling:**

```typescript
// Avoid this as a provider fix: it can hide unrelated failures and leave
// concurrent eval state ambiguous.
process.on('uncaughtException', (error) => {
  if ((error as NodeJS.ErrnoException).code === 'EPIPE') {
    return;
  }
  throw error;
});
```

**Use a child boundary when an SDK provider is still needed:**

```text
agentv eval run
  -> provider runner subprocess
    -> imports @vendor/coding-agent-sdk
    -> runs the agent session
    -> prints ProviderResponse JSON or exits non-zero
```

## Related

- `docs/solutions/best-practices/prefer-copilot-sdk-tcp-for-owned-runtimes.md` - targeted Copilot SDK transport fix for a different `EPIPE` source
- `packages/core/src/evaluation/providers/pi-cli.ts` - preferred PI provider path for long-running evals
- `packages/core/src/evaluation/providers/pi-coding-agent.ts` - candidate for future SDK subprocess isolation if SDK-only behavior becomes necessary
