# Design: Unified Evaluator

## Architecture

The `LlmJudgeEvaluator` will serve as the single entry point for LLM-based evaluation. It will internally switch strategies based on the configuration.

### Class Structure

```typescript
export class LlmJudgeEvaluator implements Evaluator {
  readonly kind = 'llm_judge';

  constructor(options: LlmJudgeEvaluatorOptions) { ... }

  async evaluate(context: EvaluationContext): Promise<EvaluationScore> {
    if (this.config.rubrics && this.config.rubrics.length > 0) {
      return this.evaluateWithRubrics(context);
    }
    return this.evaluateFreeform(context);
  }

  private async evaluateWithRubrics(context: EvaluationContext): Promise<EvaluationScore> {
    // Logic from RubricEvaluator
    // ...
    // Returns score, verdict, hits (satisfied rubrics), misses (unsatisfied rubrics)
  }

  private async evaluateFreeform(context: EvaluationContext): Promise<EvaluationScore> {
    // Logic from LlmJudgeEvaluator
    // ...
    // Returns score, hits (LLM generated), misses (LLM generated)
    // NEW: Calculate verdict from score
  }
}
```

### Configuration

The configuration type will be unified:

```typescript
export type LlmJudgeEvaluatorConfig = {
  readonly name: string;
  readonly type: 'llm_judge';
  readonly prompt?: string; // Custom template for freeform mode
  readonly rubrics?: readonly RubricItem[]; // Triggers rubric mode
  // ... other options like maxOutputTokens, temperature
};
```

### Verdict Calculation

To ensure consistency, `verdict` will be a first-class citizen in `EvaluationScore`.

*   **Rubric Mode**:
    *   Fail if any `required` rubric is missed.
    *   Otherwise, map score to verdict:
        *   `>= 0.8`: Pass
        *   `>= 0.6`: Borderline
        *   `< 0.6`: Fail

*   **Freeform Mode**:
    *   Map score to verdict using the same thresholds:
        *   `>= 0.8`: Pass
        *   `>= 0.6`: Borderline
        *   `< 0.6`: Fail

### Hits and Misses

*   **Rubric Mode**: `hits` and `misses` are strictly derived from the rubric items. This provides deterministic feedback.
*   **Freeform Mode**: `hits` and `misses` are generative. This provides qualitative feedback where strict rubrics aren't defined.

## Trade-offs

*   **Complexity**: The `LlmJudgeEvaluator` becomes slightly more complex as it handles two modes. However, this reduces the overall system complexity by removing a separate evaluator class and unifying the configuration surface.
*   **Backward Compatibility**: We need to support `type: 'llm_judge'` and `type: 'rubric'` in the YAML parser for a while. The parser will map these to `LlmJudgeEvaluatorConfig`.

## Implementation Details

### Shared Execution Engine
To address the disparity in retry logic and provider interaction, `LlmJudgeEvaluator` will implement a shared execution method:

```typescript
private async runWithRetry<T>(
  context: EvaluationContext,
  systemPrompt: string,
  userPrompt: string,
  schema: z.ZodSchema<T>
): Promise<T> {
  // 1. Resolve Provider
  const judgeProvider = await this.resolveJudgeProvider(context);
  if (!judgeProvider) throw new Error('No judge provider available');

  // 2. Prefer Vercel AI SDK (asLanguageModel) if available
  if (judgeProvider.asLanguageModel) {
    const model = judgeProvider.asLanguageModel();
    // Use a retry loop (e.g., 3 attempts) with generateText
    // Parse JSON and validate with schema
    // Return typed result
  } 
  
  // 3. Fallback to invoke() (Legacy)
  // Use judgeProvider.invoke()
  // Attempt to parse JSON from response.text
  // Validate with schema
  // If parsing fails, throw (so we can retry if we wrap this in a loop, 
  // or implement a loop here for invoke as well)
}
```

### Refactored Methods
*   `evaluateWithRubrics`:
    *   Builds rubric-specific prompt.
    *   Defines `rubricEvaluationSchema`.
    *   Calls `runWithRetry`.
    *   Calculates score/verdict from result.
*   `evaluateFreeform`:
    *   Builds freeform prompt (template).
    *   Defines `freeformEvaluationSchema` (score, hits, misses).
    *   Calls `runWithRetry`.
    *   Calculates verdict from score.

### Benefits
*   **Robustness**: Freeform evaluation gains the retry logic previously only available to rubrics.
*   **Consistency**: Both modes use the same underlying mechanism for LLM interaction.
*   **Maintainability**: Single place to fix JSON parsing or provider issues.

### Configuration Mapping
The `yaml-parser` must handle the conversion:
*   `type: 'rubric'` -> `type: 'prompt'`, `rubrics` populated from config.
*   `type: 'llm_judge'` -> `type: 'prompt'`, `rubrics` undefined.

