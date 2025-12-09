# Spec: Evaluation Capability

## Purpose
Defines the core evaluation runtime: loading eval cases, formatting prompts, invoking providers (including batch-capable and agent-style providers), running evaluators, and handling retries and guideline resolution.
## Requirements
### Requirement: Test Case Execution

The system SHALL execute eval cases using the resolved provider with retries and optional concurrency.

#### Scenario: Successful test execution

- **WHEN** a test case is executed with a valid provider configuration
- **THEN** the provider receives the formatted `question` plus `guidelines` (and a `chatPrompt` for multi-turn LM providers) along with attachment file paths
- **AND** the provider response text is captured and returned for scoring
- **AND** execution uses the configured concurrency (`maxConcurrency` override, else target `workers`, else 1)

#### Scenario: Timeout with retry

- **WHEN** a provider invocation times out
- **AND** retry budget remains
- **THEN** the system retries the invocation
- **AND** increments the attempt counter

#### Scenario: Maximum retries exceeded

- **WHEN** a provider invocation exhausts retries or never yields a response
- **THEN** the system returns an error result for that eval case with the captured error message
- **AND** continues executing other eval cases without blocking

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

The system SHALL execute configured evaluators per eval case and aggregate scores when multiple evaluators are present.

#### Scenario: Aggregating multiple evaluators

- **WHEN** an eval case declares an `evaluators` array with multiple entries
- **THEN** each evaluator runs in order, producing per-evaluator results
- **AND** the overall score is the mean of individual evaluator scores with hits/misses concatenated and reasoning combined per evaluator

#### Scenario: Custom prompt for LLM judge

- **WHEN** an `llm_judge` evaluator includes `prompt` or `promptPath`
- **THEN** the evaluator loads that prompt override and uses it instead of the default template when calling the judge provider

#### Scenario: Code evaluator execution

- **WHEN** an eval case includes a `code` evaluator
- **THEN** the evaluator resolves the script path (respecting custom `cwd`), pipes the eval context as JSON to stdin, and parses JSON output for score, hits, misses, and reasoning
- **AND** returns `score: 0` with an error miss entry if the script errors or times out

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
