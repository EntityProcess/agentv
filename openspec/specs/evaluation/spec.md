# Spec: Evaluation Capability

## Purpose
Defines the core evaluation runtime: loading eval cases, formatting prompts, invoking providers (including batch-capable and agent-style providers), running evaluators, and handling retries and guideline resolution.
## Requirements
### Requirement: Test Case Execution

The system SHALL capture provider traces (when available) and make them available to evaluators and output writers.

#### Scenario: Provider returns a trace
- **WHEN** a provider invocation completes successfully
- **AND** the provider response includes a trace payload
- **THEN** the system captures the trace for that eval case attempt
- **AND** computes a `trace_summary` with `eventCount`, `toolNames`, `toolCallsByName`, and `errorCount`
- **AND** makes `candidate_trace` and `candidate_trace_summary` available to evaluators

#### Scenario: Provider does not support traces
- **WHEN** a provider invocation completes successfully
- **AND** the provider response includes no trace payload
- **THEN** evaluation proceeds as normal
- **AND** `candidate_trace` and `candidate_trace_summary` are `null` in evaluator context

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

