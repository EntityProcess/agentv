# Add Trace Events to Evaluation

## Summary
Add first-class trace capture and trace-aware evaluators to AgentV so users can evaluate agentic/tool-using behavior (tool choice and tool-call trajectories), without writing custom harness code.

## Motivation
Some real-world evals are about more than the final response text. For example, retrieval and investigation workflows often enforce behaviors like:
- minimum tool usage (e.g., multiple semantic-search queries)
- multi-step investigation before final output
- tool-call correctness (tool choice, inputs, and whether results are used)

Today, AgentV’s evaluation pipeline largely operates on the final `candidate_answer` string. As a result, teams are forced to build bespoke runners that capture tool-call traces and enforce trace constraints outside of AgentV.

This change makes trace a first-class evaluation signal, aligned with patterns used by:
- **ADK Python** (event-first, trajectory/tool-call evaluation)
- **Mastra** (trace/span-first, post-hoc trace scoring)
- **Azure AI evaluation** (tool-call evaluators; optional trace-driven evaluation)

## Proposed Changes

### 1. Add a normalized trace model to evaluation results
- Introduce a minimal, provider-agnostic `TraceEvent` model.
- Allow providers to attach a trace to each attempt.
- Persist a lightweight `trace_summary` in results by default.
- Optionally persist full trace payloads when requested.

### 2. Make evaluators trace-aware
- Extend evaluator context so evaluators can consume trace.
- Add template variables so `llm_judge` can optionally see trace (without forcing it).

### 3. Add built-in trace evaluators (no user code)
- Provide deterministic evaluators aligned with ADK’s trajectory approach:
  - `tool_trajectory` (expected tool-call sequence, with explicit tool names)

This avoids ambiguous “count” metrics by requiring that any tool constraints be expressed against explicit tool names and sequences.

### 4. Extend CLI output/debugging for traces
- Add CLI options to persist trace artifacts similarly to `--dump-prompts`.
- Keep default behavior conservative (avoid bloating result files).

## Impact
- **Affected specs**: `evaluation`, `yaml-schema`, `eval-cli`
- **Affected code (expected)**: provider response shapes, orchestrator result assembly, evaluator context/template vars, CLI writers.

## Compatibility
- Additive change.
- Existing eval files and evaluators continue to work unchanged.
- Providers that cannot emit traces simply omit them.
