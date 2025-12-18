# Spec Delta: Evaluation (Trace Events)

## MODIFIED Requirements

### Requirement: Test Case Execution

The system SHALL capture provider traces (when available) and make them available to evaluators and output writers.

#### Scenario: Provider returns a trace
- **WHEN** a provider invocation completes successfully
- **AND** the provider response includes a trace payload
- **THEN** the system captures the trace for that eval case attempt
- **AND** computes a `trace_summary` with `eventCount`, `toolNames`, `toolCallsByName`, and `errorCount`
- **AND** makes `candidate_trace` and `candidate_trace_summary` available to evaluators

#### Scenario: Provider does not support traces
- **WHEN** a provider invocation completes successfully
- **AND** the provider response includes no trace payload
- **THEN** evaluation proceeds as normal
- **AND** `candidate_trace` and `candidate_trace_summary` are `null` in evaluator context

### Requirement: Custom Evaluators

The system SHALL allow evaluators to consume trace information when available.

#### Scenario: Deterministic trace evaluator reads trace
- **WHEN** an eval case includes a trace-based evaluator (e.g., `tool_trajectory`)
- **THEN** the evaluator receives `candidate_trace_summary`
- **AND** scores the case deterministically based on configured thresholds

#### Scenario: LLM judge may consume trace (opt-in)
- **WHEN** an `llm_judge` evaluator is configured to include trace context
- **THEN** the evaluator prompt MAY include a trace summary section
- **AND** the evaluator remains valid when trace is absent

## ADDED Requirements

### Requirement: Trace Data Model

The system SHALL use a normalized trace model for provider-agnostic evaluation.

#### Scenario: TraceEvent structure
- **GIVEN** a provider returns trace data
- **WHEN** the trace is normalized
- **THEN** each event has required fields `type` (one of `model_step`, `tool_call`, `tool_result`, `message`, `error`) and `timestamp` (ISO 8601)
- **AND** optional fields `id`, `name`, `input`, `output`, `text`, `metadata`

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

### Requirement: Tool Trajectory Evaluator

The system SHALL provide a built-in `tool_trajectory` evaluator that asserts tool-call constraints.

#### Scenario: Minimum calls met - PASS
- **GIVEN** an eval case with evaluator:
  ```yaml
  type: tool_trajectory
  mode: any_order
  minimums:
    semanticSearch: 3
  ```
- **AND** trace summary `toolCallsByName: { "semanticSearch": 3 }`
- **WHEN** the evaluator runs
- **THEN** it returns `score: 1.0`
- **AND** `hits` includes a message like `"semanticSearch called 3 times (minimum: 3)"`

#### Scenario: Minimum calls not met - FAIL
- **GIVEN** an eval case with evaluator:
  ```yaml
  type: tool_trajectory
  mode: any_order
  minimums:
    semanticSearch: 3
  ```
- **AND** trace summary `toolCallsByName: { "semanticSearch": 1 }`
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
- **AND** trace summary `toolCallsByName: { "toolA": 2, "toolB": 1 }`
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
- **AND** trace contains tool calls in order `[A, X, B, Y, C]` (extra tools allowed)
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
- **AND** trace contains tool calls in order `[B, A]`
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
- **AND** trace contains exactly tool calls `[A, B]`
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
- **AND** trace contains tool calls `[A, B, C]`
- **WHEN** the evaluator runs
- **THEN** it returns `score: 0.0`
- **AND** `misses` explains the extra tool

#### Scenario: No trace available
- **GIVEN** an eval case with a `tool_trajectory` evaluator
- **AND** the provider did not return a trace
- **WHEN** the evaluator runs
- **THEN** it returns `score: 0.0`
- **AND** `misses` includes `"No trace available for evaluation"`

### Requirement: Expected Messages Tool Call Validation

The system SHALL validate `tool_calls` in `expected_messages` against the actual trace.

