# Adopt TypeScript Template Literals for Custom Evaluator Prompts

## Summary
Enable the use of native TypeScript template literals for defining custom evaluator prompts in code-based evaluators. This provides type safety, better developer experience, and performance benefits over string-based templating with placeholders.

## Problem
Currently, `LlmJudgeEvaluator` relies on string templates with `{{variable}}` placeholders. This approach:
- Lacks type safety: No compile-time check if variables exist in the context.
- Has limited logic: Conditional logic or loops require complex template syntax or are impossible.
- Is error-prone: Typos in placeholders are only caught at runtime.

## Solution
1.  Introduce a `PromptTemplate` function type that accepts `EvaluationContext` and returns a string.
2.  Update `LlmJudgeEvaluator` to accept this function type.
3.  Enhance the evaluator loader to support loading `.ts` files directly. Users can simply export a `prompt` function from a TypeScript file, and AgentV will load and use it as the evaluator template.

## Impact
- **Core**: `LlmJudgeEvaluator`, `orchestrator.ts`, and loader logic.
- **DX**: Developers can write custom evaluators as simple TypeScript functions without boilerplate.
- **Dependencies**: May require adding a library like `jiti` to support runtime TypeScript loading.
- **Backward Compatibility**: Existing string-based templates will continue to work.
