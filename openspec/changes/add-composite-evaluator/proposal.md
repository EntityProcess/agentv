# Add Composite Evaluator

## Summary
Introduce `CompositeEvaluator` to enable hierarchical evaluation teams. This allows users to combine multiple sub-evaluators (e.g., Safety, Quality, Style) and aggregate their results using either deterministic logic (Code Meta-Judge) or probabilistic reasoning (LLM Meta-Judge).

## Motivation
Complex evaluation scenarios often require multiple specialized checks. For example, a "Release Gate" might require:
1.  **Safety**: Must pass strict PII and toxicity checks (hard failure).
2.  **Quality**: Should have a high correctness score (weighted average).

Currently, `agentv` only supports single evaluators per case. `CompositeEvaluator` solves this by orchestrating a "team" of evaluators and deciding the final score based on a configurable strategy.

## Proposed Changes

### 1. New Evaluator Type: `CompositeEvaluator`
*   **Type**: `composite`
*   **Members**: A list of sub-evaluators (can be `llm_judge`, `code_judge`, or nested `composite`).
*   **Aggregation**: Defines how member results are combined.

### 2. Aggregation Strategies
*   **`weighted_average`**: Calculates the weighted mean of member scores.
*   **`code_judge`**: Executes a user-provided script (via child process) to deterministically compute the final score and verdict based on member results.
*   **`llm_judge`**: Feeds member results into an LLM prompt to decide the final score and verdict.

### 3. Execution Model
*   Members are executed in parallel.
*   Results are collected and passed to the aggregation strategy.
*   The final result is a standard `EvaluationScore`.

## Migration Strategy
*   This is an additive change. Existing evaluators remain unchanged.
*   Users can opt-in by using `type: 'composite'` in their configuration.
