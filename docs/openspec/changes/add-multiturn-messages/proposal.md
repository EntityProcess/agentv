# Change: Support Multi-Turn Input Messages

## Why

Currently, AgentV flattens all `input_messages` (system, user, and assistant turns) into a single `question` field when constructing the `raw_request`. This limits the ability to evaluate multi-turn conversations where intermediate assistant responses are part of the input context. Example use cases include:

- Testing debugging conversations where the AI asks clarifying questions before providing a solution
- Evaluating conversational agents that require context from previous turns
- Assessing how well an agent handles follow-up questions or iterative refinement

The `coding-multiturn-debug-session` example in `example-eval.yaml` demonstrates this need: it includes multiple user-assistant exchanges in `input_messages`, but the current implementation cannot properly represent this conversation history to the model.

## What Changes

- Modify request formatting to support multi-turn message histories
- Maintain the existing `question` field for backward compatibility with single-turn evaluations
- Add role markers (`[System]:`, `[User]:`, `[Assistant]:`, `[Tool]:`) only when there's actual conversational structure:
  - When non-user messages (assistant, tool, etc.) are present in `input_messages`
  - When multiple messages have text content (after extracting `.instructions.md` files to guidelines)
- Support both simple (single user message) and complex (multi-turn) conversation patterns
- Preserve existing flat format for common patterns like system file + user text

## Impact

- Affected specs: `eval-execution` (new capability)
- Affected code: Request builder/formatter that converts `input_messages` to provider format
- **Breaking**: None - existing single-turn evaluations continue using flattened `question` format
- **Enhancement**: Multi-turn conversations now properly preserve turn boundaries and role information
