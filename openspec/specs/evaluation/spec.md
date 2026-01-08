# Spec: Evaluation Capability

## Purpose
Defines the core evaluation runtime: loading eval cases, formatting prompts, invoking providers (including batch-capable and agent-style providers), running evaluators, and handling retries and guideline resolution.
## Requirements
### Requirement: Test Case Execution

The system SHALL capture provider traces from explicit `trace`, `traceRef`, or `outputMessages` fields.

#### Scenario: Provider returns a trace
- **WHEN** a provider invocation completes successfully
- **AND** the provider response includes a trace payload (from `trace`, `traceRef`, or `outputMessages`)
- **THEN** the system captures the trace for that eval case attempt
- **AND** computes a `trace_summary` with `eventCount`, `toolNames`, `toolCallsByName`, and `errorCount`
- **AND** makes `candidate_trace` and `candidate_trace_summary` available to evaluators

### Requirement: LLM Judge Evaluator JSON Contract

The system SHALL instruct LLM judge evaluators to emit a single JSON object and normalize the response.

#### Scenario: Enforce JSON prompt contract

- **WHEN** an LLM judge evaluator builds its prompts
- **THEN** it renders a user prompt that includes `expected_outcome`, `question`, `reference_answer`, and `candidate_answer`
- **AND** it adds a system prompt that mandates a single JSON object with `score`, `hits`, `misses`, and `reasoning` (hits/misses capped at four items)

#### Scenario: Parse JSON evaluator response

- **WHEN** a judge provider returns a response
- **THEN** the evaluator extracts the first valid JSON object (directly or from surrounding text)
- **AND** clamps `score` to `[0, 1]` and trims `hits`/`misses` to non-empty strings with a maximum of four entries each
- **AND** falls back to `score: 0`, empty hits/misses, and optional `reasoning` when no valid JSON is present

#### Scenario: Record evaluator request metadata

- **WHEN** an LLM judge evaluation completes
- **THEN** the evaluator stores the rendered `userPrompt` and `systemPrompt` in `evaluator_provider_request`
- **AND** no warning is emitted on parse failure; the failure is reflected in the zeroed score

### Requirement: Provider Integration

The system SHALL integrate with supported providers using target configuration and optional retry settings.

#### Scenario: Azure OpenAI provider

- **WHEN** a target is configured with `provider: azure` (or `azure-openai`)
- **THEN** the system resolves `resourceName` (endpoint or hostname), `deploymentName`, and `apiKey` from `targets.yaml` (supporting `${{ VAR }}` environment references)
- **AND** uses API version `2024-10-01-preview` by default with optional temperature/maxOutputTokens and retry configuration

#### Scenario: Anthropic provider

- **WHEN** a target uses `provider: anthropic`
- **THEN** the system resolves `apiKey` and `model` from target values (supporting `${{ VAR }}`), plus optional `temperature`, `maxOutputTokens`, and `thinkingBudget`
- **AND** invokes Anthropic via the Vercel AI SDK with the resolved retry settings

#### Scenario: Google Gemini provider

- **WHEN** a target uses `provider: gemini`/`google`
- **THEN** the system resolves `apiKey` from target values (supporting `${{ VAR }}`) and defaults `model` to `gemini-2.5-flash` when not provided
- **AND** applies optional `temperature`, `maxOutputTokens`, and retry configuration before invoking Gemini

#### Scenario: VS Code provider

- **WHEN** a target uses `provider: vscode` (or `vscode-insiders`)
- **THEN** the provider builds a prompt document with a mandatory preread block linking guideline and attachment files via `file://` URLs and the user query
- **AND** dispatches the request through the subagent library (batching when requested) and reads the assistant response from the subagent response file
- **AND** returns dry-run metadata without text when `dryRun` is enabled

#### Scenario: Codex CLI provider

- **WHEN** a target uses `provider: codex`
- **THEN** the system ensures the Codex executable is discoverable (respecting `settings.executable`), creates a temporary workspace, and writes the preread prompt to `prompt.md`
- **AND** runs `codex --ask-for-approval never exec --json --color never --skip-git-repo-check -` (plus any configured args), streaming logs when enabled
- **AND** parses the JSON/JSONL output to extract the final assistant message, attaching stdout/stderr and log paths on failures

#### Scenario: Mock provider for dry-run

