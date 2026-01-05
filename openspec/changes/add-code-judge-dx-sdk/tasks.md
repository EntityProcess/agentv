## 1. Core SDK Implementation

- [ ] 1.1 Create `packages/core/src/judge/schemas.ts` with Zod schemas for `CodeJudgeInput` and `CodeJudgeResult`
- [ ] 1.2 Create `packages/core/src/judge/runtime.ts` with `runCodeJudge()` implementation (stdin, validation, error handling)
- [ ] 1.3 Create `packages/core/src/judge/index.ts` with public API exports (`defineCodeJudge`, types, re-exports)
- [ ] 1.4 Add `./judge` export to `packages/core/package.json`
- [ ] 1.5 Update `packages/core/src/index.ts` to re-export judge module

## 2. Testing

- [ ] 2.1 Create unit tests for `defineCodeJudge()` in `packages/core/test/judge/`
- [ ] 2.2 Test: handler receives correctly typed input
- [ ] 2.3 Test: output validation clamps score to [0, 1]
- [ ] 2.4 Test: error handling produces valid failure result
- [ ] 2.5 Test: integration with existing evaluator infrastructure

## 3. Examples Update

- [ ] 3.1 Update `examples/showcase/tool-evaluation-plugins/scripts/efficiency-scorer.ts` to use `defineCodeJudge`
- [ ] 3.2 Update `examples/features/execution-metrics/scripts/check-efficiency.ts` to use `defineCodeJudge`
- [ ] 3.3 Verify examples pass with `bun agentv run`

## 4. Documentation

- [ ] 4.1 Update skill reference `apps/cli/src/templates/.claude/skills/agentv-eval-builder/references/custom-evaluators.md`
- [ ] 4.2 Add migration note to CHANGELOG.md

## 5. Verification

- [ ] 5.1 Run `bun run build` - verify compilation
- [ ] 5.2 Run `bun run typecheck` - verify type safety
- [ ] 5.3 Run `bun run lint` - verify code style
- [ ] 5.4 Run `bun test` - verify all tests pass
