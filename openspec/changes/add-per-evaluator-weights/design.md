# Design: Per-evaluator weights in top-level aggregation

## Overview
This change introduces an optional `weight` on each top-level evaluator entry to influence the eval-case aggregate score.

The goal is to let users express relative importance (e.g., safety > style) without requiring a `composite` evaluator.

## Data Model
- Add `weight?: number` to top-level evaluator configuration types (`LlmJudgeEvaluatorConfig`, `CodeEvaluatorConfig`, `CompositeEvaluatorConfig`, `ToolTrajectoryEvaluatorConfig`, `ExpectedMessagesEvaluatorConfig`).
- Persist `weight` in `evaluator_results[*].weight` using the **effective** weight (defaulted to `1.0` when omitted).

## Aggregation Semantics
- For a given eval case, after all evaluator scores are produced, compute the final score as a weighted mean:

$$
\text{score} = \frac{\sum_i (w_i \cdot s_i)}{\sum_i w_i}
$$

- Defaulting:
  - If a config omits `weight`, treat it as `1.0`.
- Exclusion:
  - If `weight = 0`, the evaluator’s score is excluded from aggregation.
- Degenerate case:
  - If all configured evaluators have `weight = 0`, final score is `0.0`.

## Validation & Error Handling
- YAML parsing/validation MUST reject any evaluator entry whose `weight` is:
  - non-numeric
  - not finite (`NaN`, `Infinity`, `-Infinity`)
  - negative
- This is a schema-level validation error (hard fail), not a warning.

## Interaction with Composite Evaluators
- Top-level `weight` applies to the score produced by the `composite` evaluator **as a whole**.
- `composite.aggregator.weights` remains the mechanism for weighting **members inside** a composite evaluator.
- There is no `weight` for member evaluators in the YAML schema as part of this change.

## Implementation Note: Reuse of Weighted-Average Logic
- The top-level aggregation uses the same weighted-mean math as the `composite` evaluator’s `weighted_average` aggregator.
- Prefer extracting a tiny shared helper (pure function) for computing weighted means so both call sites stay consistent.
- Do NOT reuse the `CompositeEvaluator` class for top-level aggregation; the class includes additional concerns (nested evaluators, alternative aggregator modes) that are out of scope for this change.

## Output Semantics
- `EvaluationResult.score` is the weighted aggregate score.
- `EvaluationResult.evaluator_results[*].score` remains the evaluator’s own score.
- `EvaluationResult.evaluator_results[*].weight` is included whenever the evaluator ran, using the effective weight.

## Notes
- This change does not alter verdict thresholds (`pass`/`borderline`/`fail`); verdicts are still derived from the final aggregate score using existing thresholds.
