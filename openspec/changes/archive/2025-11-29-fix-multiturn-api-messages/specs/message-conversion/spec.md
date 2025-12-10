# Message Conversion Capability

## ADDED Requirements

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

When input_messages contains a system message, it SHALL be merged with the constructed system message (metadata + guidelines).

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

## MODIFIED Requirements

None - this is a new capability.

## REMOVED Requirements

None - this is a new capability.
