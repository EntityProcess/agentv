## 1. Implementation

- [x] 1.1 Add conversational structure detection logic:
  - [x] Check if any non-user messages (assistant, tool, etc.) are present in input_messages
  - [x] Count messages with text content (after extracting .instructions.md to guidelines)
  - [x] Determine if role markers are needed based on these conditions
  - [x] **SIMPLIFIED**: Removed complex role-specific counting, now counts all messages uniformly
- [x] 1.2 Implement message formatting function with role markers (`[System]:`, `[User]:`, `[Assistant]:`, `[Tool]:`)
- [x] 1.3 Update request builder to use multi-turn formatting when applicable, flat format otherwise
- [x] 1.4 Ensure `.instructions.md` files are extracted to guidelines field (existing behavior)
- [x] 1.5 Embed non-instruction file attachments inline within their respective turns

## 2. Testing

- [x] 2.1 Verify `coding-multiturn-debug-session` from example-eval.yaml works correctly with role markers
- [x] 2.2 Regression test: confirm existing single-turn evals produce unchanged output (no role markers)
- [x] 2.3 Test system file + user message scenario produces no role markers
- [x] 2.4 Add unit tests for conversational structure detection logic
- [x] 2.5 Add unit tests for turn formatting (single-turn, multi-turn, file handling, mixed scenarios)
- [x] 2.6 Test with multiple providers (Azure, default) to ensure compatibility

## 3. Documentation

- [ ] 3.1 Update eval schema documentation to explain multi-turn formatting
- [ ] 3.2 Add examples showing the formatted output for debugging purposes
- [ ] 3.3 Document the turn marker convention (`[Role]:` format)
