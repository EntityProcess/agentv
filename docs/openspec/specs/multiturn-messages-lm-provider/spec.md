# multiturn-messages-lm-provider Specification

## Purpose
Define how multi-turn eval `input_messages` are converted into structured chat prompts and consumed by LLM providers, covering guideline extraction, file embedding, empty-message filtering, system-message merging, and backward-compatible logging behavior.

## Requirements
### Requirement: Convert Input Messages to Chat Prompt

The system SHALL convert eval case `input_messages` into a structured `ChatPrompt` array suitable for LLM API delivery.

#### Scenario: Single system and user message

```yaml
input_messages:
  - role: system
    content: You are a helpful assistant.
  - role: user
    content: Hello, world!
```

Converts to:
```typescript
[
  { role: "system", content: "You are a helpful assistant." },
  { role: "user", content: "Hello, world!" }
]
```

#### Scenario: Multi-turn conversation with assistant response

```yaml
input_messages:
  - role: user
    content: Debug this code
  - role: assistant
    content: I can help with that
  - role: user
    content: Thanks, here's the code
```

Converts to:
```typescript
[
  { role: "user", content: "Debug this code" },
  { role: "assistant", content: "I can help with that" },
  { role: "user", content: "Thanks, here's the code" }
]
```

#### Scenario: System message with guidelines

```yaml
input_messages:
  - role: user
    content:
      - type: text
        value: Review this code
      - type: file
        value: ./guidelines.instructions.md
```

With `guideline_patterns: ["**/*.instructions.md"]` and guideline content "Always be concise":

Converts to:
```typescript
[
  {
    role: "system",
    content: "You are a careful assistant.\n\n[[ ## Guidelines ## ]]\n\nAlways be concise"
  },
  { role: "user", content: "Review this code\n<Attached: ./guidelines.instructions.md>" }
]
```

#### Scenario: Embedded non-guideline file

```yaml
input_messages:
  - role: user
    content:
      - type: text
        value: Review this:
      - type: file
        value: ./code.js
```

With file content "console.log('test')":

Converts to:
```typescript
[
  {
    role: "user",
    content: "Review this:\n=== ./code.js ===\nconsole.log('test')"
  }
]
```

### Requirement: Guideline Extraction

Guideline files matching `guideline_patterns` SHALL be extracted from messages and placed in the system message.

#### Scenario: Extract guideline from user message

```yaml
input_messages:
  - role: user
    content:
      - type: file
        value: python.instructions.md
      - type: text
        value: Write a function
```

With `guideline_patterns: ["**/*.instructions.md"]`:

System message includes guideline content, user message has reference marker:
```typescript
[
  { role: "system", content: "[[ ## Guidelines ## ]]\n\n<guideline content>" },
  { role: "user", content: "<Attached: python.instructions.md>\nWrite a function" }
]
```

#### Scenario: Multiple guideline files

```yaml
input_messages:
  - role: user
    content:
      - type: file
        value: python.instructions.md
      - type: file
        value: security.instructions.md
```

Both extracted to system message:
```typescript
[
  {
    role: "system",
    content: "[[ ## Guidelines ## ]]\n\n=== python.instructions.md ===\n<content1>\n\n=== security.instructions.md ===\n<content2>"
  },
  {
    role: "user",
    content: "<Attached: python.instructions.md>\n<Attached: security.instructions.md>"
  }
]
```

### Requirement: Empty Message Filtering

Messages with no content after processing SHALL be filtered out.

#### Scenario: Message with only guideline files

```yaml
input_messages:
  - role: system
    content: System context
  - role: user
    content:
      - type: file
        value: guidelines.instructions.md
```

If guideline file is the only content, that user message is empty after extraction:
```typescript
[
  { role: "system", content: "System context\n\n[[ ## Guidelines ## ]]\n\n<guideline content>" }
  // User message omitted - had no non-guideline content
]
```

### Requirement: System Message Merging

When `input_messages` contains a system message, it SHALL be merged with the constructed system message (metadata + guidelines).

#### Scenario: Explicit system message in input

```yaml
input_messages:
  - role: system
    content: Custom system context
  - role: user
    content: Hello
```

With metadata systemPrompt "Default prompt" and guidelines "Be concise":

```typescript
[
  {
    role: "system",
    content: "Custom system context\n\n[[ ## Guidelines ## ]]\n\nBe concise"
  },
  { role: "user", content: "Hello" }
]
```

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

### Requirement: ProviderRequest Interface With ChatPrompt

The `ProviderRequest` interface SHALL support structured message delivery via the `chatPrompt` field while maintaining backward compatibility for logging.

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

Provider uses `chatPrompt` for API call, `question` remains available for debugging.
