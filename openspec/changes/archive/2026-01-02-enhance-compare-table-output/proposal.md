# Change: Enhance Compare Command with Table Output

## Why

The `agentv compare` command originally output only minimal JSON, requiring users to use external scripts for human-readable formatting. This created friction for common use cases like quick A/B comparison of evaluation runs.

## What Changes

- **Enhanced compare command** with built-in human-readable table output:
  - Colored table format as default (green=win, red=loss, gray=tie)
  - `--format` option to choose between `table` (default) and `json`
  - `--json` flag as shorthand for machine-readable output
  - Snake_case JSON output for Python ecosystem compatibility
  - Respects `NO_COLOR` env var and non-TTY detection

## Decision

Originally proposed as external showcase scripts (pretty table formatter, stats script, visualization). After research into peer frameworks (Google ADK, Mastra, Azure SDK, LangWatch, SniffBench, Letta-Code), decided to enhance the built-in command instead since:
1. SniffBench (closest peer) has comparison built-in
2. Comparison is core to the evaluation workflow
3. Simpler UX than requiring external scripts

## Impact

- Affected specs: `eval-cli`
- Affected code:
  - `apps/cli/src/commands/compare/index.ts` - added table formatter and format options
  - `apps/cli/src/templates/.claude/skills/agentv-eval-builder/references/compare-command.md` - updated docs
  - `examples/features/compare/evals/README.md` - updated example docs