- **WHEN** a target uses `provider: mock`
- **THEN** the provider returns the configured canned response (optionally delayed) without external calls

### Requirement: Parallel Test Execution

The system SHALL support concurrent eval case execution while isolating failures.

#### Scenario: Configurable concurrency

- **WHEN** running eval cases with `maxConcurrency` provided
- **THEN** the system executes up to that many eval cases in parallel using a worker pool
- **AND** falls back to the target `workers` setting or 1 when no override is provided

#### Scenario: Error isolation in parallel mode

- **WHEN** a worker fails while others are still running
- **THEN** the failure is captured for that eval case and does not block other workers
- **AND** overall execution continues until all eval cases settle

### Requirement: Provider-level batching flag

The system SHALL allow targets to request provider-level batching via `provider_batching: true`, using batch APIs when supported.

#### Scenario: Enabled for batching-capable provider

- **WHEN** a target sets `provider_batching: true`
- **AND** the provider advertises `supportsBatch` with `invokeBatch`
- **THEN** the system dispatches all eval cases through a single batch call and maps responses back to their eval IDs
- **AND** falls back to per-case dispatch if batch execution throws an error

#### Scenario: Fallback when provider cannot batch

- **WHEN** `provider_batching: true` is set but the provider lacks batch support
- **THEN** the system logs a verbose warning (when enabled) and executes per case without failing schema validation

### Requirement: Custom Evaluators

The system SHALL allow evaluators to consume trace information when available.

#### Scenario: Deterministic trace evaluator reads trace
- **WHEN** an eval case includes a trace-based evaluator (e.g., `tool_trajectory`)
- **THEN** the evaluator receives `candidate_trace_summary`
- **AND** scores the case deterministically based on configured thresholds
- **AND** the evaluator score MAY be weighted during top-level aggregation if a `weight` is provided

#### Scenario: LLM judge may consume trace (opt-in)
- **WHEN** an `llm_judge` evaluator is configured to include trace context
- **THEN** the evaluator prompt MAY include a trace summary section
- **AND** the evaluator remains valid when trace is absent

### Requirement: CLI Template Execution

The system SHALL support a `cli` provider that renders a command template per eval case and captures stdout as the answer.

#### Scenario: Render and execute template

- **WHEN** a target uses `provider: cli`
- **THEN** the provider renders the template with placeholders `{PROMPT}`, `{GUIDELINES}`, `{EVAL_ID}`, `{ATTEMPT}`, `{FILES}`, and `{OUTPUT_FILE}`
- **AND** executes the command with optional `cwd`/timeout and reads the provider response from the rendered `{OUTPUT_FILE}` path (cleaning it up afterward)
- **AND** errors include stderr/exit code context when the command fails

#### Scenario: Optional health check

- **WHEN** a CLI target defines a healthcheck of type `http` or `command`
- **THEN** the provider runs the probe once before the first request (respecting timeout/cwd) and aborts execution if the probe fails

### Requirement: CLI Template Configuration

The system SHALL validate CLI template targets for required fields and supported placeholders.

#### Scenario: Required template fields

- **WHEN** parsing a `cli` target
- **THEN** validation enforces a non-empty `commandTemplate` and accepts optional `filesFormat`, `cwd`, `timeoutSeconds`, `healthcheck`, and `verbose`
- **AND** rejects unsupported or missing fields with actionable errors

#### Scenario: Placeholder substitution rules

- **WHEN** rendering a template
- **THEN** the provider substitutes supported placeholders only, shell-escapes values, and rejects templates containing unsupported placeholders

#### Scenario: Health check schema

- **WHEN** validating `healthcheck`
- **THEN** only `{ type: "http", url, timeoutSeconds? }` or `{ type: "command", commandTemplate, cwd?, timeoutSeconds? }` are accepted
- **AND** unsupported types fail validation

### Requirement: Provider Retry Configuration

The system SHALL honor optional retry configuration for Azure, Anthropic, and Gemini providers.

#### Scenario: Configure retry in targets.yaml

- **WHEN** a target defines retry fields (snake_case or camelCase)
- **THEN** the system resolves `maxRetries`, `initialDelayMs`, `maxDelayMs`, `backoffFactor`, and `retryableStatusCodes`
- **AND** passes them to the provider invocation helper

#### Scenario: Default exponential backoff

