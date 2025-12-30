# CLI Provider Spec Delta

## ADDED Requirements

### Requirement: CLI Provider supports output messages format

The system SHALL accept `output_messages` field in JSONL records (snake_case wire format) and convert to `outputMessages` (camelCase) in the provider response.

#### Scenario: JSONL record with output_messages
- **WHEN** the `cli` provider is invoked in batch mode
- **AND** a JSONL record contains an `output_messages` field with an array of message objects
- **AND** each message object may contain `role`, `name`, `content`, and `tool_calls` fields (snake_case)
- **THEN** the system SHALL parse the `output_messages` array
- **AND** convert `tool_calls` to `toolCalls` (camelCase)
- **AND** attach as `outputMessages` to the `ProviderResponse`
- **AND** preserve the structure for downstream trace extraction

#### Scenario: Output messages with tool calls
- **WHEN** parsing a JSONL record with `output_messages`
- **AND** a message object contains a `tool_calls` array
- **THEN** the system SHALL convert to `toolCalls` (camelCase)
- **AND** preserve each tool call entry with `tool`, `input`, and `output` fields
- **AND** maintain array order for sequence-dependent evaluation

#### Scenario: Single case output with output_messages
- **WHEN** the `cli` provider is invoked for a single eval case
- **AND** the output file contains a JSON object with `text` and `output_messages` fields
- **THEN** the system SHALL return `text` as the candidate answer
- **AND** convert and attach as `outputMessages` to the `ProviderResponse`

#### Scenario: Backward compatibility with trace field
- **WHEN** a JSONL record contains both `trace` and `output_messages`
- **THEN** the system SHALL preserve both fields in the response (as `trace` and `outputMessages`)
- **AND** let the orchestrator decide which to use for trace extraction
