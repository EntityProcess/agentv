# Add Retry Configuration

## Summary
Add optional retry configuration fields to targets.yaml to handle HTTP 429 rate limiting and transient errors automatically using the underlying ax library's retry capabilities.

## Problem
Evaluations fail immediately when LLM providers return HTTP 429 "Too Many Requests" errors, wasting progress and requiring manual intervention to re-run failed evaluations.

## Solution
Expose the ax library's existing retry configuration through targets.yaml, allowing users to configure retry behavior per target including:
- Maximum retry attempts
- Initial delay and exponential backoff
- Maximum delay cap
- HTTP status codes to retry

### Configuration Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `max_retries` | number | 3 | Maximum retry attempts |
| `retry_initial_delay_ms` | number | 1000 | Initial delay before first retry (ms) |
| `retry_max_delay_ms` | number | 60000 | Maximum delay cap (ms) |
| `retry_backoff_factor` | number | 2 | Exponential backoff multiplier |
| `retry_status_codes` | number[] | [500,408,429,502,503,504] | HTTP status codes to retry |

### Example Configuration

**Production (Recommended):**
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

Expected retry timeline: ~2s, ~4s, ~8s, ~16s, ~32s (total: ~1 minute)

**Development (Fast Fail):**
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

**Batch Jobs (Aggressive):**
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

### Retry Behavior

The retry delay uses exponential backoff with jitter (75-125% randomization):

```
delay = min(max_delay, initial_delay × backoff_factor^attempt) × random(0.75-1.25)
```

Jitter prevents "thundering herd" where multiple clients retry simultaneously.

**Retryable Status Codes (Default):**
- 408 - Request Timeout
- 429 - Too Many Requests (rate limiting)
- 500 - Internal Server Error
- 502 - Bad Gateway
- 503 - Service Unavailable
- 504 - Gateway Timeout

**Non-retryable errors** (always fail immediately): 401, 403, 400, 404

## Impact
- Affected specs: `evaluation` (provider integration)
- Affected code: `packages/core/src/evaluation/providers/`
  - `types.ts` - Add retry fields to TargetDefinition interface
  - `targets.ts` - Add retry fields to resolved config types and extraction logic
  - `ax.ts` - Pass retry config to AxAI.create()

## Dependencies
None - leverages existing ax library retry implementation.
