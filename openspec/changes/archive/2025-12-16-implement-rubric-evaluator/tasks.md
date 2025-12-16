# Tasks: Implement Rubric Evaluator

- [x] **Update Types**: Add `RubricEvaluatorConfig`, `RubricItem`, and `EvaluationVerdict` to `packages/core/src/evaluation/types.ts`. <!-- id: update-types -->
- [x] **Implement Rubric Evaluator**: Create `packages/core/src/evaluation/evaluators/rubric-evaluator.ts` implementing the `Evaluator` interface with `generateObject` logic. <!-- id: impl-evaluator -->
- [x] **Implement Generator**: Create `packages/core/src/evaluation/generators/rubric-generator.ts` to handle the LLM generation logic. <!-- id: impl-generator -->
- [x] **Implement CLI Command**: Add `generate` command group and `rubrics` subcommand to `apps/cli` to update YAML files with generated rubrics. <!-- id: impl-cli -->
- [x] **Update Orchestrator**: Register `rubric` evaluator type in `packages/core/src/evaluation/orchestrator.ts`. <!-- id: update-orchestrator -->
- [x] **Update YAML Parser**: Modify `packages/core/src/evaluation/yaml-parser.ts` to handle `expected_outcome` (alias `outcome`) and map `rubrics` field to `RubricEvaluator`. <!-- id: update-parser -->
- [ ] **Add Tests**: Create unit tests for `RubricEvaluator` and the generator. <!-- id: add-tests -->
- [ ] **Verify**: Run `agentv generate rubrics` on a sample file, then run `agentv` to verify the end-to-end flow. <!-- id: verify -->
