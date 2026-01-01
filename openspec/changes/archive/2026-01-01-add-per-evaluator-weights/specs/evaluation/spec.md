## ADDED Requirements

### Requirement: Per-evaluator weights in top-level aggregation

The system SHALL allow each configured evaluator to provide an optional numeric `weight` that influences the eval-case aggregate score.

- If `weight` is omitted, it defaults to `1.0`.
- The eval-case aggregate score SHALL be computed as the weighted mean:

$$
\text{score} = \frac{\sum_i (w_i \cdot s_i)}{\sum_i w_i}
$$

Where $s_i \in [0,1]$ is the evaluator score and $w_i \ge 0$ is the evaluator weight.

#### Scenario: Default aggregation (no weights)
- **GIVEN** an eval case with two evaluators without `weight`
- **AND** evaluator scores are `0.8` and `0.4`
- **WHEN** the system computes the eval-case score
- **THEN** the overall score is the unweighted mean `(0.8 + 0.4) / 2 = 0.6`

#### Scenario: Weighted aggregation (mixed weights)
- **GIVEN** an eval case with evaluators:
  ```yaml
  evaluators:
    - name: safety
      type: llm_judge
      weight: 3
    - name: style
      type: llm_judge
      weight: 1
  ```
- **AND** evaluator scores are `safety=0.8` and `style=0.4`
- **WHEN** the system computes the eval-case score
- **THEN** the overall score is `(3*0.8 + 1*0.4) / (3+1) = 0.7`

#### Scenario: Weight of zero excludes evaluator from aggregation
- **GIVEN** an eval case with two evaluators
- **AND** one evaluator has `weight: 0`
- **WHEN** the system computes the eval-case score
- **THEN** the evaluator with `weight: 0` does not affect the aggregate score

#### Scenario: All weights are zero
- **GIVEN** an eval case where every evaluator has `weight: 0`
- **WHEN** the system computes the eval-case score
- **THEN** the overall score is `0.0`

### Requirement: Persist evaluator weight in results

The system SHALL include the effective `weight` used for aggregation in the per-evaluator results.

#### Scenario: Weight included in evaluator_results
- **GIVEN** an eval case with an evaluator configured with `weight: 2`
- **WHEN** evaluation completes
- **THEN** the corresponding `evaluator_results[*].weight` field is `2`

## MODIFIED Requirements

### Requirement: Custom Evaluators

The system SHALL allow evaluators to consume trace information when available.

#### Scenario: Deterministic trace evaluator reads trace
- **WHEN** an eval case includes a trace-based evaluator (e.g., `tool_trajectory`)
- **THEN** the evaluator receives `candidate_trace_summary`
- **AND** scores the case deterministically based on configured thresholds
- **AND** the evaluator score MAY be weighted during top-level aggregation if a `weight` is provided
