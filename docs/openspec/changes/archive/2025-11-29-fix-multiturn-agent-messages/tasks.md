## 1. Implementation

- [x] 1.1 Add conversational structure detection logic:
  - [x] Check if any non-user messages (assistant, tool, etc.) are present in input_messages
  - [x] Count messages with text content (after extracting .instructions.md to guidelines)
  - [x] Determine if role markers are needed based on these conditions
  - [x] **SIMPLIFIED**: Removed complex role-specific counting, now counts all messages uniformly
  - [x] **REFACTORED**: Process-first architecture - segments are generated before deciding role markers
- [x] 1.2 Implement message formatting function with role markers (`[System]:`, `[User]:`, `[Assistant]:`, `[Tool]:`)
- [x] 1.3 Update request builder to use multi-turn formatting when applicable, flat format otherwise
- [x] 1.4 Ensure `.instructions.md` files are extracted to guidelines field (existing behavior)
- [x] 1.5 Embed non-instruction file attachments inline within their respective turns
- [x] 1.6 Preserve role markers in evaluator prompts:
  - [x] Ensure `buildQualityPrompt` uses the formatted `question` with role markers when applicable
  - [x] Verify evaluator receives same conversational structure as the candidate LLM
  - [x] Add tests confirming evaluator prompt contains role markers for multi-turn conversations

## 2. Testing

- [x] 2.1 Verify `coding-multiturn-debug-session` from example-eval.yaml works correctly with role markers
- [x] 2.2 Regression test: confirm existing single-turn evals produce unchanged output (no role markers)
- [x] 2.3 Test system file + user message scenario produces no role markers
- [x] 2.4 Add unit tests for conversational structure detection logic
- [x] 2.5 Add unit tests for turn formatting (single-turn, multi-turn, file handling, mixed scenarios)
- [x] 2.6 Test with multiple providers (Azure, default) to ensure compatibility
- [x] 2.7 Verify evaluator prompts preserve role markers:
  - [x] Confirm `evaluator_raw_request.prompt` contains role markers for multi-turn conversations
  - [x] Verify single-turn evaluations produce flat format without role markers
  - [x] Test that evaluator sees same conversation structure as candidate LLM

## 3. Documentation

- [x] 3.1 Update eval schema documentation to explain multi-turn formatting
- [x] 3.2 Add examples showing the formatted output for debugging purposes
- [x] 3.3 Document the turn marker convention (`[Role]:` format)
