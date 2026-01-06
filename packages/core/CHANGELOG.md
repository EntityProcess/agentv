# @agentv/core

## 2.0.2

### Patch Changes

- 2ce1844: Create @agentv/eval package and add pi-agent-sdk provider support

  - Create standalone @agentv/eval package for code judge SDK with defineCodeJudge()
  - Move defineCodeJudge from @agentv/core to @agentv/eval
  - New import: `import { defineCodeJudge } from '@agentv/eval'`
  - Includes schemas, runtime, and Zod re-export for typed configs
  - Add pi-agent-sdk provider for multi-LLM provider support (Anthropic, OpenAI, Google, Mistral, Groq, Cerebras, xAI, OpenRouter)

## 2.0.1

### Patch Changes

- d89fd66: improve batch CLI evaluator error handling and examples
- 2b5b0f3: add Node.js runtime fallback for code_judge execution

## 2.0.0

### Major Changes

- 7fa51c2: All JSONL output keys are now in snake_case instead of camelCase (e.g., `eval_id` instead of `evalId`, `candidate_answer` instead of `candidateAnswer`). This aligns with Python ecosystem standards used by OpenAI Evals, MLflow, and HuggingFace.

### Minor Changes

- ab325ed: Add Claude Code CLI provider for agent evaluations

  - New `claude-code` provider type for running evaluations with Claude Code CLI
  - Supports model, system prompt, cwd, timeout, and custom args configuration
  - Parses JSONL streaming output with tool calls and usage metrics
  - Stream logging to `.agentv/logs/claude-code/` directory
  - Detects nested Claude Code sessions with helpful error message

- 5276006: Add `field_accuracy`, `latency`, and `cost` evaluators

  - `field_accuracy`: Compare structured data fields with exact, numeric_tolerance, or date matching
  - `latency`: Check execution duration against threshold (uses traceSummary.durationMs)
  - `cost`: Check execution cost against budget (uses traceSummary.costUsd)

  See `examples/features/document-extraction/README.md` for usage examples.

- 5276006: Add structured data and execution-metrics evaluators, normalize code-judge payloads, and ship refreshed eval examples with CI baselines.
- 5276006: Add `token_usage` evaluator to gate on provider-reported token budgets.
- 428e15d: Add TypeScript SDK for code judge evaluators with type-safe camelCase API. The SDK provides `readCodeJudgePayload()` and `parseCodeJudgePayload()` functions that automatically convert snake_case wire format to idiomatic camelCase TypeScript, along with a `CodeJudgePayload` interface for compile-time type safety.

### Patch Changes

- c850805: refactor: use Zod schemas for CLI provider JSON parsing

  Replace manual type assertions and field validation with Zod schema definitions
  in the CLI provider's `parseOutputContent()` and `parseJsonlBatchOutput()` methods.
  This provides a single source of truth for data validation, clearer error messages,
  and aligns with the project's established Zod validation patterns.

- 5276006: Fix composite evaluators to pass through trace and output message context so trace-dependent evaluators (e.g. latency/cost/tool_trajectory) work when nested.

## 1.5.0

### Minor Changes

- 9d45033: Add Pi Coding Agent provider and default system prompts for agent evaluations

  - New `pi-coding-agent` provider for the Pi Coding Agent CLI from pi-mono
  - Support file attachments using Pi's native `@path` syntax
  - Extract tool trajectory/traces from Pi's JSONL output
  - Display log file paths in console during eval runs
  - Add `log_format` option ('summary' or 'json') for log verbosity
  - Add default system prompt for Pi and Codex providers instructing agents to include code in response using git diff format
  - Add `system_prompt` config option to override default behavior via targets.yaml

## 1.4.1

### Patch Changes

- d6ca0e9: Fix `code_judge` script execution under Bun via a shared subprocess helper and migrate the export-screening showcase evaluators/checks from Python to TypeScript.

## 1.4.0

### Minor Changes

- 4969de3: Unify on OutputMessage format for agent execution traces

  - Add `OutputMessage` and `ToolCall` types as the primary format for capturing agent execution
  - Deprecate `TraceEvent` type in favor of the new `OutputMessage` format
  - Remove `text` and `trace` fields from `ProviderResponse`, replaced by `outputMessages`
  - Update template variables (`candidate_answer`, `reference_answer`) to extract content from output messages
  - Tool trajectory evaluator now works with `OutputMessage` format for tool call validation

## 1.3.1

### Patch Changes

- 9ef9dca: Simplify eval progress display and reduce verbose output

  - Replace ANSI cursor-based interactive display with simple line-based output
  - Show running/completed/failed status by default, pending only with --verbose
  - CLI provider verbose logs now require --verbose flag
  - Remove CLI_EVALS_DIR from verbose logs

## 1.3.0

### Minor Changes

- 5cda52d: Add CLI provider batch mode support (JSONL output) and include a new AML batch CLI example (CSV -> JSONL).

## 1.2.0

### Minor Changes

- 2f5b3ff: Support expected_messages with tool_calls for trace evaluation

  - Updated `isTestMessage` validation to accept messages with `tool_calls` array (without requiring `content`)
  - Updated `processExpectedMessages` to preserve `tool_calls` and `name` fields from expected messages
  - Updated `reference_answer` logic to include full expected_messages array as JSON when multiple messages are present
  - Updated LLM judge prompt to understand reference_answer may contain a sequence of expected agent messages including tool calls

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
