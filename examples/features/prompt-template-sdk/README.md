# Prompt Template SDK

This example demonstrates using TypeScript files for custom LLM judge prompts using the `definePromptTemplate` helper from `@agentv/eval`.

## Features

- **Type-safe prompt generation**: Full TypeScript support with autocomplete for context fields
- **Conditional logic**: Use JavaScript/TypeScript conditionals for dynamic prompts
- **Config pass-through**: Access custom config from YAML in your prompt template
- **Same pattern as code judges**: Follows the familiar subprocess pattern

## How It Works

Instead of static text files with `{{variable}}` placeholders, you can use TypeScript files that export a prompt template:

```typescript
import { definePromptTemplate } from '@agentv/eval';

export default definePromptTemplate((ctx) => `
  Question: ${ctx.question}
  Answer: ${ctx.candidateAnswer}

  ${ctx.referenceAnswer ? `Reference: ${ctx.referenceAnswer}` : ''}
`);
```

The template receives evaluation context via stdin (JSON) and outputs the prompt string to stdout.

## Available Context Fields

- `question` - The test question
- `candidateAnswer` - The agent's response being evaluated
- `referenceAnswer` - Optional reference answer
- `criteria` - Optional criteria / expected outcome
- `expectedOutput` - Optional expected output messages
- `outputMessages` - Optional output messages from agent
- `guidelineFiles` - Paths to guideline files
- `inputFiles` - Paths to input files
- `input` - Input messages to agent
- `traceSummary` - Optional trace summary with tool usage metrics
- `config` - Optional pass-through config from YAML

## Running

```bash
bun agentv eval examples/features/prompt-template-sdk/evals/dataset.eval.yaml --dry-run
```

## File Structure

```
prompt-template-sdk/
  evals/
    dataset.eval.yaml  # Tests using TypeScript prompt
  prompts/
    custom-evaluator.ts  # TypeScript prompt template
  README.md
```
