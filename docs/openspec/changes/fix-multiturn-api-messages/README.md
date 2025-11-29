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

### 4. specs/message-conversion/spec.md
- **Purpose**: Requirements for converting TestMessage[] to ChatPrompt
- **Requirements**:
  - Convert Input Messages to Chat Prompt (5 scenarios)
  - Guideline Extraction (2 scenarios)
  - Empty Message Filtering (1 scenario)
  - System Message Merging (1 scenario)
- **Total Scenarios**: 9

### 5. specs/provider-integration/spec.md
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
- **Decision**: Merge explicit system messages with constructed ones
- **Rationale**: Allow eval authors to override default system prompts
- **Trade-off**: More flexible vs. more complex

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

## Next Steps

### ⚠️ DO NOT START IMPLEMENTATION YET

Per OpenSpec Stage 2 guidelines:
> **Approval gate** - Do not start implementation until the proposal is reviewed and approved.

### Required Actions Before Implementation
1. **Review**: Have stakeholders review the proposal documents
2. **Approve**: Get formal approval to proceed
3. **Schedule**: Plan implementation timeline
4. **Assign**: Determine who will implement which tasks

### When Approved, Start With:
1. Read `tasks.md` for implementation checklist
2. Begin with Phase 1 (Message Conversion)
3. Follow TDD: Write tests first, then implementation
4. Update `design.md` if implementation reveals new insights

## File Locations
```
docs/openspec/changes/fix-multiturn-api-messages/
├── proposal.md          # Problem statement and solution
├── design.md            # Architecture and technical decisions
├── tasks.md             # Implementation checklist
└── specs/
    ├── message-conversion/
    │   └── spec.md      # Message conversion requirements
    └── provider-integration/
        └── spec.md      # Provider integration requirements
```

## Validation Command
```bash
cd docs/
openspec validate fix-multiturn-api-messages --strict
```

## Related Code
- `packages/core/src/evaluation/yaml-parser.ts` - Message processing
- `packages/core/src/evaluation/orchestrator.ts` - ProviderRequest creation
- `packages/core/src/evaluation/providers/ax.ts` - LLM API calls
- `packages/core/src/evaluation/providers/types.ts` - ProviderRequest interface
- `packages/core/src/evaluation/providers/vscode.ts` - VS Code integration
