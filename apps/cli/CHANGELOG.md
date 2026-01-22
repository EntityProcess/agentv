# agentv

## 2.5.0

### Minor Changes

- 8862fe3: Add `--filter` CLI flag with glob pattern support for selecting specific eval cases.

  Run evaluations against multiple cases using glob patterns (e.g., `--filter "summary-*"`) or exact case IDs. Replaces `--eval-id` flag.

- 55d627b: Support 0-10 integer score ranges for analytic rubric evaluation.

  Rubric criteria can now define `score_ranges` (0-10 integer bands) with explicit outcomes for more nuanced grading. Use `required_min_score` to gate verdicts on specific criteria scores. Legacy boolean `required` field remains backward-compatible.

### Patch Changes

- Updated dependencies [8862fe3]
- Updated dependencies [147bd9f]
- Updated dependencies [55d627b]
- Updated dependencies [ecfa618]
  - @agentv/core@2.5.0

## 2.4.0

### Minor Changes

- feat: add per-step latency assertions to tool_trajectory evaluator

  - Add `max_duration_ms` field to tool trajectory expected items for timing validation
  - Parse `duration_ms` from provider output (snake_case → camelCase)
  - Scoring: pass counts as hit, fail counts as miss, missing data is neutral

### Patch Changes

- Updated dependencies
  - @agentv/core@2.4.0

## 2.3.0

### Minor Changes

- feat: add per-step latency assertions to tool_trajectory evaluator

  - Add `max_duration_ms` field to tool trajectory expected items for timing validation
  - Parse `duration_ms` from provider output (snake_case → camelCase)
  - Scoring: pass counts as hit, fail counts as miss, missing data is neutral

- 7df7ab3: feat: add input/expected_output field aliases with shorthand syntax

  - `input` alias for `input_messages` (string shorthand expands to single user message)
  - `expected_output` alias for `expected_messages` (string/object shorthand expands to single assistant message)
  - Canonical names take precedence when both specified
  - Full backward compatibility maintained

### Patch Changes

- Updated dependencies
- Updated dependencies [7df7ab3]
  - @agentv/core@2.3.0

## 2.2.0

### Minor Changes

- 736a47e: Add JSONL dataset format support for large-scale evaluation workflows

### Patch Changes

- Updated dependencies [736a47e]
  - @agentv/core@2.2.0

## 2.1.0

### Minor Changes

- e414534: - Added a "Target Proxy" for `code_judge` evaluators, enabling custom code judges to make LLM calls through the configured evaluation provider without direct credential access.
  - Unified framework message types into a single `Message` schema.
  - Added `TargetClient` to `@agentv/eval` SDK for easy target invocation in custom evaluators.
  - Removed the deprecated `code_snippets` field from `EvalCase`.
- caf7a15: Add target proxy visibility and control for code judges:

  - Added `GET /info` endpoint to target proxy returning target name, max calls, call count, and available targets
  - Added optional `target` parameter to invoke requests for per-call target override
  - Added `getInfo()` method to `TargetClient` in `@agentv/eval` SDK
  - Added `TargetInfo` type export from `@agentv/eval`

  This enables code judges to query proxy configuration and use different targets for different purposes (e.g., cheap model for simple checks, expensive model for nuanced evaluation).

### Patch Changes

- Updated dependencies [d497c6e]
- Updated dependencies [e414534]
- Updated dependencies [caf7a15]
- Updated dependencies [caf7a15]
  - @agentv/core@2.1.0

## 2.0.2

### Patch Changes

- 2ce1844: Create @agentv/eval package and add pi-agent-sdk provider support

  - Create standalone @agentv/eval package for code judge SDK with defineCodeJudge()
  - Move defineCodeJudge from @agentv/core to @agentv/eval
  - New import: `import { defineCodeJudge } from '@agentv/eval'`
  - Includes schemas, runtime, and Zod re-export for typed configs
  - Add pi-agent-sdk provider for multi-LLM provider support (Anthropic, OpenAI, Google, Mistral, Groq, Cerebras, xAI, OpenRouter)

- Updated dependencies [2ce1844]
  - @agentv/core@2.0.2

## 2.0.1

### Patch Changes

- d89fd66: improve batch CLI evaluator error handling and examples
- Updated dependencies [d89fd66]
- Updated dependencies [2b5b0f3]
  - @agentv/core@2.0.1

## 2.0.0

### Major Changes

- 7fa51c2: All JSONL output keys are now in snake_case instead of camelCase (e.g., `eval_id` instead of `evalId`, `candidate_answer` instead of `candidateAnswer`). This aligns with Python ecosystem standards used by OpenAI Evals, MLflow, and HuggingFace.

### Minor Changes

- 5276006: Add `field_accuracy`, `latency`, and `cost` evaluators

  - `field_accuracy`: Compare structured data fields with exact, numeric_tolerance, or date matching
  - `latency`: Check execution duration against threshold (uses traceSummary.durationMs)
  - `cost`: Check execution cost against budget (uses traceSummary.costUsd)

  See `examples/features/document-extraction/README.md` for usage examples.

