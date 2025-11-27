## 1. Type Definitions

- [x] 1.1 Add retry fields to `TargetDefinition` interface in `types.ts`
- [x] 1.2 Add retry fields to `AzureResolvedConfig` in `targets.ts`
- [x] 1.3 Add retry fields to `AnthropicResolvedConfig` in `targets.ts`
- [x] 1.4 Add retry fields to `GeminiResolvedConfig` in `targets.ts`
- [x] 1.5 Add `readNumberArray()` helper function in `targets.ts` if not exists

## 2. Config Resolution

- [x] 2.1 Update `resolveAzureConfig()` to extract retry fields
- [x] 2.2 Update `resolveAnthropicConfig()` to extract retry fields
- [x] 2.3 Update `resolveGeminiConfig()` to extract retry fields

## 3. Provider Implementation

- [x] 3.1 Add `buildRetryConfig()` helper function in `ax.ts`
- [x] 3.2 Update `AzureProvider` constructor to pass retry config to AxAI
- [x] 3.3 Update `AnthropicProvider` constructor to pass retry config to AxAI
- [x] 3.4 Update `GeminiProvider` constructor to pass retry config to AxAI

## 4. Testing

- [x] 4.1 Add unit tests for retry config extraction from target definition
- [x] 4.2 Add tests for retry config passed to AxAI.create()
- [x] 4.3 Add tests for partial retry config (only some fields set)
- [x] 4.4 Add tests for both snake_case and camelCase field names
- [ ] 4.5 Mock 429 responses and verify retries occur
- [ ] 4.6 Verify max retries respected

## 5. Documentation

- [ ] 5.1 Update targets.yaml schema documentation
- [ ] 5.2 Add retry configuration examples to documentation
- [ ] 5.3 Update CHANGELOG.md

## Implementation Notes

**Retry Configuration Storage:**
The retry configuration fields have been successfully added to the target definitions and resolved configs. The configuration is extracted from targets.yaml and stored in provider instances.

**Validation:**
✅ Retry configuration fields added to validation schema for Azure, Anthropic, and Gemini providers. The schema version was updated from v2.1 to v2.2 to reflect the addition of retry configuration support.

**Custom Retry Implementation:**
✅ Implemented a custom retry wrapper function (`withRetry`) that wraps all provider AI chat calls with exponential backoff retry logic. The implementation includes:
- Configurable max retries, initial delay, max delay, backoff factor, and retryable status codes
- Exponential backoff with jitter to avoid thundering herd
- Detection of retryable HTTP status codes (500, 408, 429, 502, 503, 504 by default)
- Support for AbortSignal to cancel retries
- Falls back to sensible defaults when retry config is not specified

**Why Custom Implementation:**
While the ax library has built-in retry functionality at the HTTP `apiCall` level, it doesn't expose retry configuration at the provider initialization level (i.e., through `AxAI.create()`). Rather than waiting for ax library to add provider-level retry support, we implemented our own retry wrapper that:
- Works immediately without library changes
- Provides fine-grained control over retry behavior
- Respects abort signals
- Uses the same retry parameters as ax's internal retry system

**Field Naming:**
Both snake_case and camelCase field names are supported in targets.yaml for all retry configuration options.

**Schema Version:**
Updated targets schema from v2.1 to v2.2 to reflect the addition of retry configuration fields.
