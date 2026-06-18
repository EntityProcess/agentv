# Prompt Template SDK

This example demonstrates using TypeScript files for custom LLM grader prompts using the `definePromptTemplate` helper from `@agentv/eval`.

## Features

- **Type-safe prompt generation**: Full TypeScript support with autocomplete for context fields
- **Conditional logic**: Use JavaScript/TypeScript conditionals for dynamic prompts
- **Config pass-through**: Access custom config from YAML in your prompt template
- **Same pattern as code graders**: Follows the familiar subprocess pattern

## How It Works

Instead of static text files with `{{variable}}` placeholders, you can use TypeScript files that export a prompt template:

```typescript
import { definePromptTemplate } from '@agentv/eval';

function textFromMessages(messages) {
  return messages
    .map((message) => typeof message.content === 'string' ? message.content : '')
    .filter(Boolean)
    .join('\n');
}

export default definePromptTemplate((ctx) => `
  Question: ${textFromMessages(ctx.input.filter((message) => message.role === 'user'))}
  Answer: ${ctx.output ?? ''}

  ${ctx.expectedOutput.length > 0 ? `Reference: ${textFromMessages(ctx.expectedOutput)}` : ''}
`);
```

The template receives evaluation context via stdin (JSON) and outputs the prompt string to stdout.

## Available Context Fields

- `input` - Input messages to agent
- `output` - The agent's final answer being evaluated
- `expectedOutput` - Optional expected output messages
- `criteria` - Optional criteria / expected outcome
- `messages` - Transcript messages from the target execution
- `inputFiles` - Paths to input files
- `trace` - Optional full trace with transcript and events
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
    custom-grader.ts  # TypeScript prompt template
  README.md
```
