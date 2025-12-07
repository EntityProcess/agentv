# Spec: Custom Evaluator Prompts

## ADDED Requirements

### Requirement: Support Function-Based Prompt Templates
The `LlmJudgeEvaluator` MUST support `PromptTemplate` functions in addition to string templates.

#### Scenario: Using a function template
Given a custom evaluator defined in code
When I pass a function as `evaluatorTemplate` that uses template literals
Then the evaluator should use the output of that function as the prompt
And the function should receive the full `EvaluationContext`

```typescript
const myEvaluator = new LlmJudgeEvaluator({
  resolveJudgeProvider: myResolver,
  evaluatorTemplate: (context) => `
    Analyze the following:
    Question: ${context.promptInputs.question}
    Answer: ${context.candidate}
  `
});
```

#### Scenario: Backward compatibility with string templates
Given an existing evaluator configuration using a string template
When I run the evaluator
Then it should continue to function using the string substitution logic

### Requirement: Load Prompt from TypeScript File
The system MUST support loading a `PromptTemplate` function from a user-provided TypeScript file.

#### Scenario: Loading a named export
Given a TypeScript file `my-prompt.ts` that exports a `prompt` function
And an eval case configuration that points to this file
When the evaluator runs
Then it should load the file and use the exported `prompt` function as the template

#### Scenario: Loading a default export
Given a TypeScript file `my-prompt.ts` that has a default export of a function
And an eval case configuration that points to this file
When the evaluator runs
Then it should load the file and use the default export as the template

#### Scenario: Runtime TypeScript support
Given the agentv CLI running in a standard Node.js environment
When it loads a `.ts` prompt file
Then it should successfully compile/transpile and load the module without requiring the user to pre-compile it

### Requirement: Type Definitions
The `PromptTemplate` type MUST be exported and available for consumers.

#### Scenario: Type checking
Given a developer writing a custom prompt function
When they type the function argument
Then TypeScript should infer the `EvaluationContext` type and provide autocomplete for properties like `candidate`, `promptInputs`, etc.
