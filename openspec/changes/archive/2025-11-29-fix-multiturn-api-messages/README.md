# Fix Multi-Turn API Messages - OpenSpec Proposal Summary

## Status
✅ **Proposal Complete and Validated**
- Change ID: `fix-multiturn-api-messages`
- Location: `docs/openspec/changes/fix-multiturn-api-messages/`
- Validation: Passed `openspec validate --strict`

## Problem Statement
Multi-turn conversations are formatted with role markers (`[User]:`, `[Assistant]:`) for human readability, but these markers are being sent to LLM APIs as plain text in a single user message. This breaks the conversational structure that the LLM needs to understand multi-turn interactions.

### Current Behavior (Broken)
```typescript
// What orchestrator creates:
question: "[User]: Hello\n[Assistant]: Hi\n[User]: Help me"

// What provider sends to API:
[
  { role: "system", content: "..." },
  { role: "user", content: "[User]: Hello\n[Assistant]: Hi\n[User]: Help me" }
]
// ❌ LLM sees role markers as plain text, loses conversation structure
```

### Expected Behavior (Fixed)
```typescript
// What orchestrator creates:
chatPrompt: [
  { role: "user", content: "Hello" },
  { role: "assistant", content: "Hi" },
  { role: "user", content: "Help me" }
]

// What provider sends to API:
[
  { role: "system", content: "..." },
  { role: "user", content: "Hello" },
  { role: "assistant", content: "Hi" },
  { role: "user", content: "Help me" }
]
// ✅ LLM receives proper conversation history
```

## Proposal Documents

### 1. proposal.md
- **Purpose**: High-level problem analysis and solution approach
- **Key Sections**:
  - Current Behavior (4-step flow showing the bug)
  - Root Cause (chatPrompt field exists but never populated)
  - Proposed Solution (4 key changes)
  - Success Criteria (6 validation points)

### 2. design.md
- **Purpose**: Technical architecture and implementation strategy
- **Key Sections**:
  - Architecture Overview (before/after flow diagrams)
  - Key Design Decisions (5 decisions with rationale)
  - Message Conversion Logic (pseudocode)
  - Migration Path (3 phases)
  - Edge Cases (5 scenarios)
  - Testing Strategy (4 test levels)

### 3. tasks.md
- **Purpose**: Implementation checklist
- **Key Sections**:
  - Core Implementation (6 tasks, 18 subtasks)
  - Testing (5 test categories)
  - Documentation (3 documentation areas)
  - Validation & Cleanup (3 validation steps)
- **Total Tasks**: ~45 items

### 4. specs/multiturn-messages-lm-provider/spec.md
- **Purpose**: Requirements for converting TestMessage[] to ChatPrompt
- **Requirements**:
  - Convert Input Messages to Chat Prompt (5 scenarios)
  - Guideline Extraction (2 scenarios)
  - Empty Message Filtering (1 scenario)
  - System Message Merging (1 scenario)
- **Total Scenarios**: 9

### 5. (merged into specs/multiturn-messages-lm-provider/spec.md)
- **Purpose**: Requirements for provider chatPrompt handling
- **ADDED Requirements**:
  - ChatPrompt Field Handling (2 scenarios)
  - System Message Handling (2 scenarios)
  - Guidelines Field Deprecation (1 scenario)
  - AxProvider Baseline Implementation (1 scenario)
  - VS Code Provider Non-Change (1 scenario)
- **MODIFIED Requirements**:
  - ProviderRequest Interface (1 scenario)
- **Total Scenarios**: 8

## Implementation Strategy

### Phase 1: Message Conversion (Core)
1. Update `buildPromptInputs()` in `yaml-parser.ts` to return `chatPrompt`
2. Extract guideline content to system message
3. Filter empty messages
4. Merge system messages
5. Unit tests for all scenarios

### Phase 2: Orchestrator Integration
1. Populate `request.chatPrompt` from `promptInputs.chatPrompt`
2. Keep `request.question` for logging/debugging
3. Integration tests for orchestrator

### Phase 3: Provider Updates
1. Update `AxProvider.buildChatPrompt()` to check `request.chatPrompt` first
2. Fall back to `request.question` for backward compatibility
3. Provider-specific tests (Azure, Anthropic, Gemini)
4. VS Code provider remains unchanged

### Phase 4: Validation
1. End-to-end eval tests with multi-turn conversations
2. Regression tests for single-message cases
3. Performance benchmarking
4. Code review and cleanup

## Key Design Decisions

### 1. Backward Compatibility
- **Decision**: Keep both `question` and `chatPrompt` fields
- **Rationale**: Gradual migration, no breaking changes
- **Trade-off**: Slight memory overhead vs. safety

### 2. Guideline Extraction
- **Decision**: Extract guidelines to system message during conversion
- **Rationale**: Matches current `buildPromptInputs()` behavior
- **Trade-off**: Complexity vs. consistency

### 3. Provider-Specific Handling
- **Decision**: VS Code keeps using `question` field
- **Rationale**: VS Code handles conversation via workspace context
- **Trade-off**: Provider divergence vs. simplicity

### 4. System Message Merging
- **Decision**: Merge initial system messages; convert subsequent ones to assistant role.
- **Rationale**: Ensures global context is set correctly while preserving chronological order of mid-conversation events.
- **Trade-off**: More complex logic vs. correctness.

### 5. Empty Message Filtering
- **Decision**: Remove messages with no content after guideline extraction
- **Rationale**: Avoid sending empty messages to LLM APIs
- **Trade-off**: Implicit behavior vs. API compatibility

## Success Criteria
1. ✅ Multi-turn evals send structured message arrays to LLM APIs
2. ✅ Single-message evals continue to work (backward compatibility)
3. ✅ Guideline extraction works in multi-turn context
4. ✅ VS Code provider unchanged
5. ✅ All existing tests pass
6. ✅ New tests cover multi-turn scenarios

## Provider Usage (chatPrompt vs question)
- `ProviderRequest.chatPrompt` is populated for conversations with multiple visible turns or non-user roles; single user-only prompts keep `chatPrompt` undefined and rely on `question` + `guidelines`.
- Ax providers (Azure/Anthropic/Gemini) use `chatPrompt` first and only fall back to `question` when it is absent; VS Code remains unchanged and uses `question` for workspace injection.
- When `chatPrompt` lacks a system role, providers prepend one using `metadata.systemPrompt` and `guidelines`; otherwise they send the array as-is.

## Message Conversion Notes
- `buildPromptInputs` converts `input_messages` into `chatPrompt`, embedding non-guideline files inline with headers (`=== file ===`) and skipping messages that contain only guideline files.
- Guideline files matching `guideline_patterns` are extracted into the system message via `guidelines`; they are omitted from per-turn `chatPrompt` entries to avoid duplication.
- When only a single user turn is present, `chatPrompt` is omitted to preserve legacy behavior while keeping `question` unchanged for logging.

## Architecture / Backward Compatibility
- Dual-path delivery: `question` remains for logging/debugging and VS Code; `chatPrompt` is the structured API payload for Ax providers.
- Raw requests now include `chat_prompt` alongside `question/guidelines` for visibility in results and caching.
- The system message is consolidated (metadata + guidelines + initial system turns); later system turns are re-tagged as assistant messages with `[System]:` prefix to preserve chronology.

## Notes
- Implementation completed; proposal text retained for context.
- Validation command for future edits: `cd docs && openspec validate fix-multiturn-api-messages --strict`
