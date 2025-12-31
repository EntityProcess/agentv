## MODIFIED Requirements

### Requirement: Custom Evaluators

The system SHALL allow external `code_judge` evaluators to score an eval case by executing a configured script and parsing a JSON result.

#### Scenario: Execute code_judge using argv (no shell)

- **GIVEN** a `code_judge` evaluator configured with argv tokens
- **WHEN** the evaluator runs
- **THEN** the system spawns the process without an intermediary shell
- **AND** writes a single JSON payload to stdin
- **AND** parses the script stdout as a JSON `EvaluationScore`.

