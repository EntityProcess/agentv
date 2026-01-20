# yaml-schema Specification (Delta)

## ADDED Requirements

### Requirement: Input alias with shorthand support

The YAML schema SHALL support `input` as an alias for `input_messages` with shorthand expansion.

#### Scenario: String shorthand for single user query
- **GIVEN** a YAML eval case with:
  ```yaml
  input: "What is 2+2?"
  ```
- **WHEN** the YAML is parsed
- **THEN** `input_messages` SHALL be set to:
  ```json
  [{"role": "user", "content": "What is 2+2?"}]
  ```

#### Scenario: Array input via alias
- **GIVEN** a YAML eval case with:
  ```yaml
  input:
    - role: system
      content: "You are a calculator"
    - role: user
      content: "What is 2+2?"
  ```
- **WHEN** the YAML is parsed
- **THEN** `input_messages` SHALL be set to the array

#### Scenario: Canonical name takes precedence
- **GIVEN** a YAML eval case with both:
  ```yaml
  input: "Alias query"
  input_messages:
    - role: user
      content: "Canonical query"
  ```
- **WHEN** the YAML is parsed
- **THEN** `input_messages` SHALL use the canonical value
- **AND** `input` alias SHALL be ignored

### Requirement: Expected output alias with shorthand support

The YAML schema SHALL support `expected_output` as an alias for `expected_messages` with shorthand expansion.

#### Scenario: String shorthand
- **GIVEN** a YAML eval case with:
  ```yaml
  expected_output: "The answer is 4"
  ```
- **WHEN** the YAML is parsed
- **THEN** `expected_messages` SHALL be set to:
  ```json
  [{"role": "assistant", "content": "The answer is 4"}]
  ```

#### Scenario: Object shorthand for structured output
- **GIVEN** a YAML eval case with:
  ```yaml
  expected_output:
    riskLevel: High
    reasoning: "Explanation"
  ```
- **WHEN** the YAML is parsed
- **THEN** `expected_messages` SHALL be set to:
  ```json
  [{"role": "assistant", "content": {"riskLevel": "High", "reasoning": "Explanation"}}]
  ```

#### Scenario: Array with tool calls via alias
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
- **THEN** `expected_messages` SHALL preserve the full message array with tool calls

#### Scenario: Canonical name takes precedence
- **GIVEN** a YAML eval case with both:
  ```yaml
  expected_output: { riskLevel: High }
  expected_messages:
    - role: assistant
      content: "Canonical answer"
  ```
- **WHEN** the YAML is parsed
- **THEN** `expected_messages` SHALL use the canonical value
- **AND** `expected_output` alias SHALL be ignored
