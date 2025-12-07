# Tasks: Adopt TypeScript Template Literals for Custom Evaluator Prompts

- [ ] Add `jiti` (or equivalent) dependency to `@agentv/core` <!-- id: add-dep -->
- [ ] Define `PromptTemplate` type in `packages/core/src/evaluation/types.ts` <!-- id: define-type -->
- [ ] Update `LlmJudgeEvaluatorOptions` in `packages/core/src/evaluation/evaluators.ts` to accept `PromptTemplate` <!-- id: update-options -->
- [ ] Update `LlmJudgeEvaluator` implementation to handle `PromptTemplate` functions <!-- id: update-impl -->
- [ ] Update `resolveCustomPrompt` in `orchestrator.ts` to load `.ts` files using `jiti` <!-- id: update-loader -->
- [ ] Add unit tests for function-based prompt templates and loading <!-- id: add-tests -->
- [ ] Create a sample custom evaluator using the new pattern <!-- id: create-sample -->
