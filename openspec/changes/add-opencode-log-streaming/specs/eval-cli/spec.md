## ADDED Requirements

### Requirement: Surface OpenCode provider log paths

The CLI SHALL surface OpenCode provider log paths when they become available.

#### Scenario: Print OpenCode log path when discovered
- **WHEN** an OpenCode provider publishes a new log entry `{ filePath, targetName, evalCaseId?, attempt? }`
- **THEN** the CLI prints the log file path in a dedicated “OpenCode logs” section
- **AND** does not print duplicate log paths more than once

#### Scenario: Continue printing progress while logs are emitted
- **WHEN** OpenCode logs are printed while eval cases are running
- **THEN** the CLI continues to print per-eval progress lines without requiring interactive cursor control
