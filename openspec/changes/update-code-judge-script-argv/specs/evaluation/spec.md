## MODIFIED Requirements

### Requirement: Custom Evaluators

The system SHALL allow external `code_judge` evaluators to score an eval case by executing a configured script and parsing a JSON result.

#### Scenario: Execute code_judge using argv (no shell)

- **GIVEN** a `code_judge` evaluator configured with argv tokens
- **WHEN** the evaluator runs
- **THEN** the system spawns the process without an intermediary shell
- **AND** writes a single JSON payload to stdin
- **AND** parses the script stdout as a JSON `EvaluationScore`.

#### Scenario: Non-zero exit surfaces stderr + exit code

- **GIVEN** a `code_judge` evaluator configured with argv tokens
- **AND** the script writes a diagnostic message to stderr and exits non-zero
- **WHEN** the evaluator runs
- **THEN** the evaluation fails deterministically
- **AND** the error message includes the script exit code
- **AND** the error message includes captured stderr (or a truncated tail for large stderr).

#### Scenario: Large stdin payload is delivered intact

- **GIVEN** a `code_judge` evaluator configured with argv tokens
- **AND** the evaluator input payload written to stdin exceeds 1MB
- **WHEN** the evaluator runs
- **THEN** the script receives the complete stdin payload
- **AND** the system captures stdout and parses the JSON result.

#### Scenario: Timeout terminates a hung evaluator

- **GIVEN** a `code_judge` evaluator configured with argv tokens
- **AND** the script does not terminate within the configured timeout
- **WHEN** the evaluator runs
- **THEN** the system terminates the subprocess
- **AND** the evaluation fails with a timeout-specific error message.
