# Validation Specification - Delta

## MODIFIED Requirements

### Requirement: File Type Detection

The system SHALL detect file types using the `$schema` field when present, but allow files without the field.

#### Scenario: Eval file detection via schema field

- **WHEN** file contains `$schema: agentv-eval-v2`
- **THEN** it is validated as an eval file using eval schema

#### Scenario: Targets file detection via schema field

- **WHEN** file contains `$schema: agentv-targets-v2.2`
- **THEN** it is validated as a targets configuration file

#### Scenario: File without schema field

- **WHEN** file is missing `$schema` field
- **THEN** file type is inferred from structure (presence of `targets` array for targets files, `evalcases` for eval files)

### Requirement: Targets File Schema Validation

The system SHALL validate targets files structure without requiring the `$schema` field.

~~#### Scenario: Schema field required~~

~~- **WHEN** targets file has `$schema: agentv-targets-v2.2`~~
~~- **THEN** validation proceeds with targets schema rules~~

#### Scenario: Targets array required

- **WHEN** targets file missing `targets` array
- **THEN** error reports missing targets array

#### Scenario: Target definition validation

- **WHEN** target missing required fields (name, provider)
- **THEN** error reports which field is missing and which target (by name or index)

#### Scenario: Provider value validation

- **WHEN** target has unknown provider
- **THEN** warning issued about unknown provider (non-fatal)

#### Scenario: Schema field is optional

- **WHEN** targets file is missing `$schema` field
- **THEN** validation proceeds without errors or warnings about the missing field

#### Scenario: Invalid schema value is ignored

- **WHEN** targets file has `$schema` with incorrect value (e.g., `agentv-eval-v2`)
- **THEN** validation proceeds based on file structure, ignoring the schema value

## REMOVED Requirements

### ~~Requirement: Missing schema field~~

~~The system SHALL detect file types using the `$schema` field.~~

~~#### Scenario: Missing schema field~~

~~- **WHEN** file missing `$schema` field~~
~~- **THEN** error reports that `$schema` field is required~~
