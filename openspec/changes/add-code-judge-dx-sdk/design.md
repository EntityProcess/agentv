# Design: Code Judge DX SDK

## Context

Code judge evaluators are TypeScript/JavaScript scripts that:
1. Read JSON from stdin (snake_case format)
2. Evaluate the candidate answer
3. Write JSON to stdout (`{ score, hits, misses, reasoning }`)

The current SDK provides `readCodeJudgePayload()` which handles stdin parsing and case conversion, but authors still need boilerplate for error handling, output formatting, and type definitions.

**Stakeholders**: Evaluation authors, SDK maintainers

## Goals / Non-Goals

### Goals
- Reduce code judge boilerplate from ~100 lines to ~20 lines
- Provide compile-time type safety for inputs and outputs
- Validate output schema at runtime to catch errors early
- Support typed custom config with Zod schemas
- Maintain backward compatibility with existing `readCodeJudgePayload()` API

### Non-Goals
- Change the wire format (snake_case JSON contract is preserved)
- Support languages other than TypeScript/JavaScript
- Add async streaming or other advanced patterns

## Decisions

### Decision: Functional builder pattern with `defineCodeJudge()`

**Rationale**: Following TypeScript SDK best practices (Vercel AI SDK, tRPC, Zod), a functional builder provides:
- Single entrypoint that handles all boilerplate
- Type inference from handler return type
- Default export pattern eliminates `export {}` requirement
- Familiar pattern for TypeScript developers

**Alternative considered**: Class-based approach (`class MyEvaluator extends CodeJudge`)
- More verbose, requires `new` + `.run()` calls
- Less ergonomic for simple evaluators
- Kept as optional secondary pattern for complex cases

### Decision: Zod schemas for input/output validation

**Rationale**:
- Zod is already a project dependency (`packages/core/package.json`)
- Provides both compile-time types and runtime validation
- Familiar to TypeScript developers
- Enables typed custom config via `z.infer<>`

### Decision: Separate `@agentv/core/judge` entrypoint

**Rationale**:
- Keeps judge-specific code isolated
- Smaller bundle for evaluators that only need judge utilities
- Clear import path: `import { defineCodeJudge } from '@agentv/core/judge'`

## API Design

### Primary API: `defineCodeJudge(handler)`

```typescript
import { defineCodeJudge } from '@agentv/core/judge';

export default defineCodeJudge(({ traceSummary, candidateAnswer }) => {
  if (!traceSummary) {
    return { score: 0.5, reasoning: 'No trace available' };
  }

  return {
    score: traceSummary.eventCount <= 5 ? 1.0 : 0.5,
    hits: ['Efficient tool usage'],
    misses: [],
  };
});
```

### With Typed Config

```typescript
import { defineCodeJudge, z } from '@agentv/core/judge';

const ConfigSchema = z.object({
  maxToolCalls: z.number().default(10),
  strictMode: z.boolean().default(false),
});

export default defineCodeJudge(
  ({ traceSummary, config }) => {
    const { maxToolCalls } = ConfigSchema.parse(config ?? {});
    // ...
  }
);
```

### Type Definitions

```typescript
// Input schema (camelCase, converted from snake_case wire format)
export interface CodeJudgeInput {
  readonly question: string;
  readonly expectedOutcome: string;
  readonly expectedMessages: readonly JsonObject[];
  readonly referenceAnswer?: string;
  readonly candidateAnswer: string;
  readonly outputMessages?: readonly OutputMessage[] | null;
  readonly guidelineFiles: readonly string[];
  readonly inputFiles: readonly string[];
  readonly inputMessages: readonly TestMessage[];
  readonly traceSummary?: TraceSummary | null;
  readonly config?: JsonObject | null;
}

// Output schema (validated before writing)
export interface CodeJudgeResult {
  readonly score: number;        // 0.0 - 1.0
  readonly hits?: readonly string[];
  readonly misses?: readonly string[];
  readonly reasoning?: string;
}
```

## Implementation Details

### Runtime Flow

```
1. User calls `defineCodeJudge(handler)`
   └─> Registers handler, returns void (side effect: runs evaluator)

2. `runCodeJudge()` executes:
   a. Read stdin (Bun.stdin.text() or process.stdin)
   b. JSON.parse() the raw input
   c. toCamelCaseDeep() for TypeScript ergonomics
   d. Validate with CodeJudgeInputSchema.parse()
   e. Call user handler with validated input
   f. Validate output with CodeJudgeResultSchema.parse()
   g. Clamp score to [0, 1]
   h. console.log(JSON.stringify(result))

3. On error:
   a. Catch exception
   b. Format error message
   c. Output { score: 0, misses: [error], reasoning: error }
   d. process.exit(1)
```

### File Structure

```
packages/core/src/
├── judge/
│   ├── index.ts       # Public API: defineCodeJudge, types, re-exports
│   ├── schemas.ts     # Zod schemas for input/output validation
│   └── runtime.ts     # Internal: stdin handling, validation, error formatting
├── evaluation/
│   ├── code-judge-sdk.ts  # Existing (preserved for backward compatibility)
│   └── ...
└── index.ts           # Add: export * from './judge/index.js'
```

### Package.json Export

```json
{
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./judge": {
      "import": "./dist/judge/index.js",
      "types": "./dist/judge/index.d.ts"
    }
  }
}
```

## Risks / Trade-offs

### Risk: Bundle size increase for evaluators
- **Mitigation**: Separate `./judge` entrypoint keeps imports minimal
- **Trade-off**: Users need to know about the entrypoint

### Risk: Zod adds runtime overhead
- **Mitigation**: Zod is already in dependency tree; validation is fast for small payloads
- **Trade-off**: Acceptable for evaluators (not hot path)

### Risk: Default export pattern may confuse users
- **Mitigation**: Clear documentation and examples
- **Trade-off**: Eliminates `export {}` boilerplate

## Migration Plan

1. **Phase 1**: Add new API alongside existing SDK (backward compatible)
2. **Phase 2**: Update examples to use `defineCodeJudge`
3. **Phase 3**: Document migration path in changelog
4. **No deprecation planned**: `readCodeJudgePayload()` remains available

## Open Questions

None - design is straightforward and follows established patterns.
