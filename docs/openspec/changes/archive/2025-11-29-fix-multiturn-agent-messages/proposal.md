# Change: Support Multi-Turn Input Messages

## Why

Currently, AgentV flattens all `input_messages` (system, user, and assistant turns) into a single `question` field when constructing the `raw_request`. This causes two problems:

1. **Candidate LLM loses conversation structure**: Multi-turn conversations where intermediate assistant responses are part of the input context cannot be properly represented
2. **Evaluator loses conversation context**: When judging responses, the evaluator LLM receives a flattened blob without role markers, making it impossible to understand which parts were user questions vs. assistant responses

Example use cases that are currently broken:

- Testing debugging conversations where the AI asks clarifying questions before providing a solution
- Evaluating conversational agents that require context from previous turns
- Assessing how well an agent handles follow-up questions or iterative refinement
- Judging whether an assistant's response is appropriate given the multi-turn conversation flow

The `coding-multiturn-debug-session` example in `example-eval.yaml` demonstrates this need: it includes multiple user-assistant exchanges in `input_messages`, but the current implementation cannot properly represent this conversation history to either the candidate model or the evaluator.

## What Changes

- Modify request formatting to support multi-turn message histories for **both candidate and evaluator prompts**
- Maintain the existing `question` field for backward compatibility with single-turn evaluations
- Add role markers (`[System]:`, `[User]:`, `[Assistant]:`, `[Tool]:`) only when there's actual conversational structure:
  - When non-user messages (assistant, tool, etc.) are present in `input_messages`
  - When multiple messages have text content (after extracting `.instructions.md` files to guidelines)
- Support both simple (single user message) and complex (multi-turn) conversation patterns
- Preserve existing flat format for common patterns like system file + user text
- **Ensure evaluator sees the same conversation structure** as the candidate LLM when judging responses

## Impact

- Affected specs: `eval-execution` (new capability for both candidate and evaluator prompts)
- Affected code: 
  - Request builder/formatter that converts `input_messages` to provider format
  - Evaluator prompt builder that constructs the quality evaluation prompt
- **Breaking**: None - existing single-turn evaluations continue using flattened `question` format
- **Enhancement**: 
  - Multi-turn conversations now properly preserve turn boundaries and role information
  - Evaluators can correctly assess responses in multi-turn conversational context
