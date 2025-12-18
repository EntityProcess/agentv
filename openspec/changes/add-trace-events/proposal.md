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

### 3. Support tool calls in expected_messages (Precise Flow)
- Allow `tool_calls` within assistant messages in `expected_messages` to specify expected conversation structure.
- This mirrors actual LLM API formats (OpenAI, Anthropic, Gemini).
- Use when you need to validate:
  - Exact reasoning steps between tool calls
  - Specific conversation flows (golden paths)
  - Tool argument correctness

### 4. Add built-in trace evaluators (High-Level Constraints)
- Provide deterministic evaluators aligned with ADK's trajectory approach:
  - `tool_trajectory` (expected tool-call sequence, with explicit tool names)
- Use when you want:
  - Flexible "must use X ≥ N times" constraints
  - Order-agnostic tool usage validation
  - Simple minimum-call thresholds

### 5. Support Both Together (Complementary)
- `expected_messages` and trace evaluators work together, not as alternatives.
- Common pattern: specify exact flow in `expected_messages` + add safety nets via evaluators.
- Example: golden path conversation + "must search ≥3 times" regardless of exact flow.

### 6. Extend CLI output/debugging for traces
- Add CLI options to persist trace artifacts similarly to `--dump-prompts`.
- Keep default behavior conservative (avoid bloating result files).

## Example

See [example.md](./example.md) for a complete end-to-end scenario demonstrating:
- Agent trace format (multi-step investigation with semantic search)
- Three evaluation patterns (high-level constraints, precise flow, both together)
- Provider integration (converting traces to AgentV format)
- Evaluation results output

## Impact
- **Affected specs**: `evaluation`, `yaml-schema`, `eval-cli`
- **Affected code (expected)**: provider response shapes, orchestrator result assembly, evaluator context/template vars, CLI writers.

## Compatibility
- Additive change.
- Existing eval files and evaluators continue to work unchanged.
- Providers that cannot emit traces simply omit them.