- 5276006: Add structured data and execution-metrics evaluators, normalize code-judge payloads, and ship refreshed eval examples with CI baselines.
- 5276006: Add `token_usage` evaluator to gate on provider-reported token budgets.
- 428e15d: Add TypeScript SDK for code judge evaluators with type-safe camelCase API. The SDK provides `readCodeJudgePayload()` and `parseCodeJudgePayload()` functions that automatically convert snake_case wire format to idiomatic camelCase TypeScript, along with a `CodeJudgePayload` interface for compile-time type safety.
- f5150c8: Add human-readable table output to compare command

  - Table format with colored deltas (green=win, red=loss, gray=tie) is now the default output
  - Add `--format` option to choose between `table` (default) and `json`
  - Add `--json` flag as shorthand for machine-readable output
  - JSON output now uses snake_case for Python ecosystem compatibility
  - Respects `NO_COLOR` env var and non-TTY detection

### Patch Changes

- Updated dependencies [ab325ed]
- Updated dependencies [5276006]
- Updated dependencies [5276006]
- Updated dependencies [5276006]
- Updated dependencies [428e15d]
- Updated dependencies [c850805]
- Updated dependencies [5276006]
- Updated dependencies [7fa51c2]
  - @agentv/core@2.0.0

## 1.6.1

### Patch Changes

- 27727df: Add functional tool evaluation plugins showcase with mock agent

  - Add mock-tool-agent.ts for demonstration of tool evaluation patterns
  - Add mock_agent target to showcase targets configuration
  - Fix pairwise demo to use expected_messages (reference_answer is derived from last message)
  - Update code judge scripts with correct TraceSummary and ToolCall interfaces
  - Update README with correct input contract documentation (input vs args field)
  - Fix "argument matching" status from "planned" to "built-in" in README

## 1.6.0

### Minor Changes

- b0bcc50: Add compare command for evaluation result comparison

  - New `agentv compare` command to compute differences between two JSONL result files
  - Match results by eval_id and compute score deltas
  - Classify outcomes as win/loss/tie based on configurable threshold
  - Exit code indicates comparison result for CI integration

- 9d45033: Add Pi Coding Agent provider and default system prompts for agent evaluations

  - New `pi-coding-agent` provider for the Pi Coding Agent CLI from pi-mono
  - Support file attachments using Pi's native `@path` syntax
  - Extract tool trajectory/traces from Pi's JSONL output
  - Display log file paths in console during eval runs
  - Add `log_format` option ('summary' or 'json') for log verbosity
  - Add default system prompt for Pi and Codex providers instructing agents to include code in response using git diff format
  - Add `system_prompt` config option to override default behavior via targets.yaml

### Patch Changes

- Updated dependencies [9d45033]
  - @agentv/core@1.5.0

## 1.5.1

### Patch Changes

- d6ca0e9: Fix `code_judge` script execution under Bun via a shared subprocess helper and migrate the export-screening showcase evaluators/checks from Python to TypeScript.
- Updated dependencies [d6ca0e9]
  - @agentv/core@1.4.1

## 1.5.0

### Minor Changes

- f9dcfff: Add `agentv convert` command for JSONL to YAML conversion

  Converts evaluation results from JSONL format to YAML, matching the output format of `--output-yaml`.

  Usage:

  ```bash
  agentv convert results.jsonl              # outputs results.yaml
  agentv convert results.jsonl -o out.yaml  # explicit output path
  ```

## 1.4.0

### Minor Changes

- 4969de3: Unify on OutputMessage format for agent execution traces

  - Add `OutputMessage` and `ToolCall` types as the primary format for capturing agent execution
  - Deprecate `TraceEvent` type in favor of the new `OutputMessage` format
  - Remove `text` and `trace` fields from `ProviderResponse`, replaced by `outputMessages`
  - Update template variables (`candidate_answer`, `reference_answer`) to extract content from output messages
  - Tool trajectory evaluator now works with `OutputMessage` format for tool call validation

### Patch Changes

- Updated dependencies [4969de3]
  - @agentv/core@1.4.0

## 1.3.1

### Patch Changes

- 9ef9dca: Simplify eval progress display and reduce verbose output

  - Replace ANSI cursor-based interactive display with simple line-based output
  - Show running/completed/failed status by default, pending only with --verbose
  - CLI provider verbose logs now require --verbose flag
  - Remove CLI_EVALS_DIR from verbose logs

- Updated dependencies [9ef9dca]
  - @agentv/core@1.3.1

## 1.3.0

### Minor Changes

- 5cda52d: Add CLI provider batch mode support (JSONL output) and include a new AML batch CLI example (CSV -> JSONL).

### Patch Changes

- Updated dependencies [5cda52d]
  - @agentv/core@1.3.0

## 1.2.0

### Minor Changes

- 2f5b3ff: Support expected_messages with tool_calls for trace evaluation

  - Updated `isTestMessage` validation to accept messages with `tool_calls` array (without requiring `content`)
  - Updated `processExpectedMessages` to preserve `tool_calls` and `name` fields from expected messages
  - Updated `reference_answer` logic to include full expected_messages array as JSON when multiple messages are present
  - Updated LLM judge prompt to understand reference_answer may contain a sequence of expected agent messages including tool calls

### Patch Changes

- Updated dependencies [2f5b3ff]
  - @agentv/core@1.2.0

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

### Patch Changes

- Updated dependencies [a76c5b3]
  - @agentv/core@1.1.0

## 1.0.0

### Major Changes

- 7dcf805: Rename `expected_messages` evaluator type to `expected_tool_calls`

  The evaluator type has been renamed from `expected_messages` to `expected_tool_calls` to better reflect its purpose of validating tool calls against traces.

  Note: The `expected_messages` field in eval cases remains unchanged - only the evaluator type string changes.

### Patch Changes

- Updated dependencies [7dcf805]
  - @agentv/core@1.0.0

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