- **WHEN** retry settings are omitted
- **THEN** the provider retries network or retryable HTTP errors up to 3 times with exponential backoff starting at 1000ms and jitter, capped at 60000ms

#### Scenario: Non-retryable errors

- **WHEN** a request fails with HTTP 401/403 or a non-retryable status
- **THEN** the system does not retry and returns the error immediately

### Requirement: Guideline Pattern Configuration

The system SHALL support custom guideline detection via `.agentv.yaml`.

#### Scenario: Load custom guideline patterns

- **WHEN** a `.agentv.yaml` in the eval directory defines `guideline_patterns`
- **THEN** the loader treats files matching those globs as guidelines and excludes them from user segments

#### Scenario: Use defaults when config absent

- **WHEN** no `.agentv.yaml` is present
- **THEN** default patterns `**/*.instructions.md`, `**/instructions/**`, `**/*.prompt.md`, `**/prompts/**` are applied

#### Scenario: Match files with glob patterns

- **WHEN** evaluating whether a file is a guideline
- **THEN** the path is normalized to forward slashes and matched against the configured globs supporting `**` and `*`

### Requirement: Trace Data Model

The system SHALL use a normalized trace model for provider-agnostic evaluation. **The `trace` field is deprecated in favor of `outputMessages`.**

#### Scenario: TraceEvent structure
- **GIVEN** a provider returns trace data
- **WHEN** the trace is normalized
- **THEN** each event has required field `type` (one of `model_step`, `tool_call`, `tool_result`, `message`, `error`)
- **AND** optional fields `timestamp` (ISO 8601), `id`, `name`, `input`, `output`, `text`, `metadata`
- **AND** the `trace` field carries a `@deprecated` annotation recommending `outputMessages` instead

#### Scenario: TraceSummary computation
- **GIVEN** a normalized trace with events:
  ```json
  [
    { "type": "tool_call", "name": "searchDocs" },
    { "type": "tool_result" },
    { "type": "tool_call", "name": "searchDocs" },
    { "type": "tool_result" },
    { "type": "tool_call", "name": "verify" },
    { "type": "tool_result" }
  ]
  ```
- **WHEN** TraceSummary is computed
- **THEN** the result is:
  ```json
  {
    "eventCount": 6,
    "toolNames": ["searchDocs", "verify"],
    "toolCallsByName": { "searchDocs": 2, "verify": 1 },
    "errorCount": 0
  }
  ```
- **AND** `toolNames` is sorted alphabetically

#### Scenario: TraceSummary from outputMessages
- **GIVEN** output messages with tool calls:
  ```json
  [
    { "role": "assistant", "toolCalls": [{ "tool": "searchDocs" }, { "tool": "verify" }] }
  ]
  ```
- **WHEN** TraceSummary is computed from outputMessages
- **THEN** the result matches trace-based computation:
  ```json
  {
    "eventCount": 2,
    "toolNames": ["searchDocs", "verify"],
    "toolCallsByName": { "searchDocs": 1, "verify": 1 },
    "errorCount": 0
  }
  ```

### Requirement: Tool Trajectory Evaluator

The system SHALL provide a built-in `tool_trajectory` evaluator that asserts tool-call constraints using `outputMessages` as the primary source.

#### Scenario: Minimum calls met - PASS (from outputMessages)
- **GIVEN** an eval case with evaluator:
  ```yaml
  type: tool_trajectory
  mode: any_order
  minimums:
    semanticSearch: 3
  ```
- **AND** outputMessages contains 3 tool calls to `semanticSearch`
- **WHEN** the evaluator runs
- **THEN** it returns `score: 1.0`
- **AND** `hits` includes a message like `"semanticSearch called 3 times (minimum: 3)"`

#### Scenario: Minimum calls met - PASS (fallback to trace)
- **GIVEN** an eval case with evaluator:
  ```yaml
  type: tool_trajectory
  mode: any_order
  minimums:
    semanticSearch: 3
  ```
- **AND** no outputMessages available
- **AND** trace summary `toolCallsByName: { "semanticSearch": 3 }`
- **WHEN** the evaluator runs
- **THEN** it returns `score: 1.0` using the trace fallback

#### Scenario: Minimum calls not met - FAIL
- **GIVEN** an eval case with evaluator:
  ```yaml
  type: tool_trajectory
  mode: any_order
  minimums:
    semanticSearch: 3
  ```
