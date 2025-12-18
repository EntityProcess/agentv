# agentv

## 0.24.0

### Minor Changes

- 134bc58: - **Trace Events**: New `TraceEvent` and `TraceSummary` types for capturing normalized, provider-agnostic agent execution traces
  - **Tool Trajectory Evaluator**: New `tool_trajectory` evaluator type with three matching modes:
  - `any_order`: Validates minimum tool call counts regardless of order
  - `in_order`: Validates tools appear in expected sequence (allows gaps)
  - `exact`: Validates exact tool sequence match
  - **Expected Messages Tool Calls**: Support for `tool_calls` field in `expected_messages` for validating assistant tool usage
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
