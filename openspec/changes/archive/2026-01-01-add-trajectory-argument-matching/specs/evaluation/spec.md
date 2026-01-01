## MODIFIED Requirements

### Requirement: Tool Trajectory Evaluator

The system SHALL provide a built-in `tool_trajectory` evaluator that asserts tool-call constraints, including optional argument validation.

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

#### Scenario: In-order with exact argument matching - PASS
- **GIVEN** an eval case with evaluator:
  ```yaml
  type: tool_trajectory
  mode: in_order
  expected:
    - tool: search
      args:
        query: "weather forecast"
    - tool: get_weather
      args:
        location: "Paris"
  ```
- **AND** trace contains tool calls `[search(query="weather forecast"), get_weather(location="Paris")]`
- **WHEN** the evaluator runs
- **THEN** it returns `score: 1.0`

#### Scenario: In-order with exact argument matching - FAIL (wrong args)
- **GIVEN** an eval case with evaluator:
  ```yaml
  type: tool_trajectory
  mode: in_order
  expected:
    - tool: search
      args:
        query: "weather forecast"
  ```
- **AND** trace contains tool calls `[search(query="stock prices")]`
- **WHEN** the evaluator runs
- **THEN** it returns `score: 0.0`
- **AND** `misses` explains the argument mismatch

#### Scenario: Argument matching with `any` skip mode
- **GIVEN** an eval case with evaluator:
  ```yaml
  type: tool_trajectory
  mode: in_order
  expected:
    - tool: search
      args: any
    - tool: process
      args:
        format: "json"
  ```
- **AND** trace contains tool calls `[search(query="anything"), process(format="json")]`
- **WHEN** the evaluator runs
- **THEN** it returns `score: 1.0`
- **AND** the `search` tool's arguments are not validated
- **AND** the `process` tool's `format` argument is validated

#### Scenario: Exact mode with argument matching
- **GIVEN** an eval case with evaluator:
  ```yaml
  type: tool_trajectory
  mode: exact
  expected:
    - tool: auth
      args:
        method: "oauth"
    - tool: fetch
      args:
        endpoint: "/api/users"
  ```
- **AND** trace contains exactly `[auth(method="oauth"), fetch(endpoint="/api/users")]`
- **WHEN** the evaluator runs
- **THEN** it returns `score: 1.0`

#### Scenario: Partial argument matching (subset validation)
- **GIVEN** an eval case with evaluator:
  ```yaml
  type: tool_trajectory
  mode: in_order
  expected:
    - tool: api_call
      args:
        method: "POST"
        # url not specified - not validated
  ```
- **AND** trace contains tool calls `[api_call(method="POST", url="https://example.com", headers={})]`
- **WHEN** the evaluator runs
- **THEN** it returns `score: 1.0`
- **AND** only the specified `method` argument is validated
- **AND** extra arguments `url` and `headers` are ignored
