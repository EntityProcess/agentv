# Spec Delta: Evaluation Capability

## ADDED Requirements

### Requirement: Output Message Format

The system SHALL accept agent execution data in OpenAI-style output message format with optional extended fields.

#### Scenario: ToolCall with optional trace fields
- **GIVEN** a provider returns output messages with tool calls
- **WHEN** the JSONL contains:
  ```json
  {
    "output_messages": [{
      "role": "assistant",
      "tool_calls": [{
        "tool": "searchDocs",
        "input": {"query": "test"},
        "output": {"results": []},
        "id": "call_123",
        "timestamp": "2025-01-01T00:00:00Z"
      }]
    }]
  }
  ```
- **THEN** the system parses `id` and `timestamp` as optional ToolCall fields
- **AND** converts snake_case wire format to camelCase TypeScript interfaces

#### Scenario: OutputMessage with optional metadata
- **GIVEN** a provider returns output messages
- **WHEN** messages include optional fields:
  ```json
  {
    "output_messages": [{
      "role": "assistant",
      "content": "response",
      "timestamp": "2025-01-01T00:00:00Z",
      "metadata": {"latency_ms": 150}
    }]
  }
  ```
- **THEN** the system parses `timestamp` and `metadata` as optional OutputMessage fields
- **AND** makes these available to evaluators via `context.outputMessages`

### Requirement: Evaluator OutputMessages Context

The system SHALL pass output messages to evaluators as the primary source for tool trajectory analysis.

#### Scenario: OutputMessages available in evaluator context
- **GIVEN** a provider returns `output_messages` with `tool_calls`
- **WHEN** an evaluator is invoked
- **THEN** `context.outputMessages` contains the parsed messages
- **AND** evaluators can access tool calls via `outputMessages[].toolCalls[]`

#### Scenario: Fallback to trace when outputMessages absent
- **GIVEN** a provider returns `trace` but no `output_messages`
- **WHEN** an evaluator is invoked
- **THEN** `context.trace` contains the trace events
- **AND** `context.outputMessages` is undefined

## MODIFIED Requirements

### Requirement: Trace Data Model

The system SHALL use a normalized trace model for provider-agnostic evaluation. **The `trace` field is deprecated in favor of `outputMessages`.**

#### Scenario: TraceEvent structure
- **GIVEN** a provider returns trace data
- **WHEN** the trace is normalized
- **THEN** each event has required field `type` (one of `model_step`, `tool_call`, `tool_result`, `message`, `error`)
- **AND** optional fields `timestamp` (ISO 8601), `id`, `name`, `input`, `output`, `text`, `metadata`
- **AND** the `trace` field carries a `@deprecated` annotation recommending `outputMessages` instead

#### Scenario: TraceSummary computation
- **GIVEN** a normalized trace with events:
  ```json
  [
    { "type": "tool_call", "name": "searchDocs" },
    { "type": "tool_result" },
    { "type": "tool_call", "name": "searchDocs" },
    { "type": "tool_result" },
    { "type": "tool_call", "name": "verify" },
    { "type": "tool_result" }
  ]
  ```
- **WHEN** TraceSummary is computed
- **THEN** the result is:
  ```json
  {
    "eventCount": 6,
    "toolNames": ["searchDocs", "verify"],
    "toolCallsByName": { "searchDocs": 2, "verify": 1 },
    "errorCount": 0
  }
  ```
- **AND** `toolNames` is sorted alphabetically

#### Scenario: TraceSummary from outputMessages
- **GIVEN** output messages with tool calls:
  ```json
  [
    { "role": "assistant", "toolCalls": [{ "tool": "searchDocs" }, { "tool": "verify" }] }
  ]
  ```
- **WHEN** TraceSummary is computed from outputMessages
- **THEN** the result matches trace-based computation:
  ```json
  {
    "eventCount": 2,
    "toolNames": ["searchDocs", "verify"],
    "toolCallsByName": { "searchDocs": 1, "verify": 1 },
    "errorCount": 0
  }
  ```

### Requirement: Tool Trajectory Evaluator

