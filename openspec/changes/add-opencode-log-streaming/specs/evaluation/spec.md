## ADDED Requirements

### Requirement: OpenCode provider log streaming artifacts

When an OpenCode-based provider run is executed, the system SHALL support writing a per-run stream log file and surfacing its path for debugging.

#### Scenario: Provider creates an OpenCode stream log file
- **WHEN** a provider run begins for an OpenCode-backed target
- **THEN** the provider writes a log file under `.agentv/logs/opencode/` by default (or a configured override)
- **AND** the provider appends progress entries as the agent executes

#### Scenario: Provider disables OpenCode stream logging
- **WHEN** OpenCode stream logging is disabled via configuration or environment
- **THEN** the provider does not create a log file
- **AND** evaluation continues normally

#### Scenario: Provider cannot create the OpenCode log directory
- **WHEN** the provider cannot create the configured log directory (permissions, invalid path)
- **THEN** the provider continues without stream logs
- **AND** emits a warning in verbose mode only

### Requirement: OpenCode log path publication

The system SHALL provide a mechanism to publish OpenCode log file paths so the CLI can present them to the user as soon as they are created.

#### Scenario: Publish OpenCode log path at run start
- **WHEN** the provider decides on a log file path for an OpenCode run
- **THEN** it publishes `{ filePath, targetName, evalCaseId?, attempt? }` to a process-local log tracker
- **AND** downstream consumers MAY subscribe to this tracker to display the log path