- **AND** outputMessages contains 1 tool call to `semanticSearch`
- **WHEN** the evaluator runs
- **THEN** it returns `score: 0.0`
- **AND** `misses` includes a message like `"semanticSearch called 1 time (minimum: 3)"`

#### Scenario: Multiple minimums - partial pass
- **GIVEN** an eval case with evaluator:
  ```yaml
  type: tool_trajectory
  mode: any_order
  minimums:
    toolA: 2
    toolB: 2
  ```
- **AND** outputMessages contains 2 calls to `toolA` and 1 call to `toolB`
- **WHEN** the evaluator runs
- **THEN** it returns `score: 0.5` (1 of 2 constraints met)
- **AND** `hits` includes message for toolA
- **AND** `misses` includes message for toolB

#### Scenario: In-order sequence - PASS
- **GIVEN** an eval case with evaluator:
  ```yaml
  type: tool_trajectory
  mode: in_order
  expected:
    - tool: A
    - tool: B
    - tool: C
  ```
- **AND** outputMessages contains tool calls in order `[A, X, B, Y, C]` (extra tools allowed)
- **WHEN** the evaluator runs
- **THEN** it returns `score: 1.0`

#### Scenario: In-order sequence - FAIL (wrong order)
- **GIVEN** an eval case with evaluator:
  ```yaml
  type: tool_trajectory
  mode: in_order
  expected:
    - tool: A
    - tool: B
  ```
- **AND** outputMessages contains tool calls in order `[B, A]`
- **WHEN** the evaluator runs
- **THEN** it returns `score: 0.0`
- **AND** `misses` explains the order mismatch

#### Scenario: Exact sequence - PASS
- **GIVEN** an eval case with evaluator:
  ```yaml
  type: tool_trajectory
  mode: exact
  expected:
    - tool: A
    - tool: B
  ```
- **AND** outputMessages contains exactly tool calls `[A, B]`
- **WHEN** the evaluator runs
- **THEN** it returns `score: 1.0`

#### Scenario: Exact sequence - FAIL (extra tools)
- **GIVEN** an eval case with evaluator:
  ```yaml
  type: tool_trajectory
  mode: exact
  expected:
    - tool: A
    - tool: B
  ```
- **AND** outputMessages contains tool calls `[A, B, C]`
- **WHEN** the evaluator runs
- **THEN** it returns `score: 0.0`
- **AND** `misses` explains the extra tool

#### Scenario: No trace or outputMessages available
- **GIVEN** an eval case with a `tool_trajectory` evaluator
- **AND** the provider returned neither trace nor outputMessages
- **WHEN** the evaluator runs
- **THEN** it returns `score: 0.0`
- **AND** `misses` includes `"No trace available for evaluation"`

### Requirement: Output Message Format

The system SHALL accept agent execution data in OpenAI-style output message format with optional extended fields.

#### Scenario: ToolCall with optional trace fields
- **GIVEN** a provider returns output messages with tool calls
- **WHEN** the JSONL contains:
  ```json
  {
    "output_messages": [{
      "role": "assistant",
      "tool_calls": [{
        "tool": "searchDocs",
        "input": {"query": "test"},
        "output": {"results": []},
        "id": "call_123",
        "timestamp": "2025-01-01T00:00:00Z"
      }]
    }]
  }
  ```
- **THEN** the system parses `id` and `timestamp` as optional ToolCall fields
- **AND** converts snake_case wire format to camelCase TypeScript interfaces

#### Scenario: OutputMessage with optional metadata
- **GIVEN** a provider returns output messages
- **WHEN** messages include optional fields:
  ```json
  {
    "output_messages": [{
      "role": "assistant",
      "content": "response",
      "timestamp": "2025-01-01T00:00:00Z",
      "metadata": {"latency_ms": 150}
    }]
  }
  ```
- **THEN** the system parses `timestamp` and `metadata` as optional OutputMessage fields
- **AND** makes these available to evaluators via `context.outputMessages`

### Requirement: Evaluator OutputMessages Context

The system SHALL pass output messages to evaluators as the primary source for tool trajectory analysis.

#### Scenario: OutputMessages available in evaluator context
- **GIVEN** a provider returns `output_messages` with `tool_calls`
- **WHEN** an evaluator is invoked
- **THEN** `context.outputMessages` contains the parsed messages
- **AND** evaluators can access tool calls via `outputMessages[].toolCalls[]`

