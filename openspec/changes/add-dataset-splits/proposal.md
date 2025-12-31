# Change: Add Dataset Split Filtering

## Why

Users need to organize eval datasets into train/validation/CI splits for systematic experimentation. Training sets are used for prompt optimization, validation sets for held-out testing, and CI sets for lightweight regression checks. Currently users must manually manage file paths or use shell globs.

## What Changes

- **Add `--split` option to eval command**: Filter eval files by split name
  - File naming convention: `*-{split}.yaml` or `*_{split}.yaml`
  - Common splits: `train`, `val`, `ci`, `test`
  - Example: `agentv eval evals/*.yaml --split ci` runs only `*-ci.yaml` files
  - Case-insensitive matching
  - Clear error when no files match the split pattern

## Impact

- Affected specs: `eval-cli`
- Affected code:
  - `apps/cli/src/commands/eval/index.ts` (add --split option)
  - `apps/cli/src/commands/eval/split-filter.ts` (new file)
