# Unified Evaluator

## Summary
Merge `RubricEvaluator` into `LlmJudgeEvaluator` to create a single, unified evaluator that handles both unstructured grading (score + reasoning) and structured grading (rubrics). This unifies the handling of `verdict`, `hits`, and `misses` across both modes.

## Motivation
Currently, `RubricEvaluator` and `LlmJudgeEvaluator` are separate classes with different behaviors:
*   `RubricEvaluator`: Uses structured `rubrics`, calculates `score` from weights, determines `verdict` (pass/fail), and generates `hits`/`misses` from specific checks.
*   `LlmJudgeEvaluator`: Uses a text prompt, asks LLM for `score`, `hits`, and `misses` directly. It does NOT currently calculate `verdict`.

Merging them simplifies the architecture and ensures consistent behavior. Users can simply add `rubrics` to their configuration to switch to the more rigorous rubric-based evaluation without changing the evaluator type.

## Proposed Changes

### 1. Refactor LlmJudgeEvaluator
*   Update `LlmJudgeEvaluatorConfig` to include an optional `rubrics` field.
*   Deprecate `RubricEvaluatorConfig` and `type: 'rubric'`.

### 2. Unified Logic in `LlmJudgeEvaluator`
Modify `LlmJudgeEvaluator.evaluate` to check for the presence of `rubrics`.

**Mode A: Rubric Mode (if `rubrics` are present)**
*   **Prompt**: Construct the prompt listing all rubrics (same as current `RubricEvaluator`).
*   **Output Schema**: Use the `checks` schema (id, satisfied, reasoning).
*   **Scoring**: Calculate score based on weighted satisfied rubrics.
*   **Verdict**: Determine `pass`/`fail`/`borderline` based on required items and score thresholds.
*   **Hits/Misses**: `hits` = satisfied rubrics, `misses` = unsatisfied rubrics.

**Mode B: Freeform Mode (if `rubrics` are missing)**
*   **Prompt**: Use the existing `DEFAULT_EVALUATOR_TEMPLATE` (or user override).
*   **Output Schema**: Use the existing schema (`score`, `hits`, `misses`, `reasoning`).
*   **Scoring**: Use the score returned by the LLM.
*   **Verdict**: **NEW**: Calculate verdict based on the returned score using default thresholds (e.g., >= 0.8 pass, < 0.6 fail).
*   **Hits/Misses**: Use the hits/misses returned by the LLM.

### 3. Verdict Standardization
Ensure `verdict` is always populated in `EvaluationScore`.
*   **Rubric Mode**: Already handles this.
*   **Freeform Mode**: Add logic to map `score` to `verdict`.
    *   `score >= 0.8` -> `pass`
    *   `0.6 <= score < 0.8` -> `borderline`
    *   `score < 0.6` -> `fail`

### 4. Implementation Details
*   **Shared Execution**: Implement a `runWithRetry` method in `LlmJudgeEvaluator` that handles the LLM interaction, JSON parsing, and retries (3 attempts) for *both* modes.
*   **Provider Compatibility**: Prefer `asLanguageModel` (Vercel AI SDK) if available, falling back to `invoke` (Legacy) if not. This ensures modern features are used where possible while maintaining compatibility.

## Migration Strategy
1.  Update `LlmJudgeEvaluator` to handle `rubrics`.
2.  Update `yaml-parser` to map `type: 'rubric'` config to the new unified `LlmJudgeEvaluator` with `rubrics` populated.
3.  Eventually remove `RubricEvaluator` class and `type: 'rubric'`.

## Future Work
*   **Rename `CodeEvaluator` to `CodeJudgeEvaluator`**: To align with the `llm_judge` / `code_judge` taxonomy.
*   **Add `CompositeEvaluator`**: To support teams of evaluators and meta-judges.