#### Scenario: Fallback to trace when outputMessages absent
- **GIVEN** a provider returns `trace` but no `output_messages`
- **WHEN** an evaluator is invoked
- **THEN** `context.trace` contains the trace events
- **AND** `context.outputMessages` is undefined

### Requirement: Per-evaluator weights in top-level aggregation

The system SHALL allow each configured evaluator to provide an optional numeric `weight` that influences the eval-case aggregate score.

- If `weight` is omitted, it defaults to `1.0`.
- The eval-case aggregate score SHALL be computed as the weighted mean:

$$
\text{score} = \frac{\sum_i (w_i \cdot s_i)}{\sum_i w_i}
$$

Where $s_i \in [0,1]$ is the evaluator score and $w_i \ge 0$ is the evaluator weight.

#### Scenario: Default aggregation (no weights)
- **GIVEN** an eval case with two evaluators without `weight`
- **AND** evaluator scores are `0.8` and `0.4`
- **WHEN** the system computes the eval-case score
- **THEN** the overall score is the unweighted mean `(0.8 + 0.4) / 2 = 0.6`

#### Scenario: Weighted aggregation (mixed weights)
- **GIVEN** an eval case with evaluators:
  ```yaml
  evaluators:
    - name: safety
      type: llm_judge
      weight: 3
    - name: style
      type: llm_judge
      weight: 1
  ```
- **AND** evaluator scores are `safety=0.8` and `style=0.4`
- **WHEN** the system computes the eval-case score
- **THEN** the overall score is `(3*0.8 + 1*0.4) / (3+1) = 0.7`

#### Scenario: Weight of zero excludes evaluator from aggregation
- **GIVEN** an eval case with two evaluators
- **AND** one evaluator has `weight: 0`
- **WHEN** the system computes the eval-case score
- **THEN** the evaluator with `weight: 0` does not affect the aggregate score

#### Scenario: All weights are zero
- **GIVEN** an eval case where every evaluator has `weight: 0`
- **WHEN** the system computes the eval-case score
- **THEN** the overall score is `0.0`

### Requirement: Persist evaluator weight in results

The system SHALL include the effective `weight` used for aggregation in the per-evaluator results.

#### Scenario: Weight included in evaluator_results
- **GIVEN** an eval case with an evaluator configured with `weight: 2`
- **WHEN** evaluation completes
- **THEN** the corresponding `evaluator_results[*].weight` field is `2`

### Requirement: Score Aggregation

The system SHALL aggregate scores when multiple evaluators are configured.

#### Scenario: Multiple evaluators aggregation
- **GIVEN** an eval case with two evaluators
- **AND** evaluator A returns `score: 1.0`
- **AND** evaluator B returns `score: 0.0`
- **WHEN** scores are aggregated
- **THEN** overall `score` is `0.5` (mean of individual scores)
- **AND** `status` is `"fail"` (score < 1.0)

### Requirement: Extract traces from output messages

The system SHALL extract trace events from provider `outputMessages` when no explicit `trace` is provided.

#### Scenario: Provider returns output messages with tool calls
- **WHEN** a provider invocation completes successfully
- **AND** the provider response includes `outputMessages` with `toolCalls`
- **AND** the provider response does NOT include an explicit `trace` field
- **THEN** the system extracts `TraceEvent[]` from `outputMessages[].toolCalls[]`
- **AND** computes a `trace_summary` with tool call counts and names
- **AND** makes `candidate_trace` and `candidate_trace_summary` available to evaluators

#### Scenario: Output messages without tool calls
- **WHEN** a provider invocation completes successfully
- **AND** the provider response includes `outputMessages` without any `toolCalls`
- **THEN** the system extracts an empty trace
- **AND** `candidate_trace` is an empty array
- **AND** `candidate_trace_summary` shows zero tool calls

#### Scenario: Trace extraction maps tool call fields
- **WHEN** extracting traces from `outputMessages`
- **THEN** each `toolCalls[]` entry maps to a `TraceEvent` with:
  - `type: 'tool_call'`
  - `name` from `toolCalls[].tool`
  - `input` from `toolCalls[].input`
  - `output` from `toolCalls[].output`
  - `timestamp` from source message if available (optional field)
- **AND** preserves tool call sequence from array order

