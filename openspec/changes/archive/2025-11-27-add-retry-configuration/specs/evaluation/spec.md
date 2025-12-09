## ADDED Requirements

### Requirement: Provider Retry Configuration

The system SHALL support optional retry configuration for Azure, Anthropic, and Gemini providers to handle transient errors and rate limiting.

#### Scenario: Configure retry in targets.yaml

- **WHEN** a target definition includes retry configuration fields
- **THEN** the system extracts retry parameters from the target
- **AND** passes the retry configuration to the underlying AxAI provider
- **AND** the provider retries failed requests according to the configuration

#### Scenario: Exponential backoff with default config

- **WHEN** a provider request returns HTTP 429 (Too Many Requests)
- **AND** max_retries is not configured (defaults to 3)
- **THEN** the system retries with exponential backoff starting at 1000ms
- **AND** delays are randomized between 75-125% to prevent thundering herd
- **AND** maximum delay is capped at 60000ms (1 minute)

#### Scenario: Custom retry configuration

- **WHEN** target specifies max_retries: 5, retry_initial_delay_ms: 2000, retry_max_delay_ms: 120000
- **AND** a request returns HTTP 429
- **THEN** the system retries up to 5 times
- **AND** starts with 2000ms delay, doubling each retry up to 120000ms maximum

#### Scenario: Custom retryable status codes

- **WHEN** target specifies retry_status_codes: [429, 503]
- **AND** a request returns HTTP 500
- **THEN** the system does not retry the request
- **AND** returns the error immediately

#### Scenario: Disable retries

- **WHEN** target specifies max_retries: 0
- **AND** a request returns HTTP 429
- **THEN** the system does not retry
- **AND** returns the error immediately

#### Scenario: Non-retryable errors

- **WHEN** a request returns HTTP 401 or 403 (authentication/authorization errors)
- **THEN** the system does not retry regardless of retry configuration
- **AND** returns the error immediately

#### Scenario: Both snake_case and camelCase field names

- **WHEN** target uses snake_case field names (max_retries, retry_initial_delay_ms)
- **OR** target uses camelCase field names (maxRetries, retryInitialDelayMs)
- **THEN** the system correctly extracts and applies the retry configuration

## MODIFIED Requirements

### Requirement: Provider Integration

The system SHALL support multiple LLM providers with environment-based configuration and optional retry settings.

#### Scenario: Azure OpenAI provider

- **WHEN** a test case uses the "azure-openai" provider
- **THEN** the system reads `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, and `AZURE_DEPLOYMENT_NAME` from environment
- **AND** invokes Azure OpenAI with the configured settings
- **AND** applies any retry configuration specified in the target definition

#### Scenario: Anthropic provider

- **WHEN** a test case uses the "anthropic" provider
- **THEN** the system reads `ANTHROPIC_API_KEY` from environment
- **AND** invokes Anthropic Claude with the configured settings
- **AND** applies any retry configuration specified in the target definition

#### Scenario: Google Gemini provider

- **WHEN** a test case uses the "gemini" provider
- **THEN** the system reads `GOOGLE_API_KEY` from environment
- **AND** optionally reads `GOOGLE_GEMINI_MODEL` to override the default model
- **AND** invokes Google Gemini with the configured settings
- **AND** applies any retry configuration specified in the target definition

#### Scenario: VS Code Copilot provider

- **WHEN** a test case uses the "vscode-copilot" provider
- **THEN** the system generates a structured prompt file with preread block and SHA tokens
- **AND** invokes the subagent library to execute the prompt
- **AND** captures the Copilot response

#### Scenario: Codex CLI provider

- **WHEN** a test case uses the "codex" provider
- **THEN** the system locates the Codex CLI executable (default `codex`, overrideable via the target)
- **AND** it mirrors guideline and attachment files into a scratch workspace, emitting the same preread block links used by the VS Code provider so Codex opens every referenced file before answering
- **AND** it renders the eval prompt into a single string and launches `codex exec --json` plus any configured profile, model, approval preset, and working-directory overrides defined on the target
- **AND** it verifies the Codex executable is available while delegating profile/config resolution to the CLI itself
- **AND** it parses the emitted JSONL event stream to capture the final assistant message as the provider response, attaching stdout/stderr when the CLI exits non-zero or returns malformed JSON

#### Scenario: Mock provider for dry-run

- **WHEN** a test case uses the "mock" provider or dry-run is enabled
- **THEN** the system returns a predefined mock response
- **AND** does not make external API calls
