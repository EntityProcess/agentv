# Change: Replace code judge SDK with `defineCodeJudge` API

## Why

The current TypeScript SDK for code judges (`readCodeJudgePayload()`) requires significant boilerplate:

1. **`export {}`** - Every evaluator file needs this to be treated as a module
2. **Duplicated type definitions** - Authors re-declare `TraceSummary`, `EvalInput`, `EvalOutput` locally
3. **Boilerplate main function** - Every evaluator has identical try/catch stdin parsing pattern (~30 lines)
4. **No output validation** - Results are written with `JSON.stringify` without validation
5. **No typed config** - Custom evaluator config has no schema support

This creates friction for evaluator authors and leads to inconsistent implementations across examples.

## What Changes

- **ADDED**: `defineCodeJudge()` function - Declarative evaluator definition with automatic stdin/stdout handling
- **ADDED**: `CodeJudgeResult` schema with Zod validation - Compile-time + runtime safety for outputs
- **ADDED**: Re-exported `TraceSummary` type from `@agentv/eval` entrypoint
- **ADDED**: Optional typed config support via Zod schema parameter
- **REMOVED**: `readCodeJudgePayload()`, `parseCodeJudgePayload()`, `CodeJudgePayload` from `@agentv/core`
- **REMOVED**: `packages/core/src/evaluation/code-judge-sdk.ts`

## Impact

- **Affected specs**: `evaluation` (existing "Optional TypeScript SDK" requirement replaced)
- **Affected code**:
  - `packages/core/src/judge/` (new directory)
  - `packages/core/src/evaluation/code-judge-sdk.ts` (deleted)
  - `packages/core/src/index.ts` (remove old export, add new)
  - `packages/core/package.json` (add `./judge` export)
  - `examples/` (update to use new API)
- **Breaking changes**: Old SDK removed (no users yet)
