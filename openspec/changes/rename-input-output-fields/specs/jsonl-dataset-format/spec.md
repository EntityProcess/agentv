# jsonl-dataset-format Specification (Delta)

## ADDED Requirements

### Requirement: Input alias with shorthand support in JSONL

The JSONL parser SHALL support `input` as an alias for `input_messages` with shorthand expansion.

#### Scenario: String shorthand in JSONL
- **GIVEN** a JSONL line with:
  ```jsonl
  {"id": "test", "expected_outcome": "Goal", "input": "What is 2+2?"}
  ```
- **WHEN** the line is parsed
- **THEN** `input_messages` SHALL be set to:
  ```json
  [{"role": "user", "content": "What is 2+2?"}]
  ```

#### Scenario: Array input via alias in JSONL
- **GIVEN** a JSONL line with:
  ```jsonl
  {"id": "test", "expected_outcome": "Goal", "input": [{"role": "user", "content": "Query"}]}
  ```
- **WHEN** the line is parsed
- **THEN** `input_messages` SHALL be set to the array

### Requirement: Expected output alias with shorthand support in JSONL

The JSONL parser SHALL support `expected_output` as an alias for `expected_messages` with shorthand expansion.

#### Scenario: String shorthand in JSONL
- **GIVEN** a JSONL line with:
  ```jsonl
  {"id": "test", "expected_outcome": "Goal", "input": "Query", "expected_output": "Answer"}
  ```
- **WHEN** the line is parsed
- **THEN** `expected_messages` SHALL be set to:
  ```json
  [{"role": "assistant", "content": "Answer"}]
  ```

#### Scenario: Object shorthand in JSONL
- **GIVEN** a JSONL line with:
  ```jsonl
  {"id": "test", "expected_outcome": "Goal", "input": "Query", "expected_output": {"riskLevel": "High"}}
  ```
- **WHEN** the line is parsed
- **THEN** `expected_messages` SHALL be set to:
  ```json
  [{"role": "assistant", "content": {"riskLevel": "High"}}]
  ```

#### Scenario: Array with tool calls via alias in JSONL
- **GIVEN** a JSONL line with:
  ```jsonl
  {"id": "test", "expected_outcome": "Goal", "input": "Query", "expected_output": [{"role": "assistant", "tool_calls": [{"tool": "Read"}]}]}
  ```
- **WHEN** the line is parsed
- **THEN** `expected_messages` SHALL preserve the full message array with tool calls
