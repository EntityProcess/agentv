# Retry Configuration

This feature adds optional retry configuration fields to `targets.yaml` to handle HTTP 429 rate limiting and transient errors automatically.

## Configuration Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `max_retries` | number | 3 | Maximum retry attempts |
| `retry_initial_delay_ms` | number | 1000 | Initial delay before first retry (ms) |
| `retry_max_delay_ms` | number | 60000 | Maximum delay cap (ms) |
| `retry_backoff_factor` | number | 2 | Exponential backoff multiplier |
| `retry_status_codes` | number[] | [500,408,429,502,503,504] | HTTP status codes to retry |

All fields are optional. Both snake_case and camelCase field names are supported.

## Retry Behavior

The retry delay uses exponential backoff with jitter (75-125% randomization):

```
delay = min(max_delay, initial_delay × backoff_factor^attempt) × random(0.75-1.25)
```

Jitter prevents "thundering herd" where multiple clients retry simultaneously.

### Retryable Status Codes (Default)

- **408** - Request Timeout
- **429** - Too Many Requests (rate limiting)
- **500** - Internal Server Error
- **502** - Bad Gateway
- **503** - Service Unavailable
- **504** - Gateway Timeout

### Non-retryable Errors

These errors always fail immediately: 401, 403, 400, 404

## Examples

### Production (Recommended)

```yaml
targets:
  - name: azure_production
    provider: azure
    endpoint: ${{ AZURE_OPENAI_ENDPOINT }}
    api_key: ${{ AZURE_OPENAI_API_KEY }}
    model: ${{ AZURE_DEPLOYMENT_NAME }}
    max_retries: 5
    retry_initial_delay_ms: 2000
    retry_max_delay_ms: 120000
    retry_backoff_factor: 2
```

**Expected retry timeline:** ~2s, ~4s, ~8s, ~16s, ~32s (total: ~1 minute)

### Development (Fast Fail)

```yaml
targets:
  - name: azure_dev
    provider: azure
    endpoint: ${{ AZURE_OPENAI_ENDPOINT }}
    api_key: ${{ AZURE_OPENAI_API_KEY }}
    model: ${{ AZURE_DEPLOYMENT_NAME }}
    max_retries: 2
    retry_initial_delay_ms: 500
    retry_max_delay_ms: 5000
```

### Batch Jobs (Aggressive)

```yaml
targets:
  - name: azure_batch
    provider: azure
    endpoint: ${{ AZURE_OPENAI_ENDPOINT }}
    api_key: ${{ AZURE_OPENAI_API_KEY }}
    model: ${{ AZURE_DEPLOYMENT_NAME }}
    max_retries: 10
    retry_initial_delay_ms: 5000
    retry_max_delay_ms: 300000
    retry_backoff_factor: 2.5
```

### camelCase Field Names

```yaml
targets:
  - name: gemini_prod
    provider: gemini
    api_key: ${{ GOOGLE_API_KEY }}
    model: gemini-2.5-flash
    maxRetries: 5
    retryInitialDelayMs: 2000
    retryMaxDelayMs: 120000
    retryBackoffFactor: 2.5
```

## Implementation Status

### ✅ Completed
- Retry configuration fields added to target definitions
- Configuration extracted and validated from targets.yaml
- Both snake_case and camelCase field names supported
- Retry config stored in provider instances
- Unit tests for configuration extraction

### ⏳ Pending
- **Ax library integration**: The underlying @ax-llm/ax library currently does not expose retry configuration at the provider initialization level. The retry configuration is stored in providers but not yet applied to actual API calls.
- When ax library adds support for provider-level retry configuration, the stored config will be passed through to enable automatic retries.

## Affected Providers

- **azure** (Azure OpenAI)
- **anthropic** (Anthropic Claude)
- **gemini** (Google Gemini)

Other providers (codex, mock, vscode, cli) do not currently support retry configuration as they don't use the ax library's HTTP retry mechanism.

## Testing

Run retry configuration tests:

```bash
pnpm test retry-config
```

All tests verify:
- Configuration extraction with snake_case fields
- Configuration extraction with camelCase fields
- Partial configuration support
- Field preference (snake_case over camelCase)
- Array validation for retry_status_codes
- Empty arrays handled correctly
