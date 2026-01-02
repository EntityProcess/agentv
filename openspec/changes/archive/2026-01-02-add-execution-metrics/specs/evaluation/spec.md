## ADDED Requirements

### Requirement: Extended Execution Metrics

The system SHALL capture extended execution metrics from providers and make them available to evaluators.

#### Scenario: Provider reports token usage
- **GIVEN** a provider invocation completes successfully
- **AND** the provider response includes token usage data
- **WHEN** the trace is processed
- **THEN** `execution_metrics.tokenUsage` contains `{ input, output, cached? }`
- **AND** the metrics are available to evaluators via `context.executionMetrics`

#### Scenario: Provider reports cost
- **GIVEN** a provider invocation completes successfully
- **AND** the provider response includes cost data
- **WHEN** the trace is processed
- **THEN** `execution_metrics.costUsd` contains the reported cost
- **AND** the cost is included in evaluation results

#### Scenario: Provider reports duration
- **GIVEN** a provider invocation completes successfully
- **WHEN** the trace is processed
- **THEN** `execution_metrics.durationMs` contains the total execution time
- **AND** if individual tool durations are available, `execution_metrics.toolDurations` maps tool names to duration arrays

#### Scenario: Metrics not available
- **GIVEN** a provider invocation completes successfully
- **AND** the provider does not report metrics
- **WHEN** the trace is processed
- **THEN** `execution_metrics` fields are `undefined` or omitted
- **AND** evaluation proceeds normally without metrics

#### Scenario: Computed exploration ratio
- **GIVEN** execution metrics with tool call data
- **AND** a configured list of exploration tools (e.g., `["read", "grep", "glob", "search"]`)
- **WHEN** `explorationRatio` is computed
- **THEN** the ratio equals `explorationToolCalls / totalToolCalls`
- **AND** the ratio is between 0.0 and 1.0

#### Scenario: Computed tokens per tool
- **GIVEN** execution metrics with `tokenUsage.output` and `toolCallCount`
- **WHEN** `tokensPerTool` is computed
- **THEN** the value equals `tokenUsage.output / toolCallCount`
- **AND** returns `undefined` if tool call count is zero

#### Scenario: Code judge receives metrics
- **GIVEN** an eval case with a `code_judge` evaluator
- **AND** the provider reported execution metrics
- **WHEN** the code judge script is invoked
- **THEN** the stdin JSON includes `execution_metrics` with available fields
- **AND** the script can use metrics for scoring decisions

#### Scenario: Metrics in evaluation results
- **GIVEN** an evaluation completes with execution metrics
- **WHEN** results are written to JSONL output
- **THEN** each result includes `execution_metrics` object with available fields
- **AND** undefined fields are omitted from output

### Requirement: Execution Metrics Data Model

The system SHALL define a structured data model for execution metrics.

#### Scenario: Token usage structure
- **GIVEN** a provider reports token usage
- **WHEN** the data is captured
- **THEN** `tokenUsage` has required fields `input: number` and `output: number`
- **AND** optional field `cached?: number` for cache-hit tokens

#### Scenario: Tool durations structure
- **GIVEN** a provider reports individual tool timing
- **WHEN** the data is captured
- **THEN** `toolDurations` is a map of `{ [toolName: string]: number[] }`
- **AND** each array contains durations in milliseconds for each invocation of that tool

#### Scenario: Metrics schema validation
- **GIVEN** a provider returns metrics data
- **WHEN** the data is validated
- **THEN** numeric fields are non-negative
- **AND** invalid data is logged and omitted rather than causing failure