#### Scenario: Tool calls match - PASS
- **GIVEN** an eval case with `expected_messages`:
  ```yaml
  expected_messages:
    - role: assistant
      tool_calls:
        - tool: searchDocs
          input: { query: "test" }
  ```
- **AND** trace contains:
  ```json
  [{ "type": "tool_call", "name": "searchDocs", "input": { "query": "test" } }]
  ```
- **WHEN** validation runs
- **THEN** score is `1.0`
- **AND** `hits` includes `"tool_calls[0]: searchDocs matched"`

#### Scenario: Tool name mismatch - FAIL
- **GIVEN** an eval case with `expected_messages`:
  ```yaml
  expected_messages:
    - role: assistant
      tool_calls:
        - tool: searchDocs
  ```
- **AND** trace contains:
  ```json
  [{ "type": "tool_call", "name": "verifyUser" }]
  ```
- **WHEN** validation runs
- **THEN** score is `0.0`
- **AND** `misses` includes `"tool_calls[0]: expected searchDocs, got verifyUser"`

#### Scenario: Input mismatch - FAIL
- **GIVEN** an eval case with `expected_messages`:
  ```yaml
  expected_messages:
    - role: assistant
      tool_calls:
        - tool: searchDocs
          input: { query: "expected query" }
  ```
- **AND** trace contains:
  ```json
  [{ "type": "tool_call", "name": "searchDocs", "input": { "query": "different query" } }]
  ```
- **WHEN** validation runs
- **THEN** score is `0.0`
- **AND** `misses` includes `"tool_calls[0]: input mismatch"`

#### Scenario: Input not specified - match tool name only
- **GIVEN** an eval case with `expected_messages`:
  ```yaml
  expected_messages:
    - role: assistant
      tool_calls:
        - tool: searchDocs
  ```
- **AND** trace contains:
  ```json
  [{ "type": "tool_call", "name": "searchDocs", "input": { "query": "any value" } }]
  ```
- **WHEN** validation runs
- **THEN** score is `1.0`
- **AND** `hits` includes `"tool_calls[0]: searchDocs matched"`

#### Scenario: Multiple tool calls - partial match
- **GIVEN** an eval case with `expected_messages`:
  ```yaml
  expected_messages:
    - role: assistant
      tool_calls:
        - tool: searchDocs
        - tool: verifyUser
  ```
- **AND** trace contains:
  ```json
  [
    { "type": "tool_call", "name": "searchDocs" },
    { "type": "tool_call", "name": "wrongTool" }
  ]
  ```
- **WHEN** validation runs
- **THEN** score is `0.5` (1 of 2 matched)
- **AND** `hits` includes message for searchDocs
- **AND** `misses` includes message for verifyUser mismatch

#### Scenario: Fewer actual calls than expected - FAIL
- **GIVEN** an eval case with `expected_messages`:
  ```yaml
  expected_messages:
    - role: assistant
      tool_calls:
        - tool: searchDocs
        - tool: verifyUser
  ```
- **AND** trace contains:
  ```json
  [{ "type": "tool_call", "name": "searchDocs" }]
  ```
- **WHEN** validation runs
- **THEN** score is `0.5` (1 of 2 matched)
- **AND** `misses` includes `"tool_calls[1]: expected verifyUser, but no more tool calls in trace"`

#### Scenario: No trace but expected_messages has tool_calls - FAIL
- **GIVEN** an eval case with `expected_messages` containing `tool_calls`
- **AND** the provider did not return a trace
- **WHEN** validation runs
- **THEN** score is `0.0`
- **AND** `misses` includes `"No trace available to validate tool_calls"`

### Requirement: Score Aggregation

The system SHALL aggregate scores when multiple evaluators are configured.

#### Scenario: Multiple evaluators aggregation
- **GIVEN** an eval case with two evaluators
- **AND** evaluator A returns `score: 1.0`
- **AND** evaluator B returns `score: 0.0`
- **WHEN** scores are aggregated
- **THEN** overall `score` is `0.5` (mean of individual scores)
- **AND** `status` is `"fail"` (score < 1.0)
