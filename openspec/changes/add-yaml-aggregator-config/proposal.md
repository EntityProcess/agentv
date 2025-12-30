# Change: Add YAML Aggregator Configuration

## Why

For repeatable eval runs, users may want to configure aggregators declaratively in the eval YAML file rather than passing CLI flags each time.

**Prerequisite**: `add-result-aggregators` must be implemented first.

## What Changes

- Add `aggregators` field to eval YAML schema
- Support string syntax (`- confusion-matrix`) and object syntax (`- name: confusion-matrix, config: {...}`)
- CLI `--aggregator` flags override YAML config when provided

## Impact

- Affected specs: `result-aggregators`, `yaml-schema`
- Affected code: `apps/cli/src/commands/eval/`, `packages/core/src/`
