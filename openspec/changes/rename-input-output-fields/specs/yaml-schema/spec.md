# yaml-schema Specification (Delta)

## ADDED Requirements

### Requirement: Input field with shorthand support

The YAML schema SHALL support `input` as the primary field name for eval case input.

#### Scenario: String shorthand for single user query
- **GIVEN** a YAML eval case with:
  ```yaml
  input: "What is 2+2?"
  ```
- **WHEN** the YAML is parsed
- **THEN** the eval case SHALL have input as an array:
  ```json
  [{"role": "user", "content": "What is 2+2?"}]
  ```

#### Scenario: Full message array
- **GIVEN** a YAML eval case with:
  ```yaml
  input:
    - role: system
      content: "You are a calculator"
    - role: user
      content: "What is 2+2?"
  ```
- **WHEN** the YAML is parsed
- **THEN** the eval case SHALL preserve the full message array

#### Scenario: input_messages alias
- **GIVEN** a YAML eval case with:
  ```yaml
  input_messages:
    - role: user
      content: "Query"
  ```
- **WHEN** the YAML is parsed
- **THEN** the eval case SHALL have input populated from `input_messages`
- **AND** a deprecation warning MAY be logged

### Requirement: Expected output field with flexible format

The YAML schema SHALL support `expected_output` as the primary field name for expected results.

#### Scenario: String shorthand
- **GIVEN** a YAML eval case with:
  ```yaml
  expected_output: "The answer is 4"
  ```
- **WHEN** the YAML is parsed
- **THEN** the eval case SHALL have expected_output as:
  ```json
  [{"role": "assistant", "content": "The answer is 4"}]
  ```

#### Scenario: Structured object
- **GIVEN** a YAML eval case with:
  ```yaml
  expected_output:
    riskLevel: High
    reasoning: "Explanation"
  ```
- **WHEN** the YAML is parsed
- **THEN** the eval case SHALL have expected_output as:
  ```json
  [{"role": "assistant", "content": {"riskLevel": "High", "reasoning": "Explanation"}}]
  ```

#### Scenario: Full message array with tool calls
- **GIVEN** a YAML eval case with:
  ```yaml
  expected_output:
    - role: assistant
      tool_calls:
        - tool: Read
          input: { file_path: "config.json" }
    - role: assistant
      content: { status: "done" }
  ```
- **WHEN** the YAML is parsed
- **THEN** the eval case SHALL preserve the full message array with tool calls

#### Scenario: expected_messages alias
- **GIVEN** a YAML eval case with:
  ```yaml
  expected_messages:
    - role: assistant
      content: "Answer"
  ```
- **WHEN** the YAML is parsed
- **THEN** the eval case SHALL have expected_output populated from `expected_messages`
- **AND** a deprecation warning MAY be logged

### Requirement: New field takes precedence over alias

The YAML schema SHALL prefer new field names over deprecated aliases when both are present.

#### Scenario: Both input and input_messages specified
- **GIVEN** a YAML eval case with:
  ```yaml
  input: "New query"
  input_messages:
    - role: user
      content: "Old query"
  ```
- **WHEN** the YAML is parsed
- **THEN** the eval case SHALL use `input: "New query"`
- **AND** `input_messages` SHALL be ignored

#### Scenario: Both expected_output and expected_messages specified
- **GIVEN** a YAML eval case with:
  ```yaml
  expected_output: { riskLevel: High }
  expected_messages:
    - role: assistant
      content: "Old answer"
  ```
- **WHEN** the YAML is parsed
- **THEN** the eval case SHALL use `expected_output`
- **AND** `expected_messages` SHALL be ignored