#### Scenario: Explicit trace takes precedence
- **WHEN** a provider response includes both `trace` and `outputMessages`
- **THEN** the system uses the explicit `trace` field
- **AND** ignores `outputMessages` for trace extraction

### Requirement: TraceEvent timestamp is optional

The `TraceEvent.timestamp` field SHALL be optional to support trace extraction from sources that don't provide timestamps.

#### Scenario: TraceEvent without timestamp
- **WHEN** a `TraceEvent` is created without a `timestamp` field
- **THEN** the event is valid and can be used for evaluation
- **AND** trace ordering is determined by array position, not timestamp

### Requirement: Extended Execution Metrics

The system SHALL capture extended execution metrics from providers and make them available to evaluators.

#### Scenario: Provider reports token usage
- **GIVEN** a provider invocation completes successfully
- **AND** the provider response includes token usage data
- **WHEN** the trace is processed
- **THEN** `execution_metrics.tokenUsage` contains `{ input, output, cached? }`
- **AND** the metrics are available to evaluators via `context.executionMetrics`

#### Scenario: Provider reports cost
- **GIVEN** a provider invocation completes successfully
- **AND** the provider response includes cost data
- **WHEN** the trace is processed
- **THEN** `execution_metrics.costUsd` contains the reported cost
- **AND** the cost is included in evaluation results

#### Scenario: Provider reports duration
- **GIVEN** a provider invocation completes successfully
- **WHEN** the trace is processed
- **THEN** `execution_metrics.durationMs` contains the total execution time
- **AND** if individual tool durations are available, `execution_metrics.toolDurations` maps tool names to duration arrays

#### Scenario: Metrics not available
- **GIVEN** a provider invocation completes successfully
- **AND** the provider does not report metrics
- **WHEN** the trace is processed
- **THEN** `execution_metrics` fields are `undefined` or omitted
- **AND** evaluation proceeds normally without metrics

#### Scenario: Computed exploration ratio
- **GIVEN** execution metrics with tool call data
- **AND** a configured list of exploration tools (e.g., `["read", "grep", "glob", "search"]`)
- **WHEN** `explorationRatio` is computed
- **THEN** the ratio equals `explorationToolCalls / totalToolCalls`
- **AND** the ratio is between 0.0 and 1.0

#### Scenario: Computed tokens per tool
- **GIVEN** execution metrics with `tokenUsage.output` and `toolCallCount`
- **WHEN** `tokensPerTool` is computed
- **THEN** the value equals `tokenUsage.output / toolCallCount`
- **AND** returns `undefined` if tool call count is zero

#### Scenario: Code judge receives metrics
- **GIVEN** an eval case with a `code_judge` evaluator
- **AND** the provider reported execution metrics
- **WHEN** the code judge script is invoked
- **THEN** the stdin JSON includes `execution_metrics` with available fields
- **AND** the script can use metrics for scoring decisions

#### Scenario: Metrics in evaluation results
- **GIVEN** an evaluation completes with execution metrics
- **WHEN** results are written to JSONL output
- **THEN** each result includes `execution_metrics` object with available fields
- **AND** undefined fields are omitted from output

### Requirement: Execution Metrics Data Model

The system SHALL define a structured data model for execution metrics.

#### Scenario: Token usage structure
- **GIVEN** a provider reports token usage
- **WHEN** the data is captured
- **THEN** `tokenUsage` has required fields `input: number` and `output: number`
- **AND** optional field `cached?: number` for cache-hit tokens

#### Scenario: Tool durations structure
- **GIVEN** a provider reports individual tool timing
- **WHEN** the data is captured
- **THEN** `toolDurations` is a map of `{ [toolName: string]: number[] }`
- **AND** each array contains durations in milliseconds for each invocation of that tool

#### Scenario: Metrics schema validation
- **GIVEN** a provider returns metrics data
- **WHEN** the data is validated
- **THEN** numeric fields are non-negative
- **AND** invalid data is logged and omitted rather than causing failure

### Requirement: Claude Code CLI provider

The system SHALL integrate with the Claude Code CLI (`claude`) as a first-class provider for evaluating Claude Code agent outputs.

#### Scenario: Claude Code provider invocation

- **WHEN** a target uses `provider: claude-code`
- **THEN** the system ensures the Claude executable is discoverable (respecting `settings.executable`, defaulting to `claude`)
- **AND** runs `claude -p --output-format stream-json --verbose` with the prompt on stdin (plus any configured args)
- **AND** parses the JSONL streaming output to extract the result and assistant messages
- **AND** returns the final assistant text as the candidate answer with `outputMessages` containing the conversation history

