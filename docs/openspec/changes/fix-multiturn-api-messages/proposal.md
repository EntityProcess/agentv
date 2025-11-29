# Fix Multi-Turn Message API Delivery

## Problem Statement

Currently, multi-turn conversations with role markers (`[System]:`, `[User]:`, `[Assistant]:`) are formatted for human readability but sent to LLM APIs as flat text in a single user message. This breaks the conversational context that LLMs need to understand multi-turn interactions.

### Current Behavior

1. `buildPromptInputs()` in `yaml-parser.ts` generates formatted text with role markers when multi-turn structure is detected
2. This formatted text is stored in `request.question` field
3. Providers receive the flattened string and send it as a single user message:
   ```typescript
   const prompt: ChatPrompt = [
     { role: "system", content: systemContent },
     { role: "user", content: request.question }  // ← Contains role markers as plain text!
   ];
   ```
4. LLMs receive text like `"[User]:\nDebug this...\n[Assistant]:\nI can help..."` but don't recognize it as separate conversation turns

### Impact

- Multi-turn conversations (debugging sessions, iterative refinement) lose their conversational structure
- LLMs cannot access their own previous responses in the conversation history
- The `[Assistant]:` content from `input_messages` is treated as user-provided text rather than the model's own response
- This defeats the purpose of multi-turn support added in `add-multiturn-messages`

### Root Cause

The architecture has two conflicting responsibilities:
1. **Logging/Debugging**: Role markers provide human-readable output in result files
2. **API Communication**: LLM APIs need structured `{ role, content }` arrays

Currently, `buildPromptInputs()` optimizes for #1 (logging) but breaks #2 (API calls).

## Proposed Solution

Pass the original structured `input_messages` from `EvalCase` through to providers via `ProviderRequest.chatPrompt`, and use role markers only for logging/debugging output.

### Key Changes

1. **Add `chatPrompt` to `ProviderRequest`**: Populate it in `yaml-parser.ts` (via `buildPromptInputs`) and pass it through `orchestrator.ts`
2. **Update `buildChatPrompt()` in providers**: Check for `request.chatPrompt` first; if present, use it to build the proper message array
3. **Keep role markers for logging**: The formatted `question` field remains for human-readable output in result files
4. **Handle guidelines properly**: Extract guideline files into the system message, embed regular files inline in their respective turns

### Provider Compatibility

- **Ax-based providers** (Azure, Anthropic, Gemini): Update `buildChatPrompt()` to convert `input_messages` to `ChatPrompt` format
- **VS Code provider**: Already sends files as attachments; role markers handled by VS Code itself
- **Codex provider**: Similar to VS Code, uses batch dispatch
- **CLI provider**: Pass-through, no changes needed

## Success Criteria

1. Multi-turn conversations appear as separate message objects in LLM API requests
2. Assistant messages from `input_messages` appear with `role: "assistant"` in the API call
3. Existing single-turn evals continue to work unchanged
4. Role markers remain in `raw_request.question` for debugging/logging
5. All existing tests pass
6. New tests verify proper message structure in provider requests

## Out of Scope

- Changing the role marker format (`[Role]:`)
- Modifying the YAML schema for `input_messages`
- Optimizing message handling performance
- Supporting streaming responses

## Related Changes

- Depends on: `add-multiturn-messages` (provides the multi-turn message infrastructure)
- Enables: Proper LLM multi-turn conversation support for debugging, iterative refinement, and context-aware tasks
