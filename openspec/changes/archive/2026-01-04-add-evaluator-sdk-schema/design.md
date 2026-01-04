## Context
AgentV already emits snake_case payloads for code_judge evaluators by converting internal TypeScript objects. We want to make the wire payload explicit and add optional TypeScript helpers without changing how evaluators consume stdin today.

## Goals / Non-Goals
- Goals:
  - Document the canonical code_judge wire payload in snake_case.
  - Provide optional TypeScript helpers with camelCase types and boundary mapping.
  - Keep core behavior unchanged and backward compatible.
- Non-Goals:
  - Introducing a versioned envelope or schema migration.
  - Adding Python SDKs or touching llm_judge evaluators.
  - Changing evaluator stdin wiring or required fields.

## Decisions
- Decision: The snake_case wire payload is the source of truth for code_judge evaluators.
- Decision: TypeScript remains idiomatic in core; mapping happens once at the wire boundary.
- Decision: Provide a lightweight TS helper module (types + parse/read) rather than a full SDK package.
- Decision: Export only user-facing functions (`readCodeJudgePayload`, `parseCodeJudgePayload`, `CodeJudgePayload` type).
- Decision: Keep conversion functions (`toCamelCaseDeep`, `toSnakeCaseDeep`) internal to avoid exposing implementation details.

## Implementation Details

### Data Flow
1. **AgentV Internal**: camelCase TypeScript objects
2. **Wire Format** (stdin to judges): snake_case JSON via `toSnakeCaseDeep()`
3. **TypeScript Judges** (optional): camelCase via SDK's `toCamelCaseDeep()`
4. **Python/other judges**: Native snake_case (no conversion needed)

### SDK Exports
```typescript
// User-facing exports from @agentv/core
export interface CodeJudgePayload { ... }  // camelCase types
export function parseCodeJudgePayload(payload: string): CodeJudgePayload
export function readCodeJudgePayload(): CodeJudgePayload
```

### Internal Implementation
- `toCamelCaseDeep()`: Converts snake_case wire format → camelCase for TS
- `toSnakeCaseDeep()`: Converts camelCase internal → snake_case wire format
- Both are internal implementation details, not exported

### Why Round-trip Conversion
- **Universal wire format**: snake_case works across all languages (Python, Ruby, etc.)
- **Language-specific ergonomics**: TypeScript gets camelCase, Python gets snake_case
- **Single source of truth**: One wire schema, optional conversion per language
- **Minimal overhead**: Conversion happens once per evaluation (negligible cost)

## Risks / Trade-offs
- Mapping drift between core and helpers → mitigated with shared conversion functions and integration tests
- Round-trip conversion (camelCase → snake_case → camelCase) → acceptable for language-agnostic protocol with language-specific ergonomics

## Migration Plan
- No migration required: keep the existing payload shape and document it as canonical.
- Existing judges continue to work unchanged (receive snake_case stdin)
- New TypeScript judges can optionally use SDK for camelCase ergonomics