#### Scenario: Claude Code model configuration

- **WHEN** a `claude-code` target specifies a `model` field
- **THEN** the system passes `--model <value>` to the Claude CLI
- **AND** supports both aliases (`sonnet`, `opus`, `haiku`) and full model names (`claude-sonnet-4-5-20250929`)

#### Scenario: Claude Code system prompt configuration

- **WHEN** a `claude-code` target specifies a `system_prompt` field
- **THEN** the system passes `--system-prompt <value>` to the Claude CLI
- **AND** uses a default prompt instructing the agent to return code in its response when not configured

#### Scenario: Claude Code working directory

- **WHEN** a `claude-code` target specifies a `cwd` field
- **THEN** the CLI is executed in that directory
- **AND** creates a temporary workspace when not specified

#### Scenario: Claude Code timeout handling

- **WHEN** a `claude-code` target specifies `timeout_seconds`
- **THEN** the provider terminates the process after that duration
- **AND** returns an error indicating the timeout occurred

#### Scenario: Claude Code custom arguments

- **WHEN** a `claude-code` target specifies an `args` array
- **THEN** those arguments are passed to the Claude CLI after the built-in flags
- **AND** can be used to configure tools, permissions, or other CLI options

#### Scenario: Claude Code stream logging

- **WHEN** Claude Code execution is in progress
- **THEN** the provider streams stdout/stderr to a log file in `.agentv/logs/claude-code/`
- **AND** the log file path is included in the provider response metadata
- **AND** logging can be disabled via `AGENTV_CLAUDE_CODE_STREAM_LOGS=false`

#### Scenario: Claude Code JSONL output parsing

- **WHEN** the Claude CLI exits successfully
- **THEN** the provider parses each JSONL line from stdout
- **AND** extracts the `result` message type for the final answer
- **AND** extracts `assistant` message types for `outputMessages` with tool calls
- **AND** preserves usage metrics and cost information in the response metadata

#### Scenario: Claude Code error handling

- **WHEN** the Claude CLI exits with a non-zero code
- **THEN** the provider returns an error with the exit code, stderr content, and relevant stdout context
- **AND** the log file (if enabled) contains the full execution trace for debugging

#### Scenario: Claude Code input files

- **WHEN** a `claude-code` target receives a request with `inputFiles`
- **THEN** the provider includes the file contents in the prompt using preread format
- **AND** file paths are resolved relative to the working directory

### Requirement: Canonical Code Judge Wire Schema
The system SHALL define a canonical code_judge payload schema with snake_case wire keys.

#### Scenario: Emit payload to code_judge evaluator
- **WHEN** the runtime invokes a code_judge evaluator
- **THEN** it emits a JSON payload that conforms to the canonical schema
- **AND** field names are snake_case in the wire format
- **IMPLEMENTATION**: `CodeEvaluator` uses `toSnakeCaseDeep()` to convert internal camelCase to snake_case JSON

#### Scenario: Preserve legacy payload shape
- **WHEN** existing code_judge evaluators read stdin payloads
- **THEN** the payload shape remains compatible with the current snake_case format
- **VERIFIED**: Existing Node.js code judges continue to work unchanged

### Requirement: Optional TypeScript SDK
The system SHALL provide an optional, idiomatic TypeScript SDK for code_judge evaluator authors.

#### Scenario: TypeScript SDK usage
- **WHEN** a TypeScript code_judge evaluator imports from `@agentv/core`
- **THEN** it can use `readCodeJudgePayload()` to read stdin
- **AND** the returned object has camelCase properties (e.g., `candidateAnswer`, `expectedOutcome`)
- **AND** TypeScript types provide compile-time safety
- **IMPLEMENTATION**:
  - SDK exports: `CodeJudgePayload` interface, `readCodeJudgePayload()`, `parseCodeJudgePayload()`
  - Internally uses `toCamelCaseDeep()` to convert snake_case stdin to camelCase
  - Location: `packages/core/src/evaluation/code-judge-sdk.ts`