The system SHALL provide a built-in `tool_trajectory` evaluator that asserts tool-call constraints using `outputMessages` as the primary source.

#### Scenario: Minimum calls met - PASS (from outputMessages)
- **GIVEN** an eval case with evaluator:
  ```yaml
  type: tool_trajectory
  mode: any_order
  minimums:
    semanticSearch: 3
  ```
- **AND** outputMessages contains 3 tool calls to `semanticSearch`
- **WHEN** the evaluator runs
- **THEN** it returns `score: 1.0`
- **AND** `hits` includes a message like `"semanticSearch called 3 times (minimum: 3)"`

#### Scenario: Minimum calls met - PASS (fallback to trace)
- **GIVEN** an eval case with evaluator:
  ```yaml
  type: tool_trajectory
  mode: any_order
  minimums:
    semanticSearch: 3
  ```
- **AND** no outputMessages available
- **AND** trace summary `toolCallsByName: { "semanticSearch": 3 }`
- **WHEN** the evaluator runs
- **THEN** it returns `score: 1.0` using the trace fallback

#### Scenario: Minimum calls not met - FAIL
- **GIVEN** an eval case with evaluator:
  ```yaml
  type: tool_trajectory
  mode: any_order
  minimums:
    semanticSearch: 3
  ```
- **AND** outputMessages contains 1 tool call to `semanticSearch`
- **WHEN** the evaluator runs
- **THEN** it returns `score: 0.0`
- **AND** `misses` includes a message like `"semanticSearch called 1 time (minimum: 3)"`

#### Scenario: Multiple minimums - partial pass
- **GIVEN** an eval case with evaluator:
  ```yaml
  type: tool_trajectory
  mode: any_order
  minimums:
    toolA: 2
    toolB: 2
  ```
- **AND** outputMessages contains 2 calls to `toolA` and 1 call to `toolB`
- **WHEN** the evaluator runs
- **THEN** it returns `score: 0.5` (1 of 2 constraints met)
- **AND** `hits` includes message for toolA
- **AND** `misses` includes message for toolB

#### Scenario: In-order sequence - PASS
- **GIVEN** an eval case with evaluator:
  ```yaml
  type: tool_trajectory
  mode: in_order
  expected:
    - tool: A
    - tool: B
    - tool: C
  ```
- **AND** outputMessages contains tool calls in order `[A, X, B, Y, C]` (extra tools allowed)
- **WHEN** the evaluator runs
- **THEN** it returns `score: 1.0`

#### Scenario: In-order sequence - FAIL (wrong order)
- **GIVEN** an eval case with evaluator:
  ```yaml
  type: tool_trajectory
  mode: in_order
  expected:
    - tool: A
    - tool: B
  ```
- **AND** outputMessages contains tool calls in order `[B, A]`
- **WHEN** the evaluator runs
- **THEN** it returns `score: 0.0`
- **AND** `misses` explains the order mismatch

#### Scenario: Exact sequence - PASS
- **GIVEN** an eval case with evaluator:
  ```yaml
  type: tool_trajectory
  mode: exact
  expected:
    - tool: A
    - tool: B
  ```
- **AND** outputMessages contains exactly tool calls `[A, B]`
- **WHEN** the evaluator runs
- **THEN** it returns `score: 1.0`

#### Scenario: Exact sequence - FAIL (extra tools)
- **GIVEN** an eval case with evaluator:
  ```yaml
  type: tool_trajectory
  mode: exact
  expected:
    - tool: A
    - tool: B
  ```
- **AND** outputMessages contains tool calls `[A, B, C]`
- **WHEN** the evaluator runs
- **THEN** it returns `score: 0.0`
- **AND** `misses` explains the extra tool

#### Scenario: No trace or outputMessages available
- **GIVEN** an eval case with a `tool_trajectory` evaluator
- **AND** the provider returned neither trace nor outputMessages
- **WHEN** the evaluator runs
- **THEN** it returns `score: 0.0`
- **AND** `misses` includes `"No trace available for evaluation"`
