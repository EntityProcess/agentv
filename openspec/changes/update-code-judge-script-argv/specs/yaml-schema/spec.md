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

#### Scenario: Convert string scripts for backward compatibility

- **GIVEN** an eval case with a `code_judge` evaluator configured with a string:
```yaml
evaluators:
  - name: my_code_check
    type: code_judge
    script: bun run validate_risk_output.ts
```
- **WHEN** the YAML is parsed
- **THEN** schema validation succeeds
- **AND** the system converts the string to a shell argv appropriate for the current platform.

#### Scenario: Forbid implicit shell execution

- **GIVEN** an eval case with a `code_judge` evaluator
- **WHEN** the YAML is parsed
- **THEN** there is no schema-supported flag that enables implicit `shell: true` execution
- **AND** shell usage (if desired) requires the user to explicitly invoke a shell in argv tokens (e.g., `["cmd.exe", "/c", "..."]` or `["sh", "-lc", "..."]`).
