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

**Note:** The `toolCallsByName` summary enables the `tool_trajectory` evaluator with `minimums` to validate tool usage counts without needing a separate `tool_call_count` evaluator.

## Execution Plumbing

### ProviderResponse
- Providers MAY attach a trace to each invocation.
- Providers MAY attach a `trace_ref` (path/identifier) when the trace is stored externally.

**Implementation scope:** Provider trace emission is **deferred to follow-up work**. Initial implementation focuses on:
1. Trace data model and schema validation
2. Evaluator infrastructure (tool_trajectory)
3. CLI options for trace persistence
4. Support for providers that supply traces via external files (trace.json)

Provider-specific trace capture (Azure, Anthropic, Gemini, VSCode, Codex) will be added incrementally after core infrastructure is stable.

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

## Architectural Decision: Multiple Tool Calls Format

### Industry Comparison

Different frameworks handle multiple tool calls differently:

| Framework | Approach | Structure |
|-----------|----------|-----------|
| **ADK Python** | Multiple parts in ONE event | `Event(content=Content(parts=[Part(function_call), Part(function_call), ...]))` |
| **Mastra** | Multiple parts in ONE message (internal) | Converts to separate assistant + tool messages for LLM |
| **Azure SDK** | ONE assistant message + MULTIPLE tool messages | `AssistantMessage(tool_calls=[...])` + `ToolMessage(tool_call_id="1")` + `ToolMessage(tool_call_id="2")` + ... |

**Example: 3 tool calls in one turn**

**ADK Python:**
```python
# ONE Event with 3 parts
Event(content=Content(parts=[
  Part(function_call=FunctionCall(name='get_weather', args={...})),
  Part(function_call=FunctionCall(name='get_time', args={...})),
  Part(function_call=FunctionCall(name='get_traffic', args={...}))
]))
```

**Azure SDK:**
```python
# ONE assistant message + THREE separate tool messages
AssistantMessage(tool_calls=[call1, call2, call3])
ToolMessage(tool_call_id="call-1", content="...")
ToolMessage(tool_call_id="call-2", content="...")
ToolMessage(tool_call_id="call-3", content="...")
```

### AgentV's Choice: Compact Inline Format

**Decision:** AgentV uses a compact format where tool calls and results are co-located:

```yaml
- role: assistant
  tool_calls:
    - tool: getWeather
      input: { city: "NYC" }  # Flow style (inline JSON) - compact for simple inputs
      output: "72°F"
    - tool: getTime
      input:                   # Block style - clearer for complex inputs
        timezone: "EST"
        format: "24h"
      output: "14:30"
    - tool: getTraffic
      input: { location: "Manhattan" }
      output: "Heavy"
```

Both YAML flow style (`{ }`) and block style are supported since YAML parsers handle both natively. Users can choose based on readability preferences.

**Rationale:**
1. **Less verbose** than Azure-style (4 messages → 1 message)
2. **Natural 1:1 mapping** - each tool call is one spec entry
3. **Framework-agnostic** - can be converted to any format:
   - ADK: Expand to multiple parts in one Event
   - Azure: Expand to multiple ToolMessage objects
   - Mastra: Convert to multiple tool-invocation parts
4. **Evaluation-focused** - optimized for specifying expectations, not runtime execution
5. **Optional output** - supports validation when needed without requiring separate message segments

**Trade-offs accepted:**
- Not a direct 1:1 match with any single framework's runtime format
- Providers must convert between runtime format and AgentV's evaluation format
- This is acceptable because evaluation specs prioritize readability over runtime fidelity

## YAML Surface Area

### Two Complementary Patterns

**Pattern A: Compact Tool Specifications (Precise Flow)**

Validate exact tool usage with inline input/output specs:

```yaml
expected_messages:
  - role: user
    content: "Research X"
  - role: assistant
    content: "Let me search for X configuration..."
    tool_calls:
      - tool: knowledgeSearch
        input: { query: "X configuration" }
        output: "..."  # Optional: specify expected output
      - tool: knowledgeSearch  # Multiple calls in same turn
        input: { query: "X detailed setup" }
  - role: assistant
    content: "I found general info. Let me verify..."
    tool_calls:
      - tool: knowledgeSearch
        input: { query: "X troubleshooting" }
  - role: assistant
    content: "Based on the results..."
```

**Key features:**
- 1:1 tool call to spec (natural mapping)
- Supports multiple calls per turn
- Optional output validation
- Less verbose than separate message segments

**When to use:** Golden path testing, argument validation, output expectations.

**Pattern B: High-Level Constraints (Evaluator)**

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

**Combining Both Patterns (Belt and Suspenders)**

```yaml
expected_messages:
  - role: assistant
    tool_calls:
      - tool: knowledgeSearch
        input: { query: "..." }
      # ... more calls ...

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
