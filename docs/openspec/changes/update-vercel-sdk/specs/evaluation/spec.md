## MODIFIED Requirements

### Requirement: Provider Integration

The system SHALL support multiple LLM providers with environment-based configuration and optional retry settings, implemented via the Vercel AI SDK for cloud LLMs (Azure OpenAI, Anthropic, Gemini) while preserving existing `targets.yaml` and environment variable contracts.

#### Scenario: Azure OpenAI provider via Vercel AI SDK

- **WHEN** a test case uses the "azure-openai" or "azure" provider
- **THEN** the system reads `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, and `AZURE_DEPLOYMENT_NAME` from environment (or the corresponding `targets.yaml` entries)
- **AND** constructs a non-streaming chat request using the shared `chatPrompt` contract
- **AND** invokes Azure OpenAI through the Vercel AI SDK with the configured settings
- **AND** applies any retry configuration specified in the target definition on top of SDK calls
- **AND** returns a `ProviderResponse` whose `text` field contains the final assistant message and `usage` captures token metrics when available.

#### Scenario: Anthropic provider via Vercel AI SDK

- **WHEN** a test case uses the "anthropic" provider
- **THEN** the system reads `ANTHROPIC_API_KEY` and model configuration from environment or `targets.yaml`
- **AND** constructs a non-streaming chat request using the shared `chatPrompt` contract
- **AND** invokes Anthropic Claude through the Vercel AI SDK with the configured settings
- **AND** applies any retry configuration specified in the target definition on top of SDK calls
- **AND** returns a `ProviderResponse` whose `text` field contains the final assistant message and `usage` captures token metrics when available.

#### Scenario: Google Gemini provider via Vercel AI SDK

- **WHEN** a test case uses the "gemini", "google", or "google-gemini" provider
- **THEN** the system reads `GOOGLE_API_KEY` from environment and optionally reads a model override (e.g., `GOOGLE_GEMINI_MODEL`) or `targets.yaml`
- **AND** constructs a non-streaming chat request using the shared `chatPrompt` contract
- **AND** invokes Google Gemini through the Vercel AI SDK with the configured settings
- **AND** applies any retry configuration specified in the target definition on top of SDK calls
- **AND** returns a `ProviderResponse` whose `text` field contains the final assistant message and `usage` captures token metrics when available.

### Requirement: Provider Retry Configuration

The system SHALL support optional retry configuration for Azure, Anthropic, and Gemini providers to handle transient errors and rate limiting, applying the configuration consistently on top of Vercel AI SDK calls.

#### Scenario: Configure retry in targets.yaml with Vercel AI SDK

- **WHEN** a target definition includes retry configuration fields
- **THEN** the system extracts retry parameters from the target
- **AND** wraps Vercel AI SDK calls with the same retry policy (including backoff and jitter)
- **AND** classifies HTTP and network errors using status codes and SDK error types before deciding whether to retry.

#### Scenario: Exponential backoff with default config (Vercel AI)

- **WHEN** a provider request returns HTTP 429 (Too Many Requests) or another configured retryable status via the Vercel AI SDK
- **AND** `max_retries` is not configured (defaults to 3)
- **THEN** the system retries with exponential backoff starting at 1000ms
- **AND** delays are randomized between 75-125% to prevent thundering herd
- **AND** maximum delay is capped at 60000ms (1 minute).

#### Scenario: Custom retry configuration with Vercel AI

- **WHEN** target specifies `max_retries: 5`, `retry_initial_delay_ms: 2000`, `retry_max_delay_ms: 120000`
- **AND** a request returns a retryable status via the Vercel AI SDK
- **THEN** the system retries up to 5 times
- **AND** starts with 2000ms delay, doubling each retry up to 120000ms maximum.

#### Scenario: Non-retryable authentication errors

- **WHEN** a request returns HTTP 401 or 403 from the Vercel AI SDK (authentication/authorization errors)
- **THEN** the system does not retry regardless of retry configuration
- **AND** returns the error immediately with a clear message.
