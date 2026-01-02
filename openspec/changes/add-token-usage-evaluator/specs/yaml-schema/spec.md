## ADDED Requirements

### Requirement: Token usage evaluator MUST be supported

The YAML schema SHALL support configuring a token usage evaluator that can gate on provider-reported token usage.

#### Scenario: Configure token_usage with max_total
- **GIVEN** a YAML eval case with a `token_usage` evaluator:
  ```yaml
  evaluators:
    - name: token-budget
      type: token_usage
      max_total: 10000
  ```
- **WHEN** the YAML is parsed
- **THEN** the eval case SHALL include a `token_usage` evaluator configuration
- **AND** the configuration SHALL preserve `max_total`

#### Scenario: Configure token_usage with input/output limits
- **GIVEN** a YAML eval case with:
  ```yaml
  evaluators:
    - name: token-budget
      type: token_usage
      max_input: 8000
      max_output: 2000
  ```
- **WHEN** the YAML is parsed
- **THEN** the eval case SHALL include a `token_usage` evaluator configuration
- **AND** the configuration SHALL preserve both limits

#### Scenario: Reject invalid limits
- **GIVEN** a YAML eval case with:
  ```yaml
  evaluators:
    - name: token-budget
      type: token_usage
      max_total: -1
  ```
- **WHEN** the YAML is parsed
- **THEN** schema validation SHALL fail
- **AND** the error message SHALL mention that limits must be non-negative numbers

