# Spec: Observability Capability

## Purpose

Defines trace export functionality for sending AgentV evaluation data to external observability platforms. Enables debugging, monitoring, and analysis of agent execution through industry-standard tooling.

## ADDED Requirements

### Requirement: Langfuse Trace Export

The system SHALL support exporting evaluation traces to Langfuse when enabled via CLI flag.

#### Scenario: Export enabled with valid credentials

- **WHEN** the user runs `agentv run eval.yaml --langfuse`
- **AND** `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` environment variables are set
- **THEN** the system creates a Langfuse trace for each completed eval case
- **AND** the trace includes the `eval_id` as the trace name
- **AND** the trace includes metadata for `target`, `dataset`, and `score`

#### Scenario: Export disabled by default

- **WHEN** the user runs `agentv run eval.yaml` without `--langfuse` flag
- **THEN** no traces are sent to Langfuse
- **AND** the evaluation proceeds normally without observability overhead

#### Scenario: Missing credentials with flag enabled

- **WHEN** the user runs `agentv run eval.yaml --langfuse`
- **AND** `LANGFUSE_PUBLIC_KEY` or `LANGFUSE_SECRET_KEY` is not set
- **THEN** the system emits a warning message
- **AND** evaluation proceeds without Langfuse export

### Requirement: OutputMessage to Trace Mapping

The system SHALL convert `output_messages` to Langfuse-compatible trace structure.

#### Scenario: Assistant message becomes Generation

- **WHEN** an `OutputMessage` has `role: "assistant"` and `content`
- **THEN** a Langfuse Generation is created with the content as output
- **AND** the Generation includes `gen_ai.request.model` if available from target

#### Scenario: Tool call becomes Span

- **WHEN** an `OutputMessage` contains `toolCalls` array
- **THEN** each `ToolCall` becomes a Langfuse Span with `type: "tool"`
- **AND** the Span includes `gen_ai.tool.name` attribute set to the tool name
- **AND** the Span includes `gen_ai.tool.call.id` if the tool call has an `id`

#### Scenario: Evaluation score attached to trace

- **WHEN** an `EvaluationResult` is exported
- **THEN** the trace includes a Langfuse Score with `name: "eval_score"` and `value` set to the result score
- **AND** the Score includes `comment` with the evaluation reasoning if available

### Requirement: Privacy-Controlled Content Capture

The system SHALL respect privacy settings when exporting trace content.

#### Scenario: Content capture disabled (default)

- **WHEN** `LANGFUSE_CAPTURE_CONTENT` is not set or set to `"false"`
- **THEN** message content is replaced with placeholder text `"[content hidden]"`
- **AND** tool call inputs are replaced with `{}`
- **AND** tool call outputs are replaced with `"[output hidden]"`

#### Scenario: Content capture enabled

- **WHEN** `LANGFUSE_CAPTURE_CONTENT` is set to `"true"`
- **THEN** full message content is included in Generations
- **AND** full tool call inputs and outputs are included in Spans

### Requirement: Custom Langfuse Host

The system SHALL support self-hosted Langfuse instances.

#### Scenario: Custom host configuration

- **WHEN** `LANGFUSE_HOST` environment variable is set
- **THEN** the exporter sends traces to the specified host URL
- **AND** authentication uses the same `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY`

#### Scenario: Default to cloud host

- **WHEN** `LANGFUSE_HOST` is not set
- **THEN** the exporter uses the default Langfuse cloud endpoint

### Requirement: Graceful Export Failures

The system SHALL handle export errors without disrupting evaluation.

#### Scenario: Network error during export

- **WHEN** sending a trace to Langfuse fails due to network error
- **THEN** the system logs a warning with the error details
- **AND** the evaluation result is still written to the output file
- **AND** subsequent eval cases continue to attempt export

#### Scenario: Flush at evaluation end

- **WHEN** all eval cases have completed
- **THEN** the system flushes any pending traces to Langfuse
- **AND** waits for flush to complete before exiting (with timeout)
