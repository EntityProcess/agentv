# Spec: Evaluation Capability

## ADDED Requirements

### Requirement: Composite Evaluator
The system SHALL support a `CompositeEvaluator` that orchestrates multiple sub-evaluators.

#### Scenario: Parallel Execution
- **Given** a composite evaluator with multiple members
- **When** `evaluate` is called
- **Then** it SHALL execute all members in parallel
- **And** collect all results before aggregation.

### Requirement: Aggregation Strategies
The system SHALL support configurable strategies for aggregating member results.

#### Scenario: Weighted Average Strategy
- **Given** a composite evaluator with `weighted_average` strategy
- **When** results are aggregated
- **Then** the final score SHALL be the weighted mean of member scores (defaulting to equal weights if unspecified).

#### Scenario: Code Meta-Judge Strategy
- **Given** a composite evaluator with `code_judge` strategy and a script path
- **When** results are aggregated
- **Then** it SHALL execute the script as a child process
- **And** pass the member results as JSON via `stdin`
- **And** parse the script's `stdout` as the final evaluation score.

#### Scenario: LLM Meta-Judge Strategy
- **Given** a composite evaluator with `llm_judge` strategy
- **When** results are aggregated
- **Then** it SHALL prompt an LLM with the member results serialized as JSON
- **And** parse the LLM's response to determine the final score and verdict.
