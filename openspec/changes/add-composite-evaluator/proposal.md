# Add Composite Evaluator

## Summary
Introduce `CompositeEvaluator` to enable a common evaluation pattern: run multiple child evaluators and then compute a single final result via an explicit aggregator.

## Motivation
Complex evaluation scenarios often require multiple specialized checks. For example, a "Release Gate" might require:
1.  **Safety**: Must pass strict PII and toxicity checks (hard failure).
2.  **Quality**: Should have a high correctness score (weighted average).

Currently, `agentv` only supports single evaluators per case. `CompositeEvaluator` solves this by orchestrating a "team" of evaluators and deciding the final score based on a configurable strategy.

## Proposed Changes

### 1. New Evaluator Type: `CompositeEvaluator`
*   **Type**: `composite`
*   **Evaluators**: A list of child evaluators to run (can be `llm_judge`, `code_judge`, or nested `composite`).
*   **Aggregator**: Defines how child evaluator results are combined into a single `EvaluationScore`.

### 2. YAML evaluator naming: `code` → `code_judge`

To reduce ambiguity and align naming across built-in evaluators and composite aggregation, the YAML evaluator type currently referred to as `code` SHOULD be renamed to `code_judge`.

This change SHOULD be implemented as:
- Canonical: `type: code_judge`
- `type: code` is not supported.

### 3. Aggregation Strategies
*   **`weighted_average`**: Calculates the weighted mean of child evaluator scores.
*   **`code_judge`**: Executes a user-provided script (via child process) to deterministically compute the final score and verdict based on child evaluator results.
*   **`llm_judge`**: Feeds child evaluator results into an LLM prompt to decide the final score and verdict.

### 3. Execution Model
*   Members are executed in parallel.
*   Results are collected and passed to the aggregation strategy.
*   The final result is a standard `EvaluationScore`.

## Migration Strategy
*   This is an additive change. Existing evaluators remain unchanged.
*   Users can opt-in by using `type: 'composite'` in their configuration.
