## 1. Remove Old SDK

- [ ] 1.1 Delete `packages/core/src/evaluation/code-judge-sdk.ts`
- [ ] 1.2 Remove `code-judge-sdk.ts` export from `packages/core/src/index.ts`
- [ ] 1.3 Delete old test fixture `packages/core/test/fixtures/test-sdk-judge.ts` (if exists)

## 2. Core SDK Implementation

- [ ] 2.1 Create `packages/core/src/judge/schemas.ts` with Zod schemas for `CodeJudgeInput` and `CodeJudgeResult`
- [ ] 2.2 Create `packages/core/src/judge/runtime.ts` with `runCodeJudge()` implementation (stdin, validation, error handling)
- [ ] 2.3 Create `packages/core/src/judge/index.ts` with public API exports (`defineCodeJudge`, types, re-exports)
- [ ] 2.4 Add `./judge` export to `packages/core/package.json`
- [ ] 2.5 Update `packages/core/src/index.ts` to re-export judge module

## 3. Testing

- [ ] 3.1 Create unit tests for `defineCodeJudge()` in `packages/core/test/judge/`
- [ ] 3.2 Test: handler receives correctly typed input
- [ ] 3.3 Test: output validation clamps score to [0, 1]
- [ ] 3.4 Test: error handling produces valid failure result
- [ ] 3.5 Test: integration with existing evaluator infrastructure

## 4. Examples Update

- [ ] 4.1 Update `examples/showcase/tool-evaluation-plugins/scripts/efficiency-scorer.ts` to use `defineCodeJudge`
- [ ] 4.2 Update `examples/features/execution-metrics/scripts/check-efficiency.ts` to use `defineCodeJudge`
- [ ] 4.3 Verify examples pass with `bun agentv run`

## 5. Documentation

- [ ] 5.1 Update skill reference `apps/cli/src/templates/.claude/skills/agentv-eval-builder/references/custom-evaluators.md`
- [ ] 5.2 Add migration note to CHANGELOG.md

## 6. Verification

- [ ] 6.1 Run `bun run build` - verify compilation
- [ ] 6.2 Run `bun run typecheck` - verify type safety
- [ ] 6.3 Run `bun run lint` - verify code style
- [ ] 6.4 Run `bun test` - verify all tests pass
