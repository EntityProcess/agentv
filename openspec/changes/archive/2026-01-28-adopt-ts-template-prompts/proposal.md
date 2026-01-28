# Adopt TypeScript Template Literals for Custom Evaluator Prompts

## Summary
Enable the use of native TypeScript template literals for defining custom evaluator prompts using the same subprocess pattern as code judges. This provides type safety, complex logic support, and a consistent developer experience.

## Problem
Currently, `LlmJudgeEvaluator` relies on string templates with `{{variable}}` placeholders. This approach:
- Lacks type safety: No compile-time check if variables exist in the context.
- Has limited logic: Conditional logic or loops require complex template syntax or are impossible.
- Is error-prone: Typos in placeholders are only caught at runtime.

## Solution
Follow the established code judge pattern:

1. Add a `definePromptTemplate` SDK wrapper to `@agentv/eval` that handles stdin/stdout, mirroring `defineCodeJudge`.
2. Update the evaluator loader to detect `.ts`/`.js` prompt files and execute them as subprocesses.
3. The script receives evaluation context via stdin (JSON), returns the prompt string via stdout.

Users write prompt templates the same way they write code judges:

```typescript
import { definePromptTemplate } from '@agentv/eval';

export default definePromptTemplate((context) => `
  Question: ${context.question}
  Answer: ${context.candidateAnswer}

  ${context.config?.includeRubric ? `Rubric: ${context.referenceAnswer}` : ''}
`);
```

## Impact
- **Core**: `orchestrator.ts` loader logic to detect and execute `.ts`/`.js` prompts as subprocesses.
- **SDK**: New `definePromptTemplate` wrapper in `@agentv/eval`.
- **DX**: Consistent pattern with code judges - same mental model.
- **Dependencies**: None - uses existing subprocess infrastructure.
- **Backward Compatibility**: Existing string-based templates and `.txt` prompt files continue to work.
