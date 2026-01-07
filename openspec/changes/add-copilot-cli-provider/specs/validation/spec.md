## MODIFIED Requirements

### Requirement: Targets File Schema Validation
The system SHALL validate target configuration using Zod schemas that serve as both runtime validators and TypeScript type sources.

#### Scenario: Unknown Copilot CLI provider property rejected
- **WHEN** a targets file contains a Copilot CLI target with an unrecognized property
- **THEN** the system SHALL reject the configuration with an error identifying the unknown property

#### Scenario: Copilot CLI provider accepts snake_case and camelCase settings
- **WHEN** a targets file uses `provider: copilot-cli` (or an accepted alias)
- **AND** configures supported settings using either snake_case or camelCase
- **THEN** validation succeeds
- **AND** the resolved config normalizes to camelCase
