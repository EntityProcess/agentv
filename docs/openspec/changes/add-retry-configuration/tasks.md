## 1. Type Definitions

- [ ] 1.1 Add retry fields to `TargetDefinition` interface in `types.ts`
- [ ] 1.2 Add retry fields to `AzureResolvedConfig` in `targets.ts`
- [ ] 1.3 Add retry fields to `AnthropicResolvedConfig` in `targets.ts`
- [ ] 1.4 Add retry fields to `GeminiResolvedConfig` in `targets.ts`
- [ ] 1.5 Add `readNumberArray()` helper function in `targets.ts` if not exists

## 2. Config Resolution

- [ ] 2.1 Update `resolveAzureConfig()` to extract retry fields
- [ ] 2.2 Update `resolveAnthropicConfig()` to extract retry fields
- [ ] 2.3 Update `resolveGeminiConfig()` to extract retry fields

## 3. Provider Implementation

- [ ] 3.1 Add `buildRetryConfig()` helper function in `ax.ts`
- [ ] 3.2 Update `AzureProvider` constructor to pass retry config to AxAI
- [ ] 3.3 Update `AnthropicProvider` constructor to pass retry config to AxAI
- [ ] 3.4 Update `GeminiProvider` constructor to pass retry config to AxAI

## 4. Testing

- [ ] 4.1 Add unit tests for retry config extraction from target definition
- [ ] 4.2 Add tests for retry config passed to AxAI.create()
- [ ] 4.3 Add tests for partial retry config (only some fields set)
- [ ] 4.4 Add tests for both snake_case and camelCase field names
- [ ] 4.5 Mock 429 responses and verify retries occur
- [ ] 4.6 Verify max retries respected

## 5. Documentation

- [ ] 5.1 Update targets.yaml schema documentation
- [ ] 5.2 Add retry configuration examples to documentation
- [ ] 5.3 Update CHANGELOG.md
