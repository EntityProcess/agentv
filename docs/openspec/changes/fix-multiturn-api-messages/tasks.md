## 1. Core Implementation

- [ ] 1.1 Update `buildPromptInputs` in `yaml-parser.ts`
  - [ ] Update return type to include `chatPrompt?: ChatPrompt`
  - [ ] Implement message conversion logic using `input_messages` and `segmentsByMessage`
  - [ ] Build consolidated system message (metadata + guidelines + user-defined system messages)
  - [ ] Convert each message, embedding non-guideline files inline (using `segmentsByMessage`)
  - [ ] Add reference markers for guideline files
  - [ ] Handle empty messages and edge cases

- [ ] 1.2 Populate `chatPrompt` in `ProviderRequest` creation
  - [ ] In `runBatchEvaluation()`: use `promptInputs.chatPrompt` when creating batch requests
  - [ ] In `runEvalCase()`: use `promptInputs.chatPrompt` when creating individual requests
  - [ ] Ensure `chatPrompt` is passed to `ProviderRequest`

- [ ] 1.3 Update `buildChatPrompt()` in `ax.ts`
  - [ ] Check for `request.chatPrompt` first
  - [ ] If present, merge with system message (guidelines already included)
  - [ ] Fall back to legacy behavior (`request.question`) if `chatPrompt` absent
  - [ ] Ensure backward compatibility

- [ ] 1.4 Update other Ax-based providers
  - [ ] Verify `AzureProvider` inherits updated `buildChatPrompt()` behavior
  - [ ] Verify `AnthropicProvider` inherits updated `buildChatPrompt()` behavior
  - [ ] Verify `GeminiProvider` inherits updated `buildChatPrompt()` behavior

## 2. Testing

- [ ] 2.1 Unit tests for message conversion
  - [ ] Test single-turn conversion (no chatPrompt needed)
  - [ ] Test multi-turn with system + user + assistant messages
  - [ ] Test guideline extraction into system message
  - [ ] Test non-guideline file embedding
  - [ ] Test empty message filtering
  - [ ] Test reference markers for guideline files

- [ ] 2.2 Integration tests for provider request generation
  - [ ] Test `ProviderRequest` includes proper `chatPrompt` for multi-turn
  - [ ] Test `chatPrompt` is undefined for simple single-turn cases
  - [ ] Test system message construction with guidelines
  - [ ] Test file content embedding in messages

- [ ] 2.3 Provider-specific tests
  - [ ] Test Ax provider `buildChatPrompt()` uses `chatPrompt` when available
  - [ ] Test Ax provider falls back to `question` when `chatPrompt` absent
  - [ ] Test Azure provider multi-turn message delivery
  - [ ] Verify VS Code provider unchanged (uses file attachments)

- [ ] 2.4 End-to-end tests
  - [ ] Run `coding-multiturn-debug-session` eval
  - [ ] Verify API request has proper message array (multiple role entries)
  - [ ] Confirm assistant messages appear with `role: "assistant"`
  - [ ] Verify guideline content in system message
  - [ ] Check role markers still appear in `raw_request.question` for logging

- [ ] 2.5 Regression tests
  - [ ] Run existing single-turn evals
  - [ ] Confirm unchanged behavior (no chatPrompt, uses question field)
  - [ ] Verify all existing tests pass
  - [ ] Check example evals from `docs/examples/simple/evals/`

## 3. Documentation

- [ ] 3.1 Update provider documentation
  - [ ] Document `chatPrompt` field usage in `ProviderRequest`
  - [ ] Explain when `chatPrompt` is populated vs when it's absent
  - [ ] Clarify relationship between `question` (logging) and `chatPrompt` (API)

- [ ] 3.2 Update design documentation
  - [ ] Document message conversion logic
  - [ ] Explain guideline extraction strategy
  - [ ] Show examples of converted message arrays

- [ ] 3.3 Update architecture notes
  - [ ] Note the dual-purpose architecture (logging vs API)
  - [ ] Document provider-specific handling
  - [ ] Explain backward compatibility approach

## 4. Validation & Cleanup

- [ ] 4.1 Validate implementation
  - [ ] Review all changed files for consistency
  - [ ] Check error handling for edge cases
  - [ ] Verify TypeScript types are correct
  - [ ] Ensure no breaking changes to public APIs

- [ ] 4.2 Performance check
  - [ ] Verify no significant performance regression
  - [ ] Check memory usage with large conversations
  - [ ] Test with various message array sizes

- [ ] 4.3 Code review preparation
  - [ ] Add inline comments for complex logic
  - [ ] Ensure all tests have clear descriptions
  - [ ] Verify code follows TypeScript 5.x guidelines
  - [ ] Run full test suite before committing
