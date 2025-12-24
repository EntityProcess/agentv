# @agentv/core

## 1.1.0

### Minor Changes

- a76c5b3: Remove `expected_tool_calls` evaluator and add trace data to code evaluators

  ### Breaking Changes

  - Removed `expected_tool_calls` evaluator type - use `tool_trajectory` evaluator instead
  - Removed `tool_calls` field from `expected_messages` in eval YAML files
  - Removed `TestMessageToolCall` type and `ExpectedToolCallsEvaluatorConfig` type

  ### New Features

  - Code evaluators (`code_judge`) now receive trace data in their input payload:
    - `candidate_trace_file`: File path to trace JSON (if provider returned `traceRef`)
    - `candidate_trace_summary`: Lightweight summary with tool call counts and names

  ### Improvements

  - Renamed `expected_segments` to `expected_messages` in `EvalCase` interface for better DX consistency with `input_messages`

  ### Migration

  Users with `expected_tool_calls` configurations should:

  1. Switch to `tool_trajectory` evaluator with explicit expected sequence
  2. Or write a custom code evaluator that reads `candidate_trace` from input

## 1.0.0

### Major Changes

- 7dcf805: Rename `expected_messages` evaluator type to `expected_tool_calls`

  The evaluator type has been renamed from `expected_messages` to `expected_tool_calls` to better reflect its purpose of validating tool calls against traces.

  Note: The `expected_messages` field in eval cases remains unchanged - only the evaluator type string changes.

## 0.26.0

### Minor Changes

- 33e15a9: Add per-evaluator weights for top-level aggregation

  - Evaluators now support an optional `weight` field to control their influence on the final aggregate score. This enables expressing relative importance (e.g., safety > style) without requiring a composite evaluator.

- 46a9e81: rename guideline_paths to guideline_files and input_segments to input_messages

## 0.25.0

### Minor Changes

- ae3a56e: Smart fallback for CLI provider `cwd` configuration

  When the `cwd` field in a CLI target uses an environment variable that is empty or not set, the system now automatically falls back to using the directory of the eval file. This makes it easier to run evals without requiring explicit environment configuration.

## 0.24.0

### Minor Changes

- 134bc58: - **Trace Events**: New `TraceEvent` and `TraceSummary` types for capturing normalized, provider-agnostic agent execution traces
  - **Tool Trajectory Evaluator**: New `tool_trajectory` evaluator type with three matching modes:
  - `any_order`: Validates minimum tool call counts regardless of order
  - `in_order`: Validates tools appear in expected sequence (allows gaps)
  - `exact`: Validates exact tool sequence match
  - **Expected Tool Calls Evaluator**: Support for `tool_calls` field in `expected_messages` for validating assistant tool usage (evaluator type: `expected_tool_calls`)
  - **CLI Flags**: `--dump-traces` and `--include-trace` flags for trace output control
  - **Trace Summary**: Automatic computation of lightweight trace summaries (event count, tool names, call counts, error count) included in evaluation results

## 0.23.1

### Patch Changes

- 310972e: update azure openai api docs

## 0.23.0

### Minor Changes

- 0efe0bd: Add composite evaluator for combining multiple evaluators with aggregation strategies

  - **Composite evaluator type**: Combine multiple evaluators (llm_judge, code, or nested composites) into a single evaluation
  - **Aggregation strategies**:
    - `weighted_average`: Combine scores using configurable weights
    - `code_judge`: Custom aggregation logic via external script
    - `llm_judge`: LLM-based conflict resolution between evaluators
  - **Nested composite support**: Composites can contain other composites for hierarchical evaluation structures
  - **Detailed result output**: Child evaluator results are shown with individual scores, weights, and reasoning via `evaluator_results` field

## 0.22.2

### Patch Changes

- Merge `RubricEvaluator` into `LlmJudgeEvaluator` to create a single, unified evaluator that handles both unstructured grading (score + reasoning) and structured grading (rubrics). This unifies the handling of `verdict`, `hits`, and `misses` across both modes.

## 0.22.1

### Patch Changes

- Migrated CLI command parsing from commander.js to cmd-ts library for enhanced TypeScript support, better argument validation, and improved developer experience. Updated all command definitions and error handling accordingly.

## 0.22.0

### Minor Changes

- 7349653: Add rubric evaluator and generator for structured, AI-powered grading of agent responses

## 0.21.0

### Minor Changes

- Updated subagent to 0.5.6 and added custom request templates for VSCode evaluations to ensure all outputs are written to a single response file.

## 0.20.0

### Minor Changes

- 14f0bbb: feat: modernize development tooling and code style

  - Add Changesets for automated versioning and changelog generation, replacing manual version bumping
  - Remove ESLint and adopt Biome for linting and formatting
  - Update subagent dependency to v0.5.5
  - Refactor entire codebase to use single quotes and trailing commas for consistency
