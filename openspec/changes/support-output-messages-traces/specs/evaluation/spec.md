# Evaluation Spec Delta

## ADDED Requirements

### Requirement: Extract traces from output messages

The system SHALL extract trace events from provider `outputMessages` when no explicit `trace` is provided.

#### Scenario: Provider returns output messages with tool calls
- **WHEN** a provider invocation completes successfully
- **AND** the provider response includes `outputMessages` with `toolCalls`
- **AND** the provider response does NOT include an explicit `trace` field
- **THEN** the system extracts `TraceEvent[]` from `outputMessages[].toolCalls[]`
- **AND** computes a `trace_summary` with tool call counts and names
- **AND** makes `candidate_trace` and `candidate_trace_summary` available to evaluators

#### Scenario: Output messages without tool calls
- **WHEN** a provider invocation completes successfully
- **AND** the provider response includes `outputMessages` without any `toolCalls`
- **THEN** the system extracts an empty trace
- **AND** `candidate_trace` is an empty array
- **AND** `candidate_trace_summary` shows zero tool calls

#### Scenario: Trace extraction maps tool call fields
- **WHEN** extracting traces from `outputMessages`
- **THEN** each `toolCalls[]` entry maps to a `TraceEvent` with:
  - `type: 'tool_call'`
  - `name` from `toolCalls[].tool`
  - `input` from `toolCalls[].input`
  - `output` from `toolCalls[].output`
  - `timestamp` from source message if available (optional field)
- **AND** preserves tool call sequence from array order

#### Scenario: Explicit trace takes precedence
- **WHEN** a provider response includes both `trace` and `outputMessages`
- **THEN** the system uses the explicit `trace` field
- **AND** ignores `outputMessages` for trace extraction

## MODIFIED Requirements

### Requirement: Test Case Execution

The system SHALL capture provider traces from explicit `trace`, `traceRef`, or `outputMessages` fields.

#### Scenario: Provider returns a trace
- **WHEN** a provider invocation completes successfully
- **AND** the provider response includes a trace payload (from `trace`, `traceRef`, or `outputMessages`)
- **THEN** the system captures the trace for that eval case attempt
- **AND** computes a `trace_summary` with `eventCount`, `toolNames`, `toolCallsByName`, and `errorCount`
- **AND** makes `candidate_trace` and `candidate_trace_summary` available to evaluators

### Requirement: TraceEvent timestamp is optional

The `TraceEvent.timestamp` field SHALL be optional to support trace extraction from sources that don't provide timestamps.

#### Scenario: TraceEvent without timestamp
- **WHEN** a `TraceEvent` is created without a `timestamp` field
- **THEN** the event is valid and can be used for evaluation
- **AND** trace ordering is determined by array position, not timestamp
