# agentv

## 0.26.1

### Patch Changes

- c32ff71: Add comprehensive examples for tool call evaluations, including tool trajectory validation, expected messages with tool calls, and static trace file evaluation

## 0.26.0

### Minor Changes

- 46a9e81: rename guideline_paths to guideline_files and input_segments to input_messages

### Patch Changes

- Updated dependencies [33e15a9]
- Updated dependencies [46a9e81]
  - @agentv/core@0.26.0

## 0.25.0

### Minor Changes

- ae3a56e: Smart fallback for CLI provider `cwd` configuration

  When the `cwd` field in a CLI target uses an environment variable that is empty or not set, the system now automatically falls back to using the directory of the eval file. This makes it easier to run evals without requiring explicit environment configuration.

### Patch Changes

- Updated dependencies [ae3a56e]
  - @agentv/core@0.25.0

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

### Patch Changes

- Updated dependencies [134bc58]
  - @agentv/core@0.24.0

## 0.23.1

### Patch Changes

- 310972e: update azure openai api docs
- Updated dependencies [310972e]
  - @agentv/core@0.23.1

## 0.23.0

### Minor Changes

- update agent skills to match implementation

## 0.22.0

### Minor Changes

- 0efe0bd: Add composite evaluator for combining multiple evaluators with aggregation strategies

  - **Composite evaluator type**: Combine multiple evaluators (llm_judge, code, or nested composites) into a single evaluation
  - **Aggregation strategies**:
    - `weighted_average`: Combine scores using configurable weights
    - `code_judge`: Custom aggregation logic via external script
    - `llm_judge`: LLM-based conflict resolution between evaluators
  - **Nested composite support**: Composites can contain other composites for hierarchical evaluation structures
  - **Detailed result output**: Child evaluator results are shown with individual scores, weights, and reasoning via `evaluator_results` field

### Patch Changes

- Updated dependencies [0efe0bd]
  - @agentv/core@0.23.0

## 0.21.3

### Patch Changes

- Updated dependencies
  - @agentv/core@0.22.2

## 0.21.2

### Patch Changes

- Migrated CLI command parsing from commander.js to cmd-ts library for enhanced TypeScript support, better argument validation, and improved developer experience. Updated all command definitions and error handling accordingly.
- Updated dependencies
  - @agentv/core@0.22.1

## 0.21.1

### Patch Changes

- rename outcome to expected_outcome in examples and skills

## 0.21.0

### Minor Changes

- 7349653: Add CLI commands for generating and running rubric-based evaluations

### Patch Changes

- Updated dependencies [7349653]
  - @agentv/core@0.22.0

## 0.20.1

### Patch Changes

- Updated dependencies
  - @agentv/core@0.21.0

## 0.20.0

### Minor Changes

- 14f0bbb: modernize development tooling and code style
