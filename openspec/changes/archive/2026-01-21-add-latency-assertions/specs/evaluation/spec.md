## ADDED Requirements

### Requirement: Per-Step Latency Data in Output Messages

The system SHALL capture per-step timing data in output messages when provided by the execution trace.

#### Scenario: Tool call includes duration
- **GIVEN** a provider returns output messages with timing data:
  ```json
  {
    "output_messages": [{
      "role": "assistant",
      "tool_calls": [{
        "tool": "Read",
        "input": {"file_path": "config.json"},
        "output": "...",
        "duration_ms": 45
      }]
    }]
  }
  ```
- **WHEN** the system parses the output
- **THEN** `outputMessages[0].toolCalls[0].durationMs` equals `45`
- **AND** the timing data is available to evaluators via `context.outputMessages`

#### Scenario: Message includes duration
- **GIVEN** a provider returns output messages with message-level timing:
  ```json
  {
    "output_messages": [{
      "role": "assistant",
      "content": "Done",
      "duration_ms": 1500
    }]
  }
  ```
- **WHEN** the system parses the output
- **THEN** `outputMessages[0].durationMs` equals `1500`

#### Scenario: Duration not provided
- **GIVEN** a provider returns output messages without timing data
- **WHEN** the system parses the output
- **THEN** `durationMs` fields are `undefined`
- **AND** evaluation proceeds normally without timing data

#### Scenario: Timestamp and duration together
- **GIVEN** a provider returns tool calls with both timestamp and duration:
  ```json
  {
    "tool_calls": [{
      "tool": "Read",
      "timestamp": "2026-01-14T09:04:58.826Z",
      "duration_ms": 45
    }]
  }
  ```
- **WHEN** the system parses the output
- **THEN** `timestamp` indicates when the call started
- **AND** `durationMs` indicates how long it took
- **AND** end time can be derived as `timestamp + durationMs` if needed

### Requirement: Per-Step Latency Assertions in Tool Trajectory

The system SHALL support `max_duration_ms` assertions on tool calls within the `tool_trajectory` evaluator.

#### Scenario: Latency assertion passes
- **GIVEN** an eval case with evaluator:
  ```yaml
  type: tool_trajectory
  mode: in_order
  expected:
    - tool: Read
      max_duration_ms: 100
  ```
- **AND** outputMessages contains a Read call with `durationMs: 45`
- **WHEN** the evaluator runs
- **THEN** the latency assertion passes
- **AND** `hits` includes a message like `"Read completed in 45ms (max: 100ms)"`

#### Scenario: Latency assertion fails
- **GIVEN** an eval case with evaluator:
  ```yaml
  type: tool_trajectory
  mode: in_order
  expected:
    - tool: Read
      max_duration_ms: 50
  ```
- **AND** outputMessages contains a Read call with `durationMs: 120`
- **WHEN** the evaluator runs
- **THEN** the latency assertion fails
- **AND** `misses` includes a message like `"Read took 120ms (max: 50ms)"`

#### Scenario: Latency assertion with missing duration data
- **GIVEN** an eval case with evaluator:
  ```yaml
  type: tool_trajectory
  mode: in_order
  expected:
    - tool: Read
      max_duration_ms: 100
  ```
- **AND** outputMessages contains a Read call without `durationMs`
- **WHEN** the evaluator runs
- **THEN** the latency assertion is skipped (not counted as hit or miss)
- **AND** a warning is logged: `"No duration data for Read; latency assertion skipped"`

#### Scenario: Tool sequence with mixed latency assertions
- **GIVEN** an eval case with evaluator:
  ```yaml
  type: tool_trajectory
  mode: exact
  expected:
    - tool: Read
      max_duration_ms: 100
    - tool: Edit
      # No latency assertion
    - tool: Write
      max_duration_ms: 500
  ```
- **AND** outputMessages contains calls `[Read(45ms), Edit(no timing), Write(600ms)]`
- **WHEN** the evaluator runs
- **THEN** the score reflects:
  - Read: sequence hit + latency hit
  - Edit: sequence hit
  - Write: sequence hit + latency miss
- **AND** hits includes Read latency pass
- **AND** misses includes Write latency fail

#### Scenario: Latency assertions in any_order mode
- **GIVEN** an eval case with evaluator:
  ```yaml
  type: tool_trajectory
  mode: any_order
  minimums:
    Read: 2
  expected:
    - tool: Read
      max_duration_ms: 100
  ```
- **WHEN** the evaluator runs with 3 Read calls (50ms, 45ms, 150ms)
- **THEN** the minimum count assertion passes (3 >= 2)
- **AND** latency is checked against each matching call
- **AND** at least one latency failure is reported for the 150ms call

## MODIFIED Requirements

### Requirement: Tool Trajectory Evaluator

The system SHALL provide a built-in `tool_trajectory` evaluator that asserts tool-call constraints using `outputMessages` as the primary source. **The evaluator now supports optional `max_duration_ms` assertions on individual expected tool calls.**

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

#### Scenario: Expected item with latency assertion
- **GIVEN** an eval case with evaluator:
  ```yaml
  type: tool_trajectory
  mode: in_order
  expected:
    - tool: Read
      args: { file_path: "config.json" }
      max_duration_ms: 100
  ```
- **AND** outputMessages contains a matching Read call with `durationMs: 45`
- **WHEN** the evaluator runs
- **THEN** both the tool sequence and latency assertions are checked
- **AND** `hits` includes both sequence match and latency pass messages
