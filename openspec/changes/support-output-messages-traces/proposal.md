# Proposal: Support Output Messages Traces

## Problem

The `tool_trajectory` evaluator requires trace data in AgentV's `TraceEvent[]` format, but CLI providers exporting agent execution in OpenAI's standard message format (`output_messages[].tool_calls[]`) must duplicate this information into a separate `trace` field.

Current flow:
1. Agent executes with tool calls captured in `output_messages[].tool_calls[]` 
2. CLI provider must convert `tool_calls` → `TraceEvent[]` and add as separate `trace` field
3. AgentV orchestrator passes `trace` to evaluators
4. Tool trajectory evaluator uses `trace` to count/sequence tool calls

**The redundancy:** `output_messages[].tool_calls[]` already contains:
- Tool names (`tool_calls[].tool`)
- Tool inputs (`tool_calls[].input`)
- Tool outputs (`tool_calls[].output`)
- Sequence information (array order)

All of which map directly to `TraceEvent` fields (`name`, `input`, `output`, sequence).

## Goals

1. **Eliminate duplication**: CLI providers shouldn't need to maintain both `output_messages` and `trace` formats
2. **Standard format support**: Accept OpenAI message format (`output_messages`) directly
3. **Backward compatibility**: Keep explicit `trace` field working for providers that use it
4. **Minimal changes**: Don't break existing providers or evaluators

## Proposed Solution

### 1. Extend ProviderResponse Interface

Add optional `output_messages` field to `ProviderResponse`:

```typescript
export interface ProviderResponse {
  readonly text: string;
  readonly reasoning?: string;
  readonly raw?: unknown;
  readonly usage?: JsonObject;
  readonly trace?: readonly TraceEvent[];
  readonly traceRef?: string;
  readonly output_messages?: readonly OutputMessage[]; // NEW
}

export interface OutputMessage {
  readonly role: string;
  readonly name?: string;
  readonly content?: unknown;
  readonly tool_calls?: readonly ToolCall[];
}

export interface ToolCall {
  readonly tool: string;
  readonly input?: unknown;
  readonly output?: unknown;
}
```

### 2. Update Orchestrator Trace Extraction

Modify orchestrator to extract traces from `output_messages` when no explicit `trace` is provided:

```typescript
// Current: only loads from trace/traceRef
let candidateTrace = providerResponse.trace;
if (!candidateTrace && providerResponse.traceRef) {
  candidateTrace = await readJsonFile(providerResponse.traceRef);
}

// Proposed: fallback to output_messages
if (!candidateTrace && providerResponse.output_messages) {
  candidateTrace = extractTraceFromMessages(providerResponse.output_messages);
}
```

### 3. Update CLI Provider JSONL Parsing

Modify `parseJsonlBatchOutput` to pass through `output_messages`:

```typescript
const obj = parsed as {
  id?: unknown;
  text?: unknown;
  trace?: unknown;
  traceRef?: unknown;
  output_messages?: unknown; // NEW
};

records.set(id, {
  text,
  trace: this.parseTrace(obj.trace),
  traceRef,
  outputMessages: this.parseOutputMessages(obj.output_messages), // NEW
});
```

### 4. Implementation Strategy

**Phase 1: Core support (this proposal)**
- Add `output_messages` to `ProviderResponse`
- Implement `extractTraceFromMessages()` in orchestrator
- Update CLI provider to pass through `output_messages`
- Make `trace` optional in favor of `output_messages`

**Phase 2: Provider updates (future)**
- Update mock provider examples to use `output_messages`
- Document migration path for existing providers
- Add validation warnings for providers sending both `trace` and `output_messages`

## Impact Analysis

### Benefits
- **Simpler integration**: CLI providers can export OpenAI format directly without conversion
- **Less duplication**: Single source of truth for tool execution data
- **Standards alignment**: Uses widely-adopted OpenAI message format

### Risks
- **Implementation complexity**: Need careful extraction logic to handle all `output_messages` variants
- **Testing overhead**: Must validate against existing trace-based workflows

### Migration Path
- **Existing providers**: Continue working unchanged (explicit `trace` still supported)
- **New providers**: Can use `output_messages` instead of `trace`
- **GoldenCsvChecker**: Can remove trace conversion logic, export `output_messages` directly

## Non-Goals

- Remove support for explicit `trace` field (backward compatibility required)
- Convert all existing providers to `output_messages` format
- Parse `input_messages` (only `output_messages` needed for trajectory evaluation)

## Open Questions

None - implementation path is clear.
