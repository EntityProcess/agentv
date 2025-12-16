# Tasks: Composite Evaluator

1.  **Define Configuration Types**
    *   Add `CompositeEvaluatorConfig` and `AggregationConfig` to `types.ts`.
    *   Update `EvaluatorConfig` union to include `CompositeEvaluatorConfig`.

2.  **Implement `CompositeEvaluator` Class**
    *   Create `CompositeEvaluator` class implementing `Evaluator`.
    *   Implement parallel execution of members.

3.  **Implement Aggregation Strategies**
    *   Implement `weighted_average` logic.
    *   Implement `code_judge` logic (using `child_process` similar to `CodeEvaluator`).
    *   Implement `llm_judge` logic (using `LlmJudgeEvaluator` internally or shared provider logic).

4.  **Update Factory and Parser**
    *   Update `yaml-parser.ts` to parse `composite` type.
    *   Update `evaluator-factory.ts` (or equivalent) to handle recursive creation of members.

5.  **Validation & Testing**
    *   Unit test: Weighted average aggregation.
    *   Unit test: Code meta-judge (e.g., safety gate pattern).
    *   Integration test: Composite evaluator with mocked members.
