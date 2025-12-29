## ADDED Requirements

### Requirement: CLI Provider JSONL batch output
When a target is configured with `provider_batching: true` and uses the `cli` provider, the system SHALL support reading a single JSONL output file containing results for multiple eval cases.

#### Scenario: Successful JSONL batch output mapping
- **WHEN** the `cli` provider is invoked in batch mode for N eval cases
- **AND** the CLI command writes `{OUTPUT_FILE}` as JSONL with one JSON object per line
- **AND** each JSON object contains an `id` field matching an `evalCase.id`
- **THEN** the system SHALL return a response for each eval case using the JSON object’s `text` value
- **AND** if the JSON object contains a `trace` array, the system SHALL attach the valid `TraceEvent` elements to the response

#### Scenario: Missing eval case result
- **WHEN** the `cli` provider is invoked in batch mode
- **AND** at least one requested `evalCase.id` does not appear as `id` in the JSONL output
- **THEN** the system SHALL fail the batch with an error that lists the missing eval case ids

#### Scenario: Invalid JSONL line
- **WHEN** the `cli` provider is invoked in batch mode
- **AND** the output file contains a line that is not valid JSON
- **THEN** the system SHALL fail the batch with an error identifying the line number

#### Scenario: Ignore invalid trace events
- **WHEN** the `cli` provider is invoked in batch mode
- **AND** a JSONL record contains a `trace` array with elements that do not conform to the `TraceEvent` schema
- **THEN** the system SHALL ignore invalid trace events
- **AND** the system SHALL preserve valid trace events

### Requirement: CLI Provider backwards-compatible output parsing
The system SHALL preserve existing `cli` provider behavior for non-batched invocation.

#### Scenario: Single JSON output
- **WHEN** the `cli` provider is invoked for a single eval case
- **AND** the output file contains a JSON object with a `text` field
- **THEN** the system SHALL return `text` as the candidate answer
- **AND** the system SHALL attach `trace` when provided as a valid `TraceEvent[]`

#### Scenario: Plain text output
- **WHEN** the `cli` provider is invoked for a single eval case
- **AND** the output file content is not valid JSON
- **THEN** the system SHALL treat the entire content as the candidate answer text
