## ADDED Requirements

### Requirement: CLI Provider batch input bundle
When a target is configured with `provider_batching: true` and uses the `cli` provider, the system SHALL provide a batch input bundle containing all evalcases to the CLI command.

#### Scenario: Batch input bundle is generated
- **WHEN** the `cli` provider is invoked in batch mode for N evalcases
- **THEN** the system SHALL write a batch input bundle file that includes all evalcase ids and their `input_messages`

#### Scenario: Batch input bundle is passed to the command
- **WHEN** the `cli` provider is invoked in batch mode
- **THEN** the system SHALL pass the bundle file path to the CLI command via the configured placeholder mechanism

#### Scenario: Batch bundle cleanup
- **WHEN** the CLI command completes (success or failure)
- **THEN** the system SHALL delete the temporary bundle file (best-effort cleanup)
