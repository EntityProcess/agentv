# Change: Add Custom Aggregator Loading

## Why

Users may need domain-specific aggregate metrics beyond the built-in `confusion-matrix` aggregator. Custom aggregators allow users to write their own TypeScript/JavaScript files.

**Prerequisite**: `add-result-aggregators` must be implemented first.

## What Changes

- Load custom aggregators from `.ts`/`.js` files via `--aggregator ./path/to/file.ts`
- Validate exported interface has `name` and `aggregate` properties

## Impact

- Affected specs: `result-aggregators` (extends CLI flag behavior)
- Affected code: `apps/cli/src/commands/eval/`
