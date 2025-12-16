# Tasks: Unified Evaluator

1.  **Refactor `LlmJudgeEvaluator` to `PromptEvaluator`**
    *   Rename class `LlmJudgeEvaluator` to `PromptEvaluator`.
    *   Update `kind` to `'prompt'` (keep `'llm_judge'` as alias in parser).
    *   Update `LlmJudgeEvaluatorConfig` to `PromptEvaluatorConfig` and add `rubrics` field.

2.  **Implement Unified Logic**
    *   Implement `runWithRetry` helper method (LLM call + JSON parsing + 3 retries).
    *   Move `RubricEvaluator` logic (prompt building, schema parsing, scoring) into `PromptEvaluator` as a private method/strategy using `runWithRetry`.
    *   Refactor `evaluateFreeform` (existing logic) to use `runWithRetry` and Zod schema validation.
    *   Add verdict calculation to `evaluateFreeform`.

3.  **Update Parsers and Types**
    *   Update `yaml-parser.ts` to map `type: 'rubric'` and `type: 'llm_judge'` to `PromptEvaluatorConfig`.
    *   Update `types.ts` to reflect new config structure.

4.  **Cleanup**
    *   Remove `RubricEvaluator` class.
    *   Update tests to use `PromptEvaluator`.

5.  **Validation**
    *   Verify `rubric` mode still works with existing rubric tests.
    *   Verify `llm_judge` mode works and now returns a verdict.
