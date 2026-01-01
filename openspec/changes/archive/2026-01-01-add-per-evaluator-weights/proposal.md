# Change: Add per-evaluator weights for top-level aggregation

## Why
AgentV currently aggregates multiple evaluator scores for an eval case using an unweighted mean, which makes it hard to express that some criteria (e.g., safety) should dominate others (e.g., style).

Adding an optional `weight` per evaluator enables clearer, more realistic scoring without forcing users to wrap everything in a `composite` evaluator.

## What Changes
- Add optional `weight` field to per-case evaluator entries in YAML.
- Compute the overall eval-case score using a **weighted mean** across evaluator scores.
- Persist the configured `weight` in per-evaluator results output (`evaluator_results[*].weight`).

## Scope
- Applies to **top-level evaluator aggregation** performed by the evaluation runtime (the aggregator that combines evaluator results into the eval-case `score`).
- Does **not** change how `composite` member aggregation works (it continues to use its own aggregator configuration).

## Non-Goals
- Configurable verdict thresholds (`pass`/`borderline`/`fail`).
- A general plugin system / evaluator registry refactor.
- Changing `composite` weighted averaging semantics.

## Impact
- Affected specs:
  - `evaluation` (aggregation semantics and result payload)
  - `yaml-schema` (accept `weight` in evaluator entries)
- Affected code (expected):
  - Evaluator config types (`packages/core/src/evaluation/types.ts`)
  - YAML evaluator parsing (`packages/core/src/evaluation/loaders/evaluator-parser.ts`)
  - Aggregation logic (`packages/core/src/evaluation/orchestrator.ts`)
  - Tests and example YAML files

## Compatibility
- Backward compatible: when `weight` is omitted, behavior remains equivalent to today (all weights default to 1.0).

## Risks
- Users may misunderstand the relationship between top-level `weight` and `composite.aggregator.weights`.
  - Mitigation: document precedence and provide a short example in docs.

## Alternatives Considered
- Require users to model weighting via `composite` everywhere.
  - Rejected: adds verbosity and pushes users into a more complex abstraction for a common need.
