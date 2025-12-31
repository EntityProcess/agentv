# Change: Add Compare Command Showcase Examples

## Why

The `agentv compare` command outputs minimal JSON by design. Users need examples showing how to extend it with external scripts for formatting, statistical analysis, and visualization.

## What Changes

- **Add showcase examples** demonstrating compare command usage:
  - Pretty table formatter (pipe JSON to jq + column)
  - Statistical significance script (Python with scipy)
  - Delta visualization with colors (bash/node script)
  - CI integration example (GitHub Actions workflow)

## Impact

- Affected specs: none (documentation only)
- Affected code:
  - `apps/showcase/compare-examples/` (new directory with example scripts)
