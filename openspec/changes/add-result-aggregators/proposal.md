# Change: Add Confusion Matrix Aggregator

## Why

For classification tasks like export-screening (Low/Medium/High risk), users need precision, recall, and F1 metrics computed across all eval cases. Currently this requires manually running `compute_confusion_matrix.py` after `agentv eval`.

## What Changes

- Add `confusion-matrix` aggregator that computes P/R/F1 per class and macro-averaged
- Add `--aggregator confusion-matrix` CLI flag
- Include aggregator results in terminal summary and output file

## Impact

- Affected specs: `eval-cli` (new CLI flag), new `result-aggregators` capability
- Affected code: `apps/cli/src/commands/eval/`
- Non-breaking: No change to default behavior
