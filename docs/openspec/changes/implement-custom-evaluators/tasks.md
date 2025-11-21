# Tasks: Implement Custom Evaluators

- [ ] **Update Types**: Add `evaluators` and `EvaluatorConfig` to `packages/core/src/evaluation/types.ts`. <!-- id: update-types -->
- [ ] **Update YAML Parser**: Ensure `yaml-parser.ts` correctly reads and validates the `evaluators` list from YAML files. <!-- id: update-parser -->
- [ ] **Refactor QualityGrader**: Update `QualityGrader` in `grading.ts` to accept an optional `customPrompt` in its constructor or `grade` method. <!-- id: refactor-grader -->
- [ ] **Implement Orchestrator Logic**: Modify `runEvalCase` in `orchestrator.ts` to iterate over `evaluators` and execute them. <!-- id: update-orchestrator -->
- [ ] **Remove Heuristic Grader**: Remove the `HeuristicGrader` class and `packages/core/src/evaluation/scoring.ts`, as they are being replaced by explicit evaluators. <!-- id: remove-heuristic -->
- [ ] **Add Legacy Fallback**: Ensure that if `evaluators` is undefined, the system falls back to the existing `grader` field behavior. <!-- id: legacy-fallback -->
- [ ] **Test Custom Prompt**: Create a test case with a custom LLM judge prompt and verify it is used. <!-- id: test-custom-prompt -->
