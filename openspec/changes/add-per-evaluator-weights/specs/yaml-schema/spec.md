## ADDED Requirements

### Requirement: Per-evaluator weight MUST be supported

The YAML schema SHALL support an optional `weight` field on each entry in an eval case `evaluators` list.

- `weight` MUST be a finite number.
- `weight` MUST be greater than or equal to `0`.
- If omitted, `weight` defaults to `1.0`.

#### Scenario: Parse evaluator weight
- **GIVEN** a YAML eval case with:
  ```yaml
  evaluators:
    - name: safety
      type: llm_judge
      weight: 3
  ```
- **WHEN** the YAML is parsed
- **THEN** the evaluator configuration includes `weight: 3`

#### Scenario: Reject negative weight
- **GIVEN** a YAML eval case with:
  ```yaml
  evaluators:
    - name: safety
      type: llm_judge
      weight: -1
  ```
- **WHEN** the YAML is parsed
- **THEN** schema validation SHALL fail
- **AND** the error message SHALL mention that `weight` must be `>= 0`

#### Scenario: Reject non-numeric weight
- **GIVEN** a YAML eval case with:
  ```yaml
  evaluators:
    - name: safety
      type: llm_judge
      weight: high
  ```
- **WHEN** the YAML is parsed
- **THEN** schema validation SHALL fail
