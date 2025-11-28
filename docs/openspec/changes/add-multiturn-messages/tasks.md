## 1. Implementation

- [ ] 1.1 Add conversational structure detection logic:
  - [ ] Check if any non-user messages (assistant, tool, etc.) are present in input_messages
  - [ ] Count messages with text content (after extracting .instructions.md to guidelines)
  - [ ] Determine if role markers are needed based on these conditions
- [ ] 1.2 Implement message formatting function with role markers (`[System]:`, `[User]:`, `[Assistant]:`, `[Tool]:`)
- [ ] 1.3 Update request builder to use multi-turn formatting when applicable, flat format otherwise
- [ ] 1.4 Ensure `.instructions.md` files are extracted to guidelines field (existing behavior)
- [ ] 1.5 Embed non-instruction file attachments inline within their respective turns

## 2. Testing

- [ ] 2.1 Verify `coding-multiturn-debug-session` from example-eval.yaml works correctly with role markers
- [ ] 2.2 Regression test: confirm existing single-turn evals produce unchanged output (no role markers)
- [ ] 2.3 Test system file + user message scenario produces no role markers
- [ ] 2.4 Add unit tests for conversational structure detection logic
- [ ] 2.5 Add unit tests for turn formatting (single-turn, multi-turn, file handling, mixed scenarios)
- [ ] 2.6 Test with multiple providers (Azure, default) to ensure compatibility

## 3. Documentation

- [ ] 3.1 Update eval schema documentation to explain multi-turn formatting
- [ ] 3.2 Add examples showing the formatted output for debugging purposes
- [ ] 3.3 Document the turn marker convention (`[Role]:` format)
