# Evaluation Architecture Design

## Context

Code judges are external TypeScript scripts that evaluate AI agent outputs. Requirements:
- Process isolation for fault tolerance and untrusted code execution
- Language-agnostic protocol for potential Python, Go, or other language implementations
- Minimal boilerplate for judge authors
- Standard debugging tooling support

AgentV's evaluation framework required a communication protocol for these external judge scripts.

## Decisions

### Decision 1: Plain JSON over stdin/stdout

**Choice:** Use plain JSON payloads over stdin/stdout instead of JSON-RPC or other IPC protocols.

**Rationale:**

**One-shot evaluation pattern:**
- Input: Single JSON payload with evaluation context
- Output: Single JSON result with score and feedback
- No bidirectional messaging or persistent sessions required

**Minimal protocol overhead:**
- No request IDs (single request/response per process)
- No method routing (only one operation: evaluate)
- No version negotiation (schema evolution handled by Zod)
- Fewer failure modes and edge cases

**Process lifecycle alignment:**
- Spawn process, read stdin, write stdout, exit
- Natural fit for stateless evaluation
- OS handles cleanup automatically

**Language agnostic by design:**
- Any language can read JSON from stdin
- Any language can write JSON to stdout
- Protocol is pure data, not RPC semantics

### Decision 2: Invisible IPC Abstraction Layer

**Choice:** Hide IPC mechanics behind a declarative API that feels like in-process code.

**Implementation:**

Users write judge scripts as pure functions:

```typescript
import { defineCodeJudge } from '@agentv/eval';

export default defineCodeJudge(({ candidateAnswer, traceSummary }) => ({
  score: traceSummary.eventCount <= 5 ? 1.0 : 0.5,
  hits: ['Efficient tool usage'],
}));
```

Runtime (`packages/eval/src/runtime.ts`) transparently handles:
1. Reading and parsing stdin (snake_case to camelCase conversion)
2. Schema validation via Zod
3. Error handling and normalization
4. Result validation and score clamping
5. JSON serialization to stdout

**Benefits:**
- In-process developer experience (simple API, type safety)
- Out-of-process runtime benefits (isolation, language-agnostic potential)
- Zero boilerplate (single function export)
- Users never interact with IPC mechanics

### Decision 3: Snake case wire format, camelCase TypeScript

**Choice:** Use snake_case in JSON wire format, convert to camelCase for TypeScript consumers.

**Rationale:**
- snake_case is YAML/JSON convention, language-agnostic
- camelCase is idiomatic TypeScript
- Runtime handles bidirectional conversion transparently
- Judges receive idiomatic JavaScript objects

## Comparison with Other Frameworks

| Framework | Protocol | Use Case | Architecture |
|-----------|----------|----------|--------------|
| pi-mono | JSON-RPC over stdio | Stateful extension sessions with commands and async events | Multiple requests per session, bidirectional |
| adk-js | In-process callbacks | Plugin lifecycle hooks | No IPC, direct function calls |
| mastra | In-process + MCP client | Agent composition | In-process for plugins, MCP for external tools |
| langwatch | tRPC (internal), REST (external) | API-based integrations | HTTP-based, persistent service |
| agentv | Plain JSON over stdio | One-shot evaluation scripts | Spawn, evaluate, exit |

## Alternatives Considered

### JSON-RPC (pi-mono approach)
**Pros:**
- Industry standard, well-understood
- Supports complex request/response patterns

**Cons:**
- Adds complexity (request IDs, method names, version negotiation)
- Designed for stateful sessions with multiple commands
- Unnecessary overhead for single request/response

**Verdict:** Overkill for one-shot evaluation use case

### In-process only (adk-js approach)
**Pros:**
- Best performance, easiest debugging
- Direct function calls, no serialization

**Cons:**
- No isolation (judge bugs crash eval runner)
- Cannot support other languages
- Security concerns with untrusted code

**Verdict:** Insufficient for user-provided judges requiring isolation

### HTTP REST API (opencode-bench, langwatch approach)
**Pros:**
- Language-agnostic, well-understood
- Network-transparent

**Cons:**
- Requires network setup, port management, service lifecycle
- Overkill for local scripts
- Adds latency and failure modes

**Verdict:** Better for distributed systems, unnecessary for local evaluation

## Risks and Trade-offs

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Process spawn overhead | 10-50ms per evaluation | Acceptable for evaluation workloads; batch operations amortize cost |
| Debugging complexity | Harder than in-process | Standard debugging tools work; console logs to stderr preserved |
| Language support limitations | Currently TypeScript-only | Wire format is language-agnostic; other languages can implement equivalent SDKs |
| State sharing impossible | Each evaluation isolated | By design - ensures reproducibility and parallelization |

## Future Extensions

### In-process development mode
Add optional `runInProcess: true` flag to `defineCodeJudge` for:
- Faster iteration during judge development
- Easier debugging with direct stack traces
- Production still uses out-of-process for isolation

### Multi-language SDK parity
Python, Go, Rust can implement equivalent helpers:
- Share stdin/stdout JSON contract
- Provide language-idiomatic APIs
- Interoperate seamlessly with TypeScript judges

### Streaming evaluation (if needed)
Extend protocol with line-delimited JSON for:
- Progress updates during long evaluations
- Partial results
- Still avoids JSON-RPC complexity

## Wire Format

### Input Schema (snake_case on wire, converted to camelCase in TypeScript)

```typescript
{
  question: string;
  expected_outcome: string;
  expected_messages: JsonObject[];
  reference_answer?: string;
  candidate_answer: string;
  output_messages?: OutputMessage[];
  guideline_files: string[];
  input_files: string[];
  input_messages: TestMessage[];
  trace_summary?: TraceSummary | null;
  config?: JsonObject | null;
}
```

### Output Schema

```typescript
{
  score: number;        // 0.0 - 1.0 (clamped by runtime)
  hits?: string[];      // Optional successes
  misses?: string[];    // Optional failures
  reasoning?: string;   // Optional explanation
}
```

### Error Handling

If the judge script exits non-zero or writes invalid JSON:
- Runtime catches the error
- Returns `{ score: 0, misses: [error message], reasoning: error }`
- Evaluation continues (doesn't crash entire run)

## Implementation

### Core Packages

**packages/eval/**
- SDK for judge authors
- `defineCodeJudge` function and runtime
- Zod schemas for input/output validation
- Case conversion utilities

**packages/core/src/evaluation/evaluators.ts**
- Invokes judges via `execFileWithStdin`
- Aggregates results from composite evaluators
- Handles timeouts and retries

**packages/core/src/runtime/exec.ts**
- Process spawn with stdin/stdout handling
- Error capture and formatting
- Exit code validation

### Type Safety

**Runtime validation:**
- `CodeJudgeInputSchema` (Zod) - Validates input payload structure and types
- `CodeJudgeResultSchema` (Zod) - Validates output payload structure and types
- Score clamping to [0, 1] range
- Array sanitization (non-empty strings only)

**Compile-time safety:**
- TypeScript types inferred from Zod schemas
- Generic `CodeJudgeHandler` type for user functions
- Structural validation catches errors before runtime
