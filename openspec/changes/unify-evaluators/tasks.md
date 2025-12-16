# Tasks: Unified Evaluator

- [x] Refactor `LlmJudgeEvaluator`
    - [x] Update `LlmJudgeEvaluatorConfig` to add `rubrics` field.
    - [x] Ensure `kind` is `'llm_judge'`.

- [x] Implement unified logic
    - [x] Implement `runWithRetry` helper method (LLM call + JSON parsing + 3 retries).
    - [x] Move `RubricEvaluator` logic (prompt building, schema parsing, scoring) into `LlmJudgeEvaluator` using `runWithRetry`.
    - [x] Refactor freeform evaluation to use `runWithRetry` and Zod schema validation.
    - [x] Add verdict calculation to freeform mode.

- [x] Update parsers and types
    - [x] Update `yaml-parser.ts` to map `type: 'rubric'` to `LlmJudgeEvaluatorConfig`.
    - [x] Update `types.ts` to reflect new config structure.

- [x] Cleanup
    - [x] Remove `RubricEvaluator` class.
    - [x] Update tests to use `LlmJudgeEvaluator`.

- [x] Validation
    - [x] Verify rubric mode works.
    - [x] Verify llm_judge mode works and returns a verdict.
