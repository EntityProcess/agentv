## MODIFIED Requirements

### Requirement: Code judge scripts MUST use argv arrays

The YAML schema SHALL accept `code_judge` evaluators with `script` defined as an array of argv tokens.

The YAML schema SHALL also accept the following optional fields on `code_judge` evaluators:
- `use_judge?: boolean`
- `judge?: { max_calls?: number }`

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
      use_judge: true
      judge:
        max_calls: 25
  ```
- **WHEN** the YAML is parsed
- **THEN** schema validation succeeds

#### Scenario: Reject invalid max_calls
- **GIVEN** a YAML eval case with:
  ```yaml
  evaluators:
    - name: bad_config
      type: code_judge
      script: ["bun", "run", "x.ts"]
      use_judge: true
      judge:
        max_calls: -1
  ```
- **WHEN** the YAML is parsed
- **THEN** schema validation SHALL fail
- **AND** the error message SHALL mention that `max_calls` must be >= 0
