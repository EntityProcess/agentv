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

### Three Patterns for Tool-Use Validation

**Pattern 1: Precise Flow (expected_messages)**

Validate exact conversation structure including tool calls, reasoning, and turn order:

```yaml
expected_messages:
  - role: user
    content: "Research X"
  # First search iteration
  - role: assistant
    content: "Let me search for X configuration..."
    tool_calls:
      - tool: knowledgeSearch
        args: { query: "X configuration" }
  - role: tool
    name: knowledgeSearch
    content: "..."
  # Reasoning between searches
  - role: assistant
    content: "I found general info, but need specifics..."
    tool_calls:
      - tool: knowledgeSearch
        args: { query: "X detailed setup" }
  - role: tool
    name: knowledgeSearch
    content: "..."
  # Final answer
  - role: assistant
    content: "Based on the results..."
```

**When to use:** Golden path testing, regression tests for specific flows, debugging conversation structure.

**Pattern 2: High-Level Constraints (evaluator)**

Validate that certain tools were called without specifying exact flow:

```yaml
evaluators:
  - type: tool_trajectory
    mode: any_order
    minimums:
      knowledgeSearch: 3
```

Constraints:
- `mode`: `any_order` | `in_order` | `exact`
- `expected`: list of `{ tool: string }` entries
- `minimums`: map of `{ [toolName: string]: number }` for per-tool minimum call counts

**When to use:** "Must search ≥3 times" without caring about reasoning/order, flexible constraints across prompt variations.

**Pattern 3: Both Together (Belt and Suspenders)**

Combine precise flow with safety net constraints:

```yaml
expected_messages:
  - role: user
    content: "Research X"
  # ... exact flow ...

evaluators:
  - type: tool_trajectory
    minimums:
      knowledgeSearch: 3  # Safety: even if flow changes, must search ≥3 times
```

**When to use:** High-value flows where you want both precision and guardrails.

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
