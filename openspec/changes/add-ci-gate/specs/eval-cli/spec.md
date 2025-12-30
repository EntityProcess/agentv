## ADDED Requirements

### Requirement: CI Gate Threshold Flag

The CLI SHALL accept a `--fail-below <score>` flag to enable quality gate checking.

#### Scenario: Threshold flag accepted

- **WHEN** user runs `agentv eval evals/*.yaml --fail-below 0.8`
- **THEN** the CLI accepts the flag and stores 0.8 as the threshold
- **AND** enables CI gate mode for the evaluation run

#### Scenario: Threshold validation rejects invalid values

- **WHEN** user runs `agentv eval --fail-below 1.5` (value > 1.0)
- **THEN** the CLI prints "Error: --fail-below must be between 0.0 and 1.0"
- **AND** exits with code 1 before running any evaluations

#### Scenario: Threshold validation rejects negative values

- **WHEN** user runs `agentv eval --fail-below -0.1` (value < 0.0)
- **THEN** the CLI prints "Error: --fail-below must be between 0.0 and 1.0"
- **AND** exits with code 1 before running any evaluations

### Requirement: CI Gate Error Detection

The CLI SHALL exit with code 1 when any eval case contains an error, because errors invalidate the aggregate score (the score is computed from fewer cases than intended).

#### Scenario: Exit 1 when any eval case errors

- **WHEN** `agentv eval` completes
- **AND** at least one eval result contains an `error` field (non-null)
- **AND** the `--allow-errors` flag is NOT set
- **THEN** the CLI prints "CI GATE FAILED: {N} eval case(s) errored - score is invalid"
- **AND** exits with code 1

#### Scenario: Allow errors with explicit opt-in flag

- **WHEN** `agentv eval` is run with `--allow-errors`
- **AND** at least one eval result contains an `error` field
- **THEN** the CLI prints "Warning: {N} eval case(s) errored - continuing due to --allow-errors"
- **AND** continues to threshold checking (if `--fail-below` is set)
- **AND** computes aggregate score from non-errored cases only

### Requirement: CI Gate Score Threshold

The CLI SHALL compare the aggregate score against the threshold when `--fail-below` is provided.

#### Scenario: Exit 1 when score below threshold

- **WHEN** `agentv eval` completes with `--fail-below 0.8`
- **AND** no eval cases errored (or `--allow-errors` is set)
- **AND** the aggregate score (mean of all case scores) is 0.72
- **THEN** the CLI prints "CI GATE FAILED: Score 0.72 < threshold 0.80"
- **AND** exits with code 1

#### Scenario: Exit 0 when score meets threshold exactly

- **WHEN** `agentv eval` completes with `--fail-below 0.8`
- **AND** no eval cases errored
- **AND** the aggregate score is exactly 0.80
- **THEN** the CLI prints "CI GATE PASSED: Score 0.80 >= threshold 0.80"
- **AND** exits with code 0

#### Scenario: Exit 0 when score exceeds threshold

- **WHEN** `agentv eval` completes with `--fail-below 0.8`
- **AND** no eval cases errored
- **AND** the aggregate score is 0.92
- **THEN** the CLI prints "CI GATE PASSED: Score 0.92 >= threshold 0.80"
- **AND** exits with code 0

### Requirement: Backward Compatibility

The CLI SHALL preserve current exit behavior when no CI gate flags are provided.

#### Scenario: Exit 0 when no gate flags and no errors

- **WHEN** `agentv eval` completes without `--fail-below` flag
- **AND** no eval cases errored
- **THEN** the CLI exits with code 0
- **AND** does NOT print any CI gate messages

#### Scenario: Exit 1 when errors present even without threshold flag

- **WHEN** `agentv eval` completes without `--fail-below` flag
- **AND** at least one eval case errored
- **AND** `--allow-errors` is NOT set
- **THEN** the CLI prints "CI GATE FAILED: {N} eval case(s) errored - score is invalid"
- **AND** exits with code 1

### Requirement: Gate Summary Output

The CLI SHALL print a clear gate result summary when CI gate mode is active.

#### Scenario: Gate summary appears after evaluation summary

- **WHEN** `agentv eval` completes with `--fail-below` flag
- **THEN** the gate result message appears AFTER the standard evaluation statistics summary
- **AND** the message clearly indicates PASSED or FAILED
- **AND** includes the actual score and threshold values
