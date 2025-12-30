# validation Specification Delta

## MODIFIED Requirements

### Requirement: Targets File Schema Validation

The system SHALL validate target configuration using Zod schemas that serve as both runtime validators and TypeScript type sources.

#### Scenario: Unknown CLI provider property rejected

- **WHEN** a targets file contains a CLI provider target with an unrecognized property (e.g., `keep_temp_file` instead of `keep_temp_files`)
- **THEN** the system SHALL reject the configuration with an error identifying the unknown property

#### Scenario: Valid CLI provider property accepted

- **WHEN** a targets file contains a CLI provider target with `keep_temp_files: true`
- **THEN** the system SHALL accept the configuration without warnings
- **AND** the property SHALL be available in the resolved config

#### Scenario: Snake_case and camelCase equivalence

- **WHEN** a targets file uses `keep_temp_files` (snake_case)
- **OR** uses `keepTempFiles` (camelCase)
- **THEN** both SHALL be accepted as equivalent
- **AND** the resolved config SHALL normalize to camelCase

#### Scenario: Schema-based validation error messages

- **WHEN** a CLI provider target has invalid property types (e.g., `verbose: "yes"` instead of `verbose: true`)
- **THEN** the system SHALL provide a Zod validation error
- **AND** the error SHALL indicate the expected type
- **AND** the error SHALL indicate the location (file path and property path)

#### Scenario: Nested schema validation

- **WHEN** a CLI provider target includes a `healthcheck` object
- **AND** the healthcheck has invalid structure (e.g., `type: "http"` but missing `url`)
- **THEN** the system SHALL reject with a validation error
- **AND** the error SHALL identify the missing required field within the healthcheck

## REMOVED Requirements

### Requirement: Manual unknown property validation

The system no longer requires manual `validateUnknownSettings()` function for CLI provider configurations. Zod `.strict()` schemas handle unknown property rejection automatically.

## ADDED Requirements

### Requirement: Schema export for extensibility

The system SHALL export Zod schemas to enable external tools and plugins to validate configurations.

#### Scenario: External tool imports schemas

- **WHEN** an external tool imports `CliTargetConfigSchema` from `@agentv/core`
- **THEN** the tool SHALL be able to validate CLI target configurations independently
- **AND** validation SHALL use the same rules as the core AgentV CLI

#### Scenario: Schema introspection

- **WHEN** a tool needs to discover available CLI provider properties
- **THEN** it SHALL be able to introspect the Zod schema shape
- **AND** extract property names, types, and descriptions

### Requirement: Configuration normalization

The system SHALL normalize target configurations from snake_case to camelCase after initial validation.

#### Scenario: Input normalization

- **GIVEN** a CLI target with properties in snake_case: `{ command_template: "...", keep_temp_files: true }`
- **WHEN** the configuration is resolved
- **THEN** the output SHALL use camelCase: `{ commandTemplate: "...", keepTempFiles: true }`
- **AND** the TypeScript type SHALL enforce camelCase property names

#### Scenario: Mixed case input

- **GIVEN** a CLI target with mixed naming: `{ command_template: "...", keepTempFiles: true }`
- **WHEN** the configuration is resolved
- **THEN** both properties SHALL be accepted
- **AND** snake_case SHALL take precedence over camelCase when both are present (matching YAML convention)
