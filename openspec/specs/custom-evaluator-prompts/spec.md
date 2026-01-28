# custom-evaluator-prompts Specification

## Purpose
TBD - created by archiving change adopt-ts-template-prompts. Update Purpose after archive.
## Requirements
### Requirement: SDK Wrapper for Prompt Templates
The `@agentv/eval` package MUST provide a `definePromptTemplate` helper that handles stdin/stdout, mirroring the `defineCodeJudge` pattern.

#### Scenario: Using definePromptTemplate
Given a TypeScript file that uses `definePromptTemplate`
When the file is executed as a subprocess
Then it should read evaluation context from stdin (JSON)
And output the generated prompt string to stdout

```typescript
import { definePromptTemplate } from '@agentv/eval';

export default definePromptTemplate((ctx) => `
  Question: ${ctx.question}
  Answer: ${ctx.candidateAnswer}
`);
```

#### Scenario: Type safety with PromptTemplateInput
Given a developer writing a prompt template
When they use `definePromptTemplate`
Then TypeScript should provide autocomplete for `ctx.question`, `ctx.candidateAnswer`, `ctx.referenceAnswer`, etc.

#### Scenario: Async prompt generation
Given a prompt template that needs async operations
When the handler returns a Promise
Then the wrapper should await and output the resolved string

```typescript
export default definePromptTemplate(async (ctx) => {
  const extraContext = await fetchSomeData();
  return `Question: ${ctx.question}\nContext: ${extraContext}`;
});
```

### Requirement: Executable Prompt File Detection
The evaluator loader MUST detect `.ts` and `.js` prompt files and execute them as subprocesses.

#### Scenario: Loading a TypeScript prompt template
Given an eval case with `prompt: ./my-prompt.ts`
When the evaluator runs
Then it should execute the file as a subprocess using `bun run`
And pass the evaluation context via stdin as JSON
And use stdout as the prompt string

#### Scenario: Loading a JavaScript prompt template
Given an eval case with `prompt: ./my-prompt.js`
When the evaluator runs
Then it should execute the file as a subprocess
And use stdout as the prompt string

#### Scenario: Backward compatibility with text files
Given an eval case with `prompt: ./my-prompt.txt`
When the evaluator runs
Then it should read the file as text (existing behavior)
And apply `{{variable}}` substitution

### Requirement: Consistent Input Schema
The prompt template input MUST use the same schema as code judges for consistency.

#### Scenario: Input fields available
Given a prompt template handler
Then the input should include:
- `question` - the eval case question
- `candidateAnswer` - the agent's response
- `referenceAnswer` - optional reference answer
- `expectedOutcome` - optional expected outcome
- `expectedMessages` - optional expected messages
- `outputMessages` - optional output messages from agent
- `guidelineFiles` - paths to guideline files
- `inputFiles` - paths to input files
- `inputMessages` - input messages to agent
- `traceSummary` - optional trace summary
- `config` - optional pass-through config from YAML

### Requirement: Error Handling
The subprocess execution MUST handle errors gracefully.

#### Scenario: Script exits with non-zero code
Given a prompt template script that throws an error
When it is executed
Then the evaluator should fail with a descriptive error message
And include the script's stderr in the error

#### Scenario: Script outputs nothing
Given a prompt template script that outputs an empty string
When it is executed
Then the evaluator should use the empty string as the prompt

