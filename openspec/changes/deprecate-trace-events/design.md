# Design: Deprecate TraceEvent, Unify on OutputMessage Format

## Context

AgentV currently supports two formats for agent execution traces:

1. **TraceEvent** (custom AgentV format):
```typescript
interface TraceEvent {
  type: TraceEventType;  // 'model_step' | 'tool_call' | 'tool_result' | 'message' | 'error'
  timestamp?: string;
  id?: string;
  name?: string;
  input?: unknown;
  output?: unknown;
  text?: string;
  metadata?: Record<string, unknown>;
}
```

2. **OutputMessage** (OpenAI-style format):
```typescript
interface OutputMessage {
  role: string;
  name?: string;
  content?: unknown;
  toolCalls?: ToolCall[];
}

interface ToolCall {
  tool: string;
  input?: unknown;
  output?: unknown;
}
```

The recent `support-output-messages-traces` change added `extractTraceFromMessages()` to convert between formats. This proposal eliminates that conversion layer.

## Goals

- Eliminate data format duplication
- Simplify the codebase by removing conversion logic
- Align with industry-standard OpenAI message format
- Maintain backward compatibility during transition

## Non-Goals

- Immediate removal of `trace` field (deprecation only)
- Changing evaluation semantics
- Modifying TraceSummary computation logic

## Decisions

### Decision 1: Extend ToolCall with optional trace fields

**What**: Add `id` and `timestamp` to `ToolCall` interface.

```typescript
interface ToolCall {
  tool: string;
  input?: unknown;
  output?: unknown;
  // New optional fields
  id?: string;        // Stable identifier for pairing
  timestamp?: string; // ISO 8601 timestamp
}
```

**Why**: These fields from TraceEvent are useful for advanced analysis but not required for basic tool trajectory evaluation. Making them optional maintains simplicity for common cases.

**Alternatives considered**:
- Create ExtendedToolCall subtype: Rejected - adds unnecessary type complexity
- Require all fields: Rejected - most providers don't need timestamps

### Decision 2: Extend OutputMessage with metadata

**What**: Add `timestamp` and `metadata` to `OutputMessage` interface.

```typescript
interface OutputMessage {
  role: string;
  name?: string;
  content?: unknown;
  toolCalls?: ToolCall[];
  // New optional fields
  timestamp?: string;
  metadata?: Record<string, unknown>;
}
```

**Why**: Allows capturing message-level timing and provider-specific data without requiring TraceEvent format.

### Decision 3: Evaluator context includes outputMessages

**What**: Add `outputMessages` field to evaluator context passed to all evaluators.

```typescript
interface EvaluatorContext {
  // existing fields...
  trace?: readonly TraceEvent[];           // deprecated
  outputMessages?: readonly OutputMessage[]; // new primary source
}
```

**Why**: Evaluators can work directly with messages without needing trace conversion.

### Decision 4: tool_trajectory evaluator uses outputMessages directly

**What**: Refactor `runToolTrajectoryEvaluator` to extract tool calls from `outputMessages` instead of requiring `trace`.

**Why**: Eliminates the conversion step and simplifies the data flow.

**Fallback**: If `outputMessages` is not available, fall back to `trace` for backward compatibility.

### Decision 5: Deprecate trace field with JSDoc annotation

**What**: Add `@deprecated` JSDoc to `trace` field in `ProviderResponse`.

```typescript
interface ProviderResponse {
  /** @deprecated Use outputMessages instead. Will be removed in v2.0. */
  readonly trace?: readonly TraceEvent[];
  readonly outputMessages?: readonly OutputMessage[];
}
```

**Why**: Signals intent to consumers while maintaining compatibility.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Breaking existing providers using `trace` | Keep trace field working during deprecation period |
| Custom evaluators depend on TraceEvent format | Document migration path; evaluators can still parse trace files |
| TraceSummary computation relies on TraceEvent | Update to derive from outputMessages when available |

## Migration Plan

### Phase 1: This proposal (non-breaking)
1. Extend OutputMessage/ToolCall interfaces
2. Add outputMessages to evaluator context
3. Update tool_trajectory to prefer outputMessages
4. Add deprecation notices to trace field

### Phase 2: Future release (breaking)
1. Remove extractTraceFromMessages function
2. Remove trace field from ProviderResponse
3. Update all internal code to use outputMessages only

## Open Questions

None - approach is clear based on existing implementation work.
