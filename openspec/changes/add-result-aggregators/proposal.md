# Change: Add Result Aggregators Plugin System

## Why

AgentV currently computes basic summary statistics (mean, median, histogram) after evaluation runs, but lacks extensible aggregate metrics like precision, recall, F1 score, and confusion matrices. These metrics are essential for classification tasks (e.g., export-screening with Low/Medium/High risk levels) but require post-processing logic that operates across the full result set rather than per-case.

The export-screening showcase demonstrates this gap: users must manually run `compute_confusion_matrix.py` as a separate step after `agentv eval`. This proposal adds a plugin system for result aggregators that can compute dataset-level metrics from evaluation results.

## What Changes

- Add a `ResultAggregator` interface in `@agentv/core` for computing aggregate metrics
- Provide built-in aggregators: `basic-stats` (current behavior), `confusion-matrix`, `pass-rate`
- Allow custom aggregators via TypeScript/JavaScript files
- Add `--aggregator` CLI flag to specify which aggregators to run
- Add `aggregators` field in eval YAML for declarative configuration
- Extend summary output to include aggregator results

## Impact

- Affected specs: `eval-cli` (new CLI flags), new `result-aggregators` capability
- Affected code: `apps/cli/src/commands/eval/`, `packages/core/src/aggregators/`
- Non-breaking: Current behavior preserved as `basic-stats` aggregator (default)
