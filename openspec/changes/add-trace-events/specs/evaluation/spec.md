# Spec Delta: Evaluation (Trace Events)

## MODIFIED Requirements

### Requirement: Test Case Execution

The system SHALL capture provider traces (when available) and make them available to evaluators and output writers.

#### Scenario: Provider returns a trace
- **WHEN** a provider invocation completes successfully
- **AND** the provider response includes a trace payload
- **THEN** the system captures the trace for that eval case attempt
- **AND** computes a `trace_summary`
- **AND** makes `candidate_trace` and `candidate_trace_summary` available to evaluators

#### Scenario: Provider does not support traces
- **WHEN** a provider invocation completes successfully
- **AND** the provider response includes no trace payload
- **THEN** evaluation proceeds as normal
- **AND** no trace fields are included in evaluator context

### Requirement: Custom Evaluators

The system SHALL allow evaluators to consume trace information when available.

#### Scenario: Deterministic trace evaluator reads trace
- **WHEN** an eval case includes a trace-based evaluator (e.g., `tool_trajectory`)
- **THEN** the evaluator receives `candidate_trace_summary`
- **AND** scores the case deterministically based on configured thresholds

#### Scenario: LLM judge may consume trace (opt-in)
- **WHEN** an `llm_judge` evaluator is configured to include trace context
- **THEN** the evaluator prompt MAY include a trace summary section
- **AND** the evaluator remains valid when trace is absent

## ADDED Requirements

### Requirement: Tool Trajectory Evaluator

The system SHALL provide a built-in evaluator that asserts tool-call sequences.

#### Scenario: Minimum calls per tool
- **GIVEN** an eval case with `minimums.knowledgeSearch: 3`
- **WHEN** the trace summary indicates fewer than 3 calls to `knowledgeSearch`
- **THEN** the evaluator returns `score: 0` and a miss explaining the deficit

#### Scenario: In-order expected sequence
- **GIVEN** an eval case with `mode: in_order` and expected tools `[A, B, C]`
- **WHEN** the trace contains tool calls including `A` then `B` then `C` in order
- **THEN** the evaluator returns `score: 1`

#### Scenario: Exact expected sequence
- **GIVEN** an eval case with `mode: exact` and expected tools `[A, B]`
- **WHEN** the trace contains tool calls `[A, B, C]`
- **THEN** the evaluator returns `score: 0` because the sequence is not exact
