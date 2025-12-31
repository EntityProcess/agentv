## MODIFIED Requirements

### Requirement: Code Judge Evaluator MUST be supported

The YAML schema SHALL support configuring `code_judge` evaluators.

#### Scenario: Configure code_judge with argv script

- **GIVEN** an eval case with a `code_judge` evaluator configured with argv tokens:
```yaml
evaluators:
  - name: my_code_check
    type: code_judge
    script: ["bun", "run", "validate_risk_output.ts"]
```
- **WHEN** the YAML is parsed
- **THEN** schema validation succeeds
- **AND** the evaluator configuration preserves the argv tokens exactly as provided.

#### Scenario: Reject string scripts

- **GIVEN** an eval case with a `code_judge` evaluator configured with a string:
```yaml
evaluators:
  - name: my_code_check
    type: code_judge
    script: bun run validate_risk_output.ts
```
- **WHEN** the YAML is parsed
- **THEN** schema validation fails
- **AND** the error message indicates that `script` must be an array of strings (argv tokens).

