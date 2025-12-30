## ADDED Requirements

### Requirement: CI Gate Exit Codes

The CLI SHALL support quality gates for CI/CD pipelines via exit codes and threshold flags.

#### Scenario: Exit 1 when any eval case errors (default)

- **WHEN** `agentv eval` completes
- **AND** any eval result contains an `error` field
- **THEN** the CLI exits with code 1
- **AND** prints a summary indicating the error count and that the score is invalid

#### Scenario: Allow errors with explicit flag

- **WHEN** `agentv eval` is run with `--allow-errors`
- **AND** any eval result contains an `error` field
- **THEN** the CLI continues with threshold checking (if `--fail-below` is set)
- **AND** prints a warning that errors were ignored

#### Scenario: Exit 1 when score below threshold

- **WHEN** `agentv eval` is run with `--fail-below <score>`
- **AND** no eval cases errored (or `--allow-errors` is set)
- **AND** the aggregate score is less than `<score>`
- **THEN** the CLI exits with code 1
- **AND** prints a summary showing actual score vs threshold

#### Scenario: Exit 0 when score meets threshold

- **WHEN** `agentv eval` is run with `--fail-below <score>`
- **AND** no eval cases errored (or `--allow-errors` is set)
- **AND** the aggregate score is greater than or equal to `<score>`
- **THEN** the CLI exits with code 0
- **AND** prints a summary confirming the gate passed

#### Scenario: Exit 0 when no gate flags provided and no errors

- **WHEN** `agentv eval` completes without `--fail-below`
- **AND** no eval cases errored
- **THEN** the CLI exits with code 0 (preserving current behavior for non-CI usage)

#### Scenario: Threshold validation

- **WHEN** `--fail-below` is provided with a value outside 0.0-1.0
- **THEN** the CLI prints an error and exits with code 1 before running evaluations
