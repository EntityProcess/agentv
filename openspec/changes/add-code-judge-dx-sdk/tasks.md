## 1. Remove Old SDK

- [x] 1.1 Delete `packages/core/src/evaluation/code-judge-sdk.ts`
- [x] 1.2 Remove `code-judge-sdk.ts` export from `packages/core/src/index.ts`
- [x] 1.3 Delete old test fixture `packages/core/test/fixtures/test-sdk-judge.ts` (if exists)

## 2. Core SDK Implementation

- [x] 2.1 Create `packages/core/src/judge/schemas.ts` with Zod schemas for `CodeJudgeInput` and `CodeJudgeResult`
- [x] 2.2 Create `packages/core/src/judge/runtime.ts` with `runCodeJudge()` implementation (stdin, validation, error handling)
- [x] 2.3 Create `packages/core/src/judge/index.ts` with public API exports (`defineCodeJudge`, types, re-exports)
- [x] 2.4 Add `./judge` export to `packages/core/package.json`
- [x] 2.5 Update `packages/core/src/index.ts` to re-export judge module

## 3. Testing

- [x] 3.1 Create unit tests for `defineCodeJudge()` in `packages/core/test/judge/`
- [x] 3.2 Test: handler receives correctly typed input
- [x] 3.3 Test: output validation clamps score to [0, 1]
- [x] 3.4 Test: error handling produces valid failure result
- [x] 3.5 Test: integration with existing evaluator infrastructure

## 4. Examples Update

- [x] 4.1 Update `examples/showcase/tool-evaluation-plugins/scripts/efficiency-scorer.ts` to use `defineCodeJudge`
- [x] 4.2 Update `examples/features/execution-metrics/scripts/check-efficiency.ts` to use `defineCodeJudge`
- [x] 4.3 Update all other code judge examples (`check-metrics-present.ts`, `tool-selection-judge.ts`, `pairwise-tool-compare.ts`, `validate_risk_output.ts`, `verify-attachments.ts`)

## 5. Documentation

- [x] 5.1 Update skill reference `apps/cli/src/templates/.claude/skills/agentv-eval-builder/references/custom-evaluators.md`
- [x] 5.2 Update `examples/features/code-judge-sdk/README.md`

## 6. Verification

- [x] 6.1 Run `bun run build` - verify compilation
- [x] 6.2 Run `bun run typecheck` - verify type safety
- [x] 6.3 Run `bun run lint` - verify code style (with fix)
- [x] 6.4 Run `bun test` - verify all tests pass (202 + 28 tests)
