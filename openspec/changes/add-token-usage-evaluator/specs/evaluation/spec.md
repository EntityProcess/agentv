## ADDED Requirements

### Requirement: Token usage evaluator MUST gate on provider usage

The system SHALL provide a deterministic `token_usage` evaluator that scores based on provider-reported token usage.

#### Scenario: Pass when within limits
- **GIVEN** an eval case with a `token_usage` evaluator configured with `max_total`
- **AND** the provider reports token usage for the attempt
- **WHEN** the evaluator runs
- **THEN** it SHALL return `score: 1` when total tokens are within the configured limit

#### Scenario: Fail when limit exceeded
- **GIVEN** an eval case with a `token_usage` evaluator configured with `max_output`
- **AND** the provider reports output tokens above the configured limit
- **WHEN** the evaluator runs
- **THEN** it SHALL return `score: 0` and a miss explaining the exceeded budget

#### Scenario: Fail when token usage missing
- **GIVEN** an eval case with a `token_usage` evaluator
- **AND** the provider does not report token usage
- **WHEN** the evaluator runs
- **THEN** it SHALL return `score: 0` with a miss explaining token usage is unavailable

### Requirement: Execution metrics MUST be available without tool traces

The system SHALL make provider-reported execution metrics (token usage, cost, duration) available to evaluators even when tool-call traces are absent.

#### Scenario: Provider reports usage without output messages
- **WHEN** a provider response includes `tokenUsage` but no `outputMessages`
- **THEN** the evaluation context SHALL still provide a `trace_summary` containing `tokenUsage`
- **AND** trace-derived fields like `toolNames` MAY be empty
