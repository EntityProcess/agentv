# Change: Document Code Judge Wire Schema + Optional TS SDK

## Why
Code judge evaluators need a stable, language-agnostic wire payload while keeping TypeScript ergonomics (camelCase). Documenting the schema and providing optional TS SDK reduces drift and clarifies the contract for third-party evaluators without forcing SDK adoption.

## What Changed
- Documented the canonical code_judge payload schema using snake_case wire keys (no new envelope/versioning)
- Added optional TypeScript SDK (`code-judge-sdk.ts`) that exposes camelCase types and converts to/from the wire schema
- Made conversion functions (`toCamelCaseDeep`, `toSnakeCaseDeep`) internal implementation details
- Added integration test verifying SDK-based code judges work correctly
- Added feature example (`examples/features/code-judge-sdk/`) demonstrating SDK usage
- Made examples work out of the box via workspace dependencies

## Impact
- Affected specs: evaluation
- Affected code:
  - Created: `packages/core/src/evaluation/code-judge-sdk.ts` (SDK module)
  - Modified: `packages/core/src/evaluation/evaluators.ts` (uses `toSnakeCaseDeep` for payload)
  - Created: `packages/core/src/evaluation/case-conversion.ts` (shared conversion functions)
  - Tests: Added integration test in `packages/core/test/evaluation/evaluators.test.ts`
  - Examples: Added `examples/features/code-judge-sdk/` with working example
  - Workspace: Added examples to workspace for out-of-box functionality
