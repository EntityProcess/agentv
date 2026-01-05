# Change: Add `defineCodeJudge` SDK for improved code evaluator DX

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
- **ADDED**: Re-exported `TraceSummary` type from `@agentv/core/judge` entrypoint
- **ADDED**: Optional typed config support via Zod schema parameter
- **MODIFIED**: Existing SDK remains backward-compatible (`readCodeJudgePayload` still works)

## Impact

- **Affected specs**: `evaluation` (existing "Optional TypeScript SDK" requirement extended)
- **Affected code**:
  - `packages/core/src/judge/` (new directory)
  - `packages/core/src/index.ts` (add export)
  - `packages/core/package.json` (add `./judge` export)
  - `examples/` (update to use new API)
- **Breaking changes**: None - existing API preserved
