# Design: TypeScript Template Literals for Evaluator Prompts

## Architecture
The core idea is to leverage TypeScript's first-class function capabilities to replace the need for a custom string templating engine for code-defined evaluators.

### `PromptTemplate` Type
We will define a type alias for the prompt generation function:

```typescript
export type PromptTemplate = (context: EvaluationContext) => string;
```

### `LlmJudgeEvaluator` Updates
The `LlmJudgeEvaluator` currently holds an optional `evaluatorTemplate` string. We will expand this to a union type:

```typescript
export interface LlmJudgeEvaluatorOptions {
  // ...
  readonly evaluatorTemplate?: string | PromptTemplate;
}
```

In the `evaluateWithPrompt` method, we will check the type of `evaluatorTemplate`:
1. If it's a function, we call it with the current `EvaluationContext`.
2. If it's a string (or undefined, falling back to default), we proceed with the existing string substitution logic.

### Evaluator Loading
To support the "simplified DX" where users just export a function, we need to update `resolveCustomPrompt` (or the relevant loading logic) in `orchestrator.ts`.

We will use a library like `jiti` to dynamically import TypeScript files at runtime.

**User Contract:**
The user's TypeScript file should export a function named `prompt` or a default export that matches the `PromptTemplate` signature.

```typescript
// my-evaluator.ts
import type { EvaluationContext } from '@agentv/core';

export const prompt = (context: EvaluationContext) => `
  Question: ${context.promptInputs.question}
  ...
`;
```

**Loader Logic:**
1.  Check if `prompt` path ends in `.ts` or `.js`.
2.  Use `jiti` (or dynamic import) to load the module.
3.  Extract the `prompt` export or `default` export.
4.  Validate it is a function.
5.  Return it as the `evaluatorTemplateOverride`.

## Trade-offs
- **Runtime Dependency**: Adding `jiti` adds a dependency, but enables a seamless TS experience.
- **Security**: Loading and executing user code implies trust. This is already the case with `code` evaluators, but now we are running it in-process (if using `jiti`). This is acceptable for a CLI tool intended to be run by developers on their own code.

## Alternatives
- **Nunjucks/Handlebars**: We could integrate a full templating engine, but that adds runtime weight and doesn't solve the type safety issue for code-defined evaluators.
- **JSX/Svelte**: We could use component-based rendering, but that requires a build step and is overkill for the current needs of the CLI agent.

