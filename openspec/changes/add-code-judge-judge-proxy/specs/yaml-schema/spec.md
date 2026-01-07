## MODIFIED Requirements

### Requirement: Code judge scripts MUST use argv arrays

The YAML schema SHALL accept `code_judge` evaluators with `script` defined as an array of argv tokens.

The YAML schema SHALL also accept the following optional field on `code_judge` evaluators:
- `judge?: { max_calls?: number }` — presence enables judge proxy access

#### Scenario: Configure code_judge with argv script
- **GIVEN** a YAML eval case with:
  ```yaml
  evaluators:
    - name: my_code_check
      type: code_judge
      script: ["bun", "run", "validate_risk_output.ts"]
  ```
- **WHEN** the YAML is parsed
- **THEN** schema validation succeeds
- **AND** the evaluator configuration preserves the argv tokens.

#### Scenario: Enable judge access for code_judge
- **GIVEN** a YAML eval case with:
  ```yaml
  evaluators:
    - name: contextual_precision
      type: code_judge
      script: ["bun", "run", "contextual-precision.ts"]
      judge:
        max_calls: 25
  ```
- **WHEN** the YAML is parsed
- **THEN** schema validation succeeds

#### Scenario: Enable judge access with defaults
- **GIVEN** a YAML eval case with:
  ```yaml
  evaluators:
    - name: simple_judge
      type: code_judge
      script: ["bun", "run", "check.ts"]
      judge: {}
  ```
- **WHEN** the YAML is parsed
- **THEN** schema validation succeeds
- **AND** judge proxy is enabled with default settings

#### Scenario: Reject invalid max_calls
- **GIVEN** a YAML eval case with:
  ```yaml
  evaluators:
    - name: bad_config
      type: code_judge
      script: ["bun", "run", "x.ts"]
      judge:
        max_calls: -1
  ```
- **WHEN** the YAML is parsed
- **THEN** schema validation SHALL fail
- **AND** the error message SHALL mention that `max_calls` must be >= 0
