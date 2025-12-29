# Evaluation Spec Delta

## ADDED Requirements

### Requirement: Extract traces from output messages

The system SHALL extract trace events from provider `output_messages` when no explicit `trace` is provided.

#### Scenario: Provider returns output messages with tool calls
- **WHEN** a provider invocation completes successfully
- **AND** the provider response includes `output_messages` with `tool_calls`
- **AND** the provider response does NOT include an explicit `trace` field
- **THEN** the system extracts `TraceEvent[]` from `output_messages[].tool_calls[]`
- **AND** computes a `trace_summary` with tool call counts and names
- **AND** makes `candidate_trace` and `candidate_trace_summary` available to evaluators

#### Scenario: Output messages without tool calls
- **WHEN** a provider invocation completes successfully
- **AND** the provider response includes `output_messages` without any `tool_calls`
- **THEN** the system extracts an empty trace
- **AND** `candidate_trace` is an empty array
- **AND** `candidate_trace_summary` shows zero tool calls

#### Scenario: Trace extraction maps tool call fields
- **WHEN** extracting traces from `output_messages`
- **THEN** each `tool_calls[]` entry maps to a `TraceEvent` with:
  - `type: 'tool_call'`
  - `name` from `tool_calls[].tool`
  - `input` from `tool_calls[].input`
  - `output` from `tool_calls[].output`
  - `timestamp` generated for the event
- **AND** preserves tool call sequence from array order

#### Scenario: Explicit trace takes precedence
- **WHEN** a provider response includes both `trace` and `output_messages`
- **THEN** the system uses the explicit `trace` field
- **AND** ignores `output_messages` for trace extraction

## MODIFIED Requirements

### Requirement: Test Case Execution

The system SHALL capture provider traces from explicit `trace`, `traceRef`, or `output_messages` fields.

#### Scenario: Provider returns a trace
- **WHEN** a provider invocation completes successfully
- **AND** the provider response includes a trace payload (from `trace`, `traceRef`, or `output_messages`)
- **THEN** the system captures the trace for that eval case attempt
- **AND** computes a `trace_summary` with `eventCount`, `toolNames`, `toolCallsByName`, and `errorCount`
- **AND** makes `candidate_trace` and `candidate_trace_summary` available to evaluators
