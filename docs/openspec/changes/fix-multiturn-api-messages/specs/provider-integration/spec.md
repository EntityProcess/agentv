# Provider Integration

## ADDED Requirements

### Requirement: ChatPrompt Field Handling

All providers SHALL prioritize using `request.chatPrompt` when available, falling back to `request.question` for backward compatibility.

#### Scenario: ChatPrompt provided in request

```typescript
const request: ProviderRequest = {
  question: "[User]: Hello\n[Assistant]: Hi\n[User]: Help me",
  chatPrompt: [
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Hi" },
    { role: "user", content: "Help me" }
  ],
  guidelines: []
};
```

Provider uses `request.chatPrompt` array for API call, ignoring `request.question`.

#### Scenario: ChatPrompt not provided (legacy)

```typescript
const request: ProviderRequest = {
  question: "What is the capital of France?",
  guidelines: [],
  chatPrompt: undefined
};
```

Provider falls back to `request.question`, creating single user message:
```typescript
[
  { role: "system", content: "<system prompt>" },
  { role: "user", content: "What is the capital of France?" }
]
```

### Requirement: System Message Handling

When `chatPrompt` is provided, providers SHALL use its system message instead of constructing one.

#### Scenario: System message in chatPrompt

```typescript
const request: ProviderRequest = {
  chatPrompt: [
    { role: "system", content: "You are a code reviewer.\n\n[[ ## Guidelines ## ]]\nBe concise." },
    { role: "user", content: "Review this code" }
  ],
  guidelines: []
};
```

Provider sends `chatPrompt` as-is to LLM API without modifying the system message.

#### Scenario: No system message in chatPrompt

```typescript
const request: ProviderRequest = {
  chatPrompt: [
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Hi" },
    { role: "user", content: "Help me" }
  ],
  guidelines: []
};
```

Provider prepends default system message:
```typescript
[
  { role: "system", content: "You are a careful assistant." },
  { role: "user", content: "Hello" },
  { role: "assistant", content: "Hi" },
  { role: "user", content: "Help me" }
]
```

### Requirement: Guidelines Field Deprecation

When `chatPrompt` is provided, the `guidelines` field SHALL be ignored (guidelines already merged into system message).

#### Scenario: Both chatPrompt and guidelines provided

```typescript
const request: ProviderRequest = {
  chatPrompt: [
    { role: "system", content: "System with guidelines already merged" },
    { role: "user", content: "Hello" }
  ],
  guidelines: ["Old guideline 1", "Old guideline 2"]
};
```

Provider uses `chatPrompt.system.content` exactly as provided, ignoring `request.guidelines`.

### Requirement: AxProvider Baseline Implementation

`AxProvider.buildChatPrompt()` SHALL be updated to implement the chatPrompt handling pattern for all Ax-based providers.

#### Scenario: Azure provider inherits fix

```typescript
class AzureProvider extends AxProvider {
  // buildChatPrompt() inherited from AxProvider
}

const request: ProviderRequest = {
  chatPrompt: [
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Hi" }
  ]
};

// Azure automatically uses chatPrompt via inherited method
```

### Requirement: VS Code Provider Non-Change

VS Code provider SHALL continue using `request.question` since it handles conversation structure via workspace attachments.

#### Scenario: VS Code with multi-turn eval

```typescript
const request: ProviderRequest = {
  question: "[User]: Hello\n[Assistant]: Hi\n[User]: Help",
  chatPrompt: [
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Hi" },
    { role: "user", content: "Help" }
  ]
};

// VS Code provider uses request.question (role markers acceptable)
// Ignores chatPrompt field
```

VS Code provider behavior unchanged.

## MODIFIED Requirements

### Requirement: ProviderRequest Interface

The `ProviderRequest` interface SHALL support structured message delivery via the `chatPrompt` field while maintaining backward compatibility.

**Before:**
```typescript
interface ProviderRequest {
  question: string;
  guidelines: string[];
  chatPrompt?: ChatPrompt; // Optional, never populated
  inputFiles?: InputFile[];
}
```

**After:**
```typescript
interface ProviderRequest {
  question: string; // Deprecated: for logging and legacy fallback
  guidelines: string[]; // Deprecated: merged into chatPrompt
  chatPrompt?: ChatPrompt; // Primary field for LLM API delivery
  inputFiles?: InputFile[]; // File paths for provider-specific handling
}
```

**Impact:**
- `question` field remains for backward compatibility (logging, VS Code)
- `guidelines` field remains for backward compatibility (legacy providers)
- `chatPrompt` field now populated by orchestrator from `input_messages`
- No breaking changes to existing provider implementations

#### Scenario: Orchestrator populates chatPrompt

```yaml
input_messages:
  - role: user
    content: Hello
  - role: assistant
    content: Hi there
```

Orchestrator creates:
```typescript
const request: ProviderRequest = {
  question: "[User]: Hello\n[Assistant]: Hi there",  // For logging
  chatPrompt: [
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Hi there" }
  ],  // For API delivery
  guidelines: []
};
```

Provider uses `chatPrompt` for API call, `question` available for debugging.

## REMOVED Requirements

None - this is additive/clarification change.
