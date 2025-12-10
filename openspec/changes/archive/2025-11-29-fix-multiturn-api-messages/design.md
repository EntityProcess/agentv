# Design: Structured Message Delivery to LLM APIs

## Architecture Overview

The current flow has a lossy conversion:

```
input_messages (structured) 
  → buildPromptInputs() 
    → question (flat text with role markers) 
      → buildChatPrompt() 
        → API messages (single user message)
```

The proposed flow preserves structure:

```
input_messages (structured)
  → ProviderRequest.chatPrompt (structured)
    → buildChatPrompt()
      → API messages (proper multi-turn array)
```

## Key Design Decisions

### 1. Use `chatPrompt` Field in `ProviderRequest`

**Rationale**: The `ProviderRequest.chatPrompt?: ChatPrompt` field already exists but isn't populated from eval cases. This is the natural place to pass structured messages.

**Implementation**:
- In `yaml-parser.ts`, `buildPromptInputs` generates `chatPrompt` alongside `question`
- In `orchestrator.ts`, pass `chatPrompt` to `ProviderRequest`
- Providers check `request.chatPrompt` first; if present, use it instead of building from `request.question`

### 2. Keep Role Markers for Logging Only

**Rationale**: Role markers (`[System]:`, `[User]:`) are valuable for debugging and understanding eval results. They should remain in the output but not be sent to LLMs.

**Implementation**:
- `buildPromptInputs()` continues to generate formatted text with role markers
- This text goes into `request.question` for logging (appears in `raw_request.question` in results)
- `request.chatPrompt` contains the structured messages for the API

### 3. Guideline Extraction Strategy

**Challenge**: Guideline files need to be in the system message, but `input_messages` may contain them mixed with user content.

**Solution**:
- When converting `input_messages` to `chatPrompt`:
  1. Extract all guideline files (based on `guideline_patterns`) from all messages
  2. Combine extracted guideline content into the system message
  3. Leave non-guideline file attachments in their original message positions
  4. For guideline files, replace them with reference markers (e.g., `<Attached: file.instructions.md>`)

### 4. System Message Construction

System message should contain (in order):
1. Metadata system prompt (from `metadata.systemPrompt`) or default
2. Guidelines content (extracted guideline files)

User messages and subsequent turns should contain:
- Original text content
- Non-guideline file content (embedded inline with headers)
- Reference markers for guideline files

### 5. Provider-Specific Handling

**Ax-based providers** (Azure, Anthropic, Gemini):
- Update `buildChatPrompt()` to use `request.chatPrompt` when available
- Fall back to legacy behavior (build from `question`) when `chatPrompt` is absent

**VS Code provider**:
- No changes needed; it already handles files via attachments
- The formatted `question` is sent as-is (role markers are fine for VS Code)
- **Decision**: Continue using text transcript format (`[User]: ...`) instead of JSON.
- **Rationale**: Agents consume the task as a natural language prompt (markdown file). A text transcript is a more natural representation of conversation history for an LLM to "read" and continue than a raw JSON dump, which might be interpreted as a data processing task.

**Codex provider**:
- Similar to VS Code; batch dispatch handles structure

### 6. Multiple System Messages
- **Issue**: `input_messages` may contain explicit `role: "system"` messages anywhere in the conversation.
- **Decision**: 
  - **Initial System Messages**: Merge all system messages appearing at the *start* of the conversation (before the first user/assistant message) into the global system message.
  - **Subsequent System Messages**: Convert any system messages appearing *after* the start to `role: "assistant"` with a `[System]:` prefix.
- **Rationale**: 
  - Merging initial messages ensures global instructions (guidelines, metadata) are correctly set as context.
  - Preserving subsequent messages in-place (but re-roled) maintains the chronological order of events (e.g., errors, status updates) which is critical for multi-turn logic.
  - Using `assistant` role prevents the model from interpreting these events as user requests/inputs.
- **Scope**: This logic applies to `chatPrompt` generation for LLM APIs.

