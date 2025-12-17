# Spec: Evaluation Capability

## ADDED Requirements

### Requirement: Composite Evaluator
The system SHALL support a `CompositeEvaluator` that orchestrates multiple sub-evaluators.

#### Scenario: Parallel Execution
- **Given** a composite evaluator with multiple evaluators
- **When** `evaluate` is called
- **Then** it SHALL execute all evaluators in parallel
- **And** collect all results before aggregation.

### Requirement: Aggregation Strategies
The system SHALL support configurable strategies for aggregating child evaluator results.

#### Scenario: Weighted Average Strategy
- **Given** a composite evaluator with an aggregator of type `weighted_average`
- **When** results are aggregated
- **Then** the final score SHALL be the weighted mean of child evaluator scores (defaulting to equal weights if unspecified).

#### Scenario: Code Meta-Judge Strategy
- **Given** a composite evaluator with an aggregator of type `code_judge` and a script path
- **When** results are aggregated
- **Then** it SHALL execute the script as a child process
- **And** pass the child evaluator results as JSON via `stdin`
- **And** parse the script's `stdout` as the final evaluation score.

#### Scenario: LLM Meta-Judge Strategy
- **Given** a composite evaluator with an aggregator of type `llm_judge`
- **When** results are aggregated
- **Then** it SHALL prompt an LLM with the child evaluator results serialized as JSON
- **And** parse the LLM's response to determine the final score and verdict.

## MODIFIED Requirements

### Requirement: Code evaluator naming
The system SHALL use `type: code_judge` as the canonical YAML evaluator type for code-based evaluation.

#### Scenario: Parse canonical `code_judge`
- **WHEN** an eval case includes an evaluator with `type: code_judge`
- **THEN** the system executes the configured script as the code-based evaluator
- **AND** parses the script output using the standard `EvaluationScore` JSON contract.

#### Scenario: Reject `code`
- **WHEN** an eval case includes an evaluator with `type: code`
- **THEN** validation fails with an error instructing the user to use `type: code_judge`.
