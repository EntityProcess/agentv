# jsonl-dataset-format Specification (Delta)

## ADDED Requirements

### Requirement: Input field support in JSONL

The JSONL parser SHALL support `input` as the primary field name.

#### Scenario: String input in JSONL
- **GIVEN** a JSONL line with:
  ```jsonl
  {"id": "test", "expected_outcome": "Goal", "input": "What is 2+2?"}
  ```
- **WHEN** the line is parsed
- **THEN** `input` SHALL be converted to message array:
  ```json
  [{"role": "user", "content": "What is 2+2?"}]
  ```

#### Scenario: Array input in JSONL
- **GIVEN** a JSONL line with:
  ```jsonl
  {"id": "test", "expected_outcome": "Goal", "input": [{"role": "user", "content": "Query"}]}
  ```
- **WHEN** the line is parsed
- **THEN** `input` SHALL preserve the message array

#### Scenario: input_messages alias in JSONL
- **GIVEN** a JSONL line with:
  ```jsonl
  {"id": "test", "expected_outcome": "Goal", "input_messages": [{"role": "user", "content": "Query"}]}
  ```
- **WHEN** the line is parsed
- **THEN** the eval case SHALL have input populated from `input_messages`

### Requirement: Expected output field support in JSONL

The JSONL parser SHALL support `expected_output` as the primary field name.

#### Scenario: String expected_output in JSONL
- **GIVEN** a JSONL line with:
  ```jsonl
  {"id": "test", "expected_outcome": "Goal", "input": "Query", "expected_output": "Answer"}
  ```
- **WHEN** the line is parsed
- **THEN** `expected_output` SHALL be converted to message array:
  ```json
  [{"role": "assistant", "content": "Answer"}]
  ```

#### Scenario: Object expected_output in JSONL
- **GIVEN** a JSONL line with:
  ```jsonl
  {"id": "test", "expected_outcome": "Goal", "input": "Query", "expected_output": {"riskLevel": "High"}}
  ```
- **WHEN** the line is parsed
- **THEN** `expected_output` SHALL be converted to message array:
  ```json
  [{"role": "assistant", "content": {"riskLevel": "High"}}]
  ```

#### Scenario: Array expected_output in JSONL
- **GIVEN** a JSONL line with:
  ```jsonl
  {"id": "test", "expected_outcome": "Goal", "input": "Query", "expected_output": [{"role": "assistant", "tool_calls": [...]}]}
  ```
- **WHEN** the line is parsed
- **THEN** `expected_output` SHALL preserve the message array with tool calls

#### Scenario: expected_messages alias in JSONL
- **GIVEN** a JSONL line with:
  ```jsonl
  {"id": "test", "expected_outcome": "Goal", "input": "Query", "expected_messages": [{"role": "assistant", "content": "Answer"}]}
  ```
- **WHEN** the line is parsed
- **THEN** the eval case SHALL have expected_output populated from `expected_messages`

## MODIFIED Requirements

### Requirement: Schema Compatibility

The system SHALL produce identical `EvalCase` objects from JSONL and YAML formats.

#### Scenario: JSONL and YAML produce same EvalCase with new fields
- **GIVEN** a YAML file with:
  ```yaml
  evalcases:
    - id: test-1
      expected_outcome: Goal
      input: "Query"
      expected_output: { riskLevel: High }
  ```
- **AND** a JSONL file with:
  ```jsonl
  {"id": "test-1", "expected_outcome": "Goal", "input": "Query", "expected_output": {"riskLevel": "High"}}
  ```
- **WHEN** both files are parsed
- **THEN** both SHALL produce identical `EvalCase` objects