#### Scenario: SDK integration test
- **WHEN** tests run the evaluator test suite
- **THEN** an integration test verifies SDK-based code judges work correctly
- **AND** the test fixture uses `readCodeJudgePayload()` from the SDK
- **IMPLEMENTATION**:
  - Test: `packages/core/test/evaluation/evaluators.test.ts` ("works with TypeScript SDK-based code judge")
  - Fixture: `packages/core/test/fixtures/test-sdk-judge.ts`

#### Scenario: SDK feature example
- **WHEN** users explore `examples/features/code-judge-sdk/`
- **THEN** they find a working example that imports from `@agentv/core`
- **AND** the example runs out of the box after `bun install && bun run build`
- **AND** the README demonstrates standalone testing
- **IMPLEMENTATION**:
  - Example: `examples/features/code-judge-sdk/scripts/verify-attachments.ts`
  - Package: `examples/features/code-judge-sdk/package.json` (workspace dependency on `@agentv/core`)
  - Workspace: Root `package.json` includes `examples/features/*` and `examples/showcase/*`

### Requirement: Target Proxy Info Endpoint
The target proxy SHALL provide an info endpoint for code judges to query proxy metadata.

#### Scenario: Code judge queries proxy info
- **GIVEN** a code judge is running with target proxy access
- **WHEN** the script calls the `/info` endpoint via `target.getInfo()`
- **THEN** the proxy returns JSON with `targetName`, `maxCalls`, and `callCount`
- **AND** the response includes the name of the configured target

#### Scenario: Info endpoint requires authentication
- **GIVEN** the target proxy is running
- **WHEN** a request to `/info` is made without valid bearer token
- **THEN** the proxy responds with HTTP 401

### Requirement: Target Proxy Target Override
The target proxy SHALL allow code judges to specify an alternative target for individual invoke calls.

#### Scenario: Code judge overrides target for specific call
- **GIVEN** a code judge is running with target proxy access
- **AND** multiple targets are configured in `agentv.config.yaml`
- **WHEN** the script calls `target.invoke({ question: "...", target: "gpt-4o-mini" })`
- **THEN** the proxy routes the request to the specified target
- **AND** the call counts toward the `max_calls` limit

#### Scenario: Code judge uses default target when not specified
- **GIVEN** a code judge is running with target proxy access
- **WHEN** the script calls `target.invoke({ question: "..." })` without a `target` parameter
- **THEN** the proxy uses the default target (from `judge_target` or main target)

#### Scenario: Code judge specifies unknown target
- **GIVEN** a code judge is running with target proxy access
- **WHEN** the script calls `target.invoke({ question: "...", target: "nonexistent" })`
- **THEN** the proxy responds with HTTP 400 and an error message listing available targets

### Requirement: SDK Target Proxy Capabilities
The `@agentv/eval` SDK SHALL expose target proxy info and override capabilities.

#### Scenario: SDK provides getInfo method
- **GIVEN** a code judge imports `createTargetClient` from `@agentv/eval`
- **WHEN** the script calls `target.getInfo()`
- **THEN** it returns a typed object with `targetName`, `maxCalls`, `callCount`, and `availableTargets`

#### Scenario: SDK invoke accepts optional target parameter
- **GIVEN** a code judge creates a target client
- **WHEN** calling `target.invoke({ question, target })`
- **THEN** the `target` parameter is included in the request to the proxy

### Requirement: Code Judge Result Details Passthrough

The system SHALL support optional structured details emitted by a `code_judge` evaluator and preserve them in evaluation outputs.

#### Scenario: Code judge returns details
- **GIVEN** an eval case includes a `code_judge` evaluator
- **AND** the code judge script outputs a valid result object including `score` and optional `details`
- **WHEN** the evaluation runtime parses the result
- **THEN** the evaluator result in `evaluator_results` includes the `details` payload
- **AND** the JSONL output record includes the same `details` payload under that evaluator result

#### Scenario: Code judge omits details
- **GIVEN** an eval case includes a `code_judge` evaluator
- **AND** the code judge script outputs a valid result object with only `score`/`hits`/`misses`/`reasoning`
- **WHEN** the evaluation runtime parses the result
- **THEN** evaluation output is unchanged compared to prior behavior (no `details` field added)

#### Scenario: Details payload is not valid JSON
- **GIVEN** a code judge script outputs a result with a non-JSON `details` payload
- **WHEN** the evaluation runtime parses the result
- **THEN** the evaluator result is treated as a failure with `score: 0` and an actionable error message

---

