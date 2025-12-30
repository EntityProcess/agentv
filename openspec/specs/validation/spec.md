# Validation Specification

## Purpose

Validates AgentV YAML files (eval and targets) independently from execution for fast feedback. Validates schema compliance (`$schema` field detection), file structure, and referenced file existence. Supports CI integration via exit codes.
## Requirements
### Requirement: Validate Command

The system SHALL provide a `validate` command that validates AgentV YAML configuration files.

#### Scenario: Validate single eval file

- **WHEN** user runs `agentv validate path/to/test.yaml`
- **THEN** the file is validated against eval schema and all errors are reported

#### Scenario: Validate targets file

- **WHEN** user runs `agentv validate .agentv/targets.yaml`
- **THEN** the file is validated against targets schema and all errors are reported

#### Scenario: Validate entire directory

- **WHEN** user runs `agentv validate ./evals`
- **THEN** all YAML files in the directory (recursive) are validated based on their `$schema` field and results aggregated

#### Scenario: Multiple paths

- **WHEN** user runs `agentv validate file1.yaml file2.yaml targets.yaml`
- **THEN** each file is validated in order and all errors are collected

#### Scenario: Exit code on failure

- **WHEN** validate command finds validation errors
- **THEN** it exits with non-zero exit code for CI integration

#### Scenario: Exit code on success

- **WHEN** all validated files pass validation
- **THEN** it exits with zero exit code

### Requirement: Eval File Schema Validation

The system SHALL validate eval files against the v2 schema.

#### Scenario: Schema field required

- **WHEN** eval file has `$schema: agentv-eval-v2`
- **THEN** validation proceeds with eval schema rules

#### Scenario: Evalcases field required

- **WHEN** eval file missing `evalcases` array
- **THEN** error reports missing evalcases field

#### Scenario: Eval case structure validation

- **WHEN** eval case missing required fields (id, outcome, input_messages, expected_messages)
- **THEN** error reports which field is missing and in which case (by id or index)

#### Scenario: Message role validation

- **WHEN** message has invalid role (not system/user/assistant/tool)
- **THEN** error reports invalid role value

#### Scenario: Content format validation

- **WHEN** message content is not string or array of content blocks
- **THEN** error reports invalid content format

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

### Requirement: File Reference Validation

The system SHALL validate that file URLs referenced in eval files exist.

#### Scenario: Instruction file exists

- **WHEN** eval file references `value: ../prompts/javascript.instructions.md`
- **THEN** linter verifies file exists relative to eval file directory

#### Scenario: Instruction file not found

- **WHEN** referenced file does not exist
- **THEN** error reports missing file with full resolved path

#### Scenario: File reference in content array

- **WHEN** content block has `type: file` and `value` field
- **THEN** validator validates the file exists

#### Scenario: Relative path resolution

- **WHEN** file reference is relative (e.g., `../prompts/file.md`)
- **THEN** path is resolved relative to the eval file's directory

#### Scenario: Empty file warning

- **WHEN** referenced file exists but is empty
- **THEN** warning is issued about empty file

### Requirement: Error Reporting

The system SHALL provide clear, actionable error messages.

#### Scenario: Error includes file path

- **WHEN** validation error occurs
- **THEN** error message includes full file path

#### Scenario: Error includes location context

- **WHEN** error is in specific eval case or target
- **THEN** error message includes case id or target name

#### Scenario: Multiple errors reported together

- **WHEN** file has multiple validation errors
- **THEN** all errors are collected and reported in single pass

#### Scenario: Summary statistics

- **WHEN** validation completes
- **THEN** summary shows total files checked, passed, failed

### Requirement: Output Formatting

The system SHALL format validation output for developer readability.

#### Scenario: Colorized terminal output

- **WHEN** running in interactive terminal
- **THEN** errors are red, warnings yellow, success green

#### Scenario: Plain output for CI

- **WHEN** stdout is not a TTY
- **THEN** output is plain text without ANSI codes

### Requirement: Performance

The system SHALL validate files efficiently for large codebases.

#### Scenario: Parallel validation

- **WHEN** validating directory with many files
- **THEN** files are validated in parallel up to CPU core count

#### Scenario: Early exit on critical error

- **WHEN** file cannot be parsed as YAML
- **THEN** validation stops for that file and reports parse error

#### Scenario: Fast feedback

- **WHEN** validating 100 eval files
- **THEN** validation completes in under 5 seconds on modern hardware

### Requirement: Custom Evaluator Template Validation

The system SHALL validate custom LLM judge evaluator templates to ensure they contain fields necessary for evaluation.

#### Scenario: Template missing both required fields shows warning

**Given** a custom evaluator template with content `"{{ question }}"`
**When** the template is loaded
**Then** a warning is displayed containing:
- Message: "Custom evaluator template at [source] is missing required fields"
- List of required fields: `{{ candidate_answer }}` and `{{ expected_messages }}`
- Explanation: "Without these, there is nothing to evaluate against"

#### Scenario: Template with candidate_answer does not warn

**Given** a custom evaluator template containing `"{{ candidate_answer }}"`
**When** the template is loaded
**Then** no validation warning is displayed

#### Scenario: Template with expected_messages does not warn

**Given** a custom evaluator template containing `"{{ expected_messages }}"`
**When** the template is loaded
**Then** no validation warning is displayed

#### Scenario: Validation applies to file-based prompts

**Given** an evaluator configured with `promptPath: "./my-eval.md"`
**And** the file contains only `"{{ question }}"`
**When** the custom prompt is resolved
**Then** a warning is displayed referencing the file path

#### Scenario: Invalid template variables are detected

**Given** a custom evaluator template containing `"{{ candiate_answer }} for {{ invalid_var }}"`
**When** validation runs
**Then** a warning is displayed listing the invalid variables
**And** the warning lists all valid template variables

#### Scenario: Validation is permissive

**Given** a custom evaluator template missing required fields
**When** validation runs
**Then** a warning is displayed
**But** evaluation continues without blocking

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

