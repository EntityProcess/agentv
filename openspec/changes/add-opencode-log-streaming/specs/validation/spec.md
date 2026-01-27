## ADDED Requirements

### Requirement: Validate OpenCode targets

The system SHALL validate OpenCode provider targets in `targets.yaml` using Zod schemas, rejecting unknown properties and accepting both snake_case and camelCase forms.

#### Scenario: Accept a valid OpenCode target
- **WHEN** a targets file contains a target with `provider: opencode`
- **THEN** the configuration is accepted
- **AND** the resolved config normalizes to camelCase

#### Scenario: Reject unknown OpenCode target properties
- **WHEN** an OpenCode target contains an unrecognized property (e.g., `streamlog_dir` instead of `stream_log_dir`)
- **THEN** validation fails with an error identifying the unknown property path

#### Scenario: Accept snake_case and camelCase equivalence for OpenCode settings
- **WHEN** an OpenCode target uses `stream_logs` (snake_case)
- **OR** uses `streamLogs` (camelCase)
- **THEN** both are accepted as equivalent
- **AND** the resolved config normalizes to `streamLogs`