### 7. Segment Lookup Efficiency
- **Issue**: Searching `input_segments` for every file reference is inefficient and potentially ambiguous.
- **Resolution**: Pass pre-computed `segmentsByMessage` (which maps 1:1 with `input_messages`) to `convertToChatPrompt` to ensure O(1) lookup and correct segment association.

## Message Conversion Logic

```typescript
function convertToChatPrompt(
  messages: readonly TestMessage[],
  segmentsByMessage: readonly JsonObject[][],
  guidelinePatterns?: readonly string[],
  systemPrompt?: string,
  guidelineContent?: string,
): ChatPrompt {
  const result: ChatMessage[] = [];
  
  // 1. Collect all system content
  const systemSegments: string[] = [];
  
  // 1a. Metadata system prompt
  if (systemPrompt) {
    systemSegments.push(systemPrompt);
  }
  
  // 1b. Guidelines
  if (guidelineContent) {
    systemSegments.push(`[[ ## Guidelines ## ]]\n\n${guidelineContent}`);
  }
  
  // 1c. Initial system messages from input_messages
  let startIndex = 0;
  while (startIndex < messages.length && messages[startIndex].role === "system") {
    const segments = segmentsByMessage[startIndex];
    const textParts = segments
      .filter(s => s.type === "text" || s.type === "file")
      .map(s => s.type === "file" ? (s.text as string) : (s.value as string));
    
    if (textParts.length > 0) {
      systemSegments.push(textParts.join("\n"));
    }
    startIndex++;
  }
  
  // Add single consolidated system message if content exists
  if (systemSegments.length > 0) {
    result.push({
      role: "system",
      content: systemSegments.join("\n\n"),
    });
  }
  
  // 2. Convert remaining messages
  for (let i = startIndex; i < messages.length; i++) {
    const message = messages[i];
    const segments = segmentsByMessage[i];
    const contentParts: string[] = [];
    
    // Handle subsequent system messages by converting to assistant with marker
    let role = message.role;
    if (role === "system") {
      role = "assistant";
      contentParts.push("[System]:");
    }
    
    for (const segment of segments) {
      if (segment.type === "text") {
        contentParts.push(segment.value as string);
      } else if (segment.type === "file") {
        const filePath = segment.path as string;
        // Check if guideline file
        if (guidelinePatterns && isGuidelineFile(filePath, guidelinePatterns)) {
          // Reference only - content already in system message
          contentParts.push(`<Attached: ${filePath}>`);
        } else {
          // Embed non-guideline files inline
          const fileContent = segment.text as string;
          contentParts.push(`=== ${filePath} ===\n${fileContent}`);
        }
      }
    }
    
    if (contentParts.length > 0) {
      result.push({
        role: role,
        content: contentParts.join("\n"),
      });
    }
  }
  
  return result;
}
```

## Migration Path

### Phase 1: Add chatPrompt Population (This Change)
- Populate `ProviderRequest.chatPrompt` in orchestrator
- Update `buildChatPrompt()` in ax-based providers to use it
- Keep backward compatibility (fall back to `question` if `chatPrompt` absent)

### Phase 2: Validate & Test
- Verify all multi-turn evals work correctly
- Confirm API requests show proper message structure
- Ensure single-turn evals unchanged

### Phase 3: Future Cleanup (Optional)
- Consider removing `question` field generation for multi-turn cases
- Keep only for logging/debugging purposes

## Edge Cases

1. **Empty messages**: Skip messages with no content after processing
2. **System message already present**: Merge with constructed system message
3. **No guideline patterns**: All files embedded inline
4. **Assistant/tool messages**: Pass through with their original roles
5. **Mixed content**: Text + files in same message → concatenate with newlines
6. **Multiple System Messages**: Merge all system messages into one at the start
7. **Segment Lookup Efficiency**: Use `segmentsByMessage` for O(1) lookup

## Testing Strategy

1. **Unit tests**: Message conversion logic
2. **Integration tests**: Provider request generation
3. **E2E tests**: Full eval execution with multi-turn cases
4. **Regression tests**: Existing single-turn evals still work
