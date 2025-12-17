# Design: Trace Events in AgentV

## Goals
- Let users evaluate **process**, not just final text (tool-use, step count, trajectory).
- Keep it **minimal and provider-agnostic**.
- Avoid forcing users to write custom harness code for common trace checks.

## Non-goals (initial scope)
- Full OpenTelemetry compatibility.
- A full agent runner / tool execution engine inside AgentV.
- Replaying traces to re-run models.

## Background: External patterns
- **ADK Python**: event-first model; evaluation consumes a trajectory of tool calls + intermediate steps.
- **Mastra**: span tree stored in an observability store; scoring can be post-hoc against stored traces.
- **Azure AI evaluation**: ships tool-call evaluators; can score from trace IDs in a hosted flow.

AgentV should adopt the simplest common denominator: a normalized **event list**.

## Data Model

### TraceEvent (normalized)
A trace is represented as an ordered list of events (attempt-local).

Required fields:
- `type`: one of `model_step`, `tool_call`, `tool_result`, `message`, `error`
- `timestamp`: ISO 8601 string

Recommended fields:
- `id`: stable identifier (for pairing tool_call/tool_result)
- `name`: tool name (for tool_call/tool_result)
- `input`: JSON value (tool input)
- `output`: JSON value (tool output)
- `text`: message content (for message/model_step)
- `metadata`: JSON object (provider-specific)

### TraceSummary (always persisted)
To avoid result bloat, AgentV persists a compact summary by default:
- `eventCount`
- `toolNames` (unique, sorted)
- `toolCallsByName` (map of tool name to call count)
- `errorCount`

Full trace payload persistence is optional.

## Execution Plumbing

### ProviderResponse
- Providers MAY attach a trace to each invocation.
- Providers MAY attach a `trace_ref` (path/identifier) when the trace is stored externally.

### Orchestrator
- The orchestrator SHALL propagate trace into:
  - evaluation results (for output)
  - evaluator context (for scoring)

### Evaluator Context
- Evaluators SHALL receive:
  - `candidate` (final text)
  - optional `candidate_trace`
  - optional `candidate_trace_summary`

LLM judges get trace via opt-in template variables.

## YAML Surface Area

### New evaluator types
Provide trace checks as built-in evaluators so users don’t need custom code:

1) `tool_trajectory`
- Constraints:
  - `mode`: `any_order` | `in_order` | `exact`
  - `expected`: list of `{ tool: string }` entries
  - optional `minimums`: map of `{ [toolName: string]: number }` for per-tool minimum call counts

`tool_trajectory` is the primary deterministic mechanism. If users want “must call knowledgeSearch ≥ 3 times”, they express it via `minimums.knowledgeSearch: 3` rather than relying on an ambiguous global count.

## Result Serialization
- JSONL/YAML outputs include `trace_summary` by default.
- Full `trace` included only when enabled via CLI option.

## Alternatives Considered
- **Span tree (Mastra-style)**: powerful but heavier; defer until needed.
- **OTel export**: valuable, but not required to replace current bespoke trace checks.

## Risks
- Provider heterogeneity: not all providers can supply trace.
- Payload bloat: must keep defaults conservative.
- Privacy: traces may include tool inputs/outputs; default to summary-only persistence.
