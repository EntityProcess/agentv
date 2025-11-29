## 1. Core Implementation

- [x] 1.1 Update `buildPromptInputs` in `yaml-parser.ts`
  - [x] Update return type to include `chatPrompt?: ChatPrompt`
  - [x] Implement message conversion logic using `input_messages` and `segmentsByMessage`
  - [x] Build consolidated system message (metadata + guidelines + initial system messages)
  - [x] Convert subsequent system messages to assistant role with `[System]:` prefix
  - [x] Convert each message, embedding non-guideline files inline (using `segmentsByMessage`)
  - [x] Add reference markers for guideline files
  - [x] Handle empty messages and edge cases

- [x] 1.2 Populate `chatPrompt` in `ProviderRequest` creation
  - [x] In `runBatchEvaluation()`: use `promptInputs.chatPrompt` when creating batch requests
  - [x] In `runEvalCase()`: use `promptInputs.chatPrompt` when creating individual requests
  - [x] Ensure `chatPrompt` is passed to `ProviderRequest`

- [x] 1.3 Update `buildChatPrompt()` in `ax.ts`
  - [x] Check for `request.chatPrompt` first
  - [x] If present, merge with system message (guidelines already included)
  - [x] Fall back to legacy behavior (`request.question`) if `chatPrompt` absent
  - [x] Ensure backward compatibility

- [x] 1.4 Update other Ax-based providers
  - [x] Verify `AzureProvider` inherits updated `buildChatPrompt()` behavior
  - [x] Verify `AnthropicProvider` inherits updated `buildChatPrompt()` behavior
  - [x] Verify `GeminiProvider` inherits updated `buildChatPrompt()` behavior

## 2. Testing

- [x] 2.1 Unit tests for message conversion
  - [x] Test single-turn conversion (no chatPrompt needed)
  - [x] Test multi-turn with system + user + assistant messages
  - [x] Test guideline extraction into system message
  - [x] Test non-guideline file embedding
  - [x] Test empty message filtering
  - [x] Test reference markers for guideline files

- [x] 2.2 Integration tests for provider request generation
  - [x] Test `ProviderRequest` includes proper `chatPrompt` for multi-turn
  - [x] Test `chatPrompt` is undefined for simple single-turn cases
  - [x] Test system message construction with guidelines
  - [x] Test file content embedding in messages

- [x] 2.3 Provider-specific tests
  - [x] Test Ax provider `buildChatPrompt()` uses `chatPrompt` when available
  - [x] Test Ax provider falls back to `question` when `chatPrompt` absent
  - [x] Test Azure provider multi-turn message delivery
  - [x] Verify VS Code provider unchanged (uses file attachments)

- [x] 2.4 End-to-end tests
  - [x] Run `coding-multiturn-debug-session` eval
  - [x] Verify API request has proper message array (multiple role entries)
  - [x] Confirm assistant messages appear with `role: "assistant"`
  - [x] Verify guideline content in system message
  - [x] Check role markers still appear in `raw_request.question` for logging

- [x] 2.5 Regression tests
  - [x] Run existing single-turn evals
  - [x] Confirm unchanged behavior (no chatPrompt, uses question field)
  - [x] Verify all existing tests pass
  - [x] Check example evals from `docs/examples/simple/evals/`

## 3. Documentation

- [x] 3.1 Update provider documentation
  - [x] Document `chatPrompt` field usage in `ProviderRequest`
  - [x] Explain when `chatPrompt` is populated vs when it's absent
  - [x] Clarify relationship between `question` (logging) and `chatPrompt` (API)

- [x] 3.2 Update design documentation
  - [x] Document message conversion logic
  - [x] Explain guideline extraction strategy
  - [x] Show examples of converted message arrays

- [x] 3.3 Update architecture notes
  - [x] Note the dual-purpose architecture (logging vs API)
  - [x] Document provider-specific handling
  - [x] Explain backward compatibility approach

## 4. Validation & Cleanup

- [x] 4.1 Validate implementation
  - [x] Review all changed files for consistency
  - [x] Check error handling for edge cases
  - [x] Verify TypeScript types are correct
  - [x] Ensure no breaking changes to public APIs

- [x] 4.2 Performance check
  - [x] Verify no significant performance regression
  - [x] Check memory usage with large conversations
  - [x] Test with various message array sizes

- [x] 4.3 Code review preparation
  - [x] Add inline comments for complex logic
  - [x] Ensure all tests have clear descriptions
  - [x] Verify code follows TypeScript 5.x guidelines
  - [x] Run full test suite before committing
