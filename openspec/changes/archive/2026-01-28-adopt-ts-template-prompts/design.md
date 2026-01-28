# Design: TypeScript Template Literals for Evaluator Prompts

## Architecture

Follow the established code judge pattern: subprocess execution with an SDK wrapper that handles stdin/stdout.

### SDK: `definePromptTemplate`

Add to `@agentv/eval` package, mirroring `defineCodeJudge`:

```typescript
// packages/eval/src/prompt-template.ts
import { readFileSync } from 'node:fs';
import { toCamelCaseDeep } from './case-conversion.js';
import { PromptTemplateInputSchema, type PromptTemplateInput } from './schemas.js';

export type PromptTemplateHandler = (
  input: PromptTemplateInput,
) => string | Promise<string>;

function readStdin(): string {
  return readFileSync(0, 'utf8');
}

export async function runPromptTemplate(handler: PromptTemplateHandler): Promise<void> {
  try {
    const stdin = readStdin();
    const rawInput = JSON.parse(stdin) as Record<string, unknown>;
    const camelInput = toCamelCaseDeep(rawInput);
    const input = PromptTemplateInputSchema.parse(camelInput);

    const prompt = await handler(input);

    // Output raw string (not JSON) - the prompt itself
    console.log(prompt);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export function definePromptTemplate(handler: PromptTemplateHandler): void {
  runPromptTemplate(handler);
}
```

### Input Schema

Reuse the same input shape as code judges for consistency:

```typescript
// packages/eval/src/schemas.ts
export const PromptTemplateInputSchema = z.object({
  question: z.string(),
  expectedOutcome: z.string().optional(),
  expectedMessages: z.array(MessageSchema).optional(),
  referenceAnswer: z.string().optional(),
  candidateAnswer: z.string(),
  outputMessages: z.array(MessageSchema).nullable().optional(),
  guidelineFiles: z.array(z.string()).optional(),
  inputFiles: z.array(z.string()).optional(),
  inputMessages: z.array(MessageSchema).optional(),
  traceSummary: z.string().nullable().optional(),
  config: z.record(z.unknown()).nullable().optional(),
});

export type PromptTemplateInput = z.infer<typeof PromptTemplateInputSchema>;
```

### Core: Loader Changes

Update `resolveCustomPrompt` in `orchestrator.ts` to detect executable prompt files:

```typescript
async function resolveCustomPrompt(
  promptPath: string,
  context: EvaluationContext,
  cwd?: string,
): Promise<string> {
  const ext = path.extname(promptPath).toLowerCase();

  // Executable prompt template (same pattern as code judges)
  if (ext === '.ts' || ext === '.js') {
    return executePromptTemplate(promptPath, context, cwd);
  }

  // Static text file (existing behavior)
  const content = await readFile(promptPath, 'utf8');
  return substituteVariables(content, context);
}

async function executePromptTemplate(
  scriptPath: string,
  context: EvaluationContext,
  cwd?: string,
): Promise<string> {
  const payload = buildCodeJudgePayload(context); // Reuse existing payload builder
  const inputJson = JSON.stringify(toSnakeCaseDeep(payload), null, 2);

  // Execute using existing infrastructure
  const stdout = await executeScript(
    ['bun', 'run', scriptPath],
    inputJson,
    undefined, // timeout
    cwd,
  );

  return stdout.trim();
}
```

## User Experience

### Writing a Prompt Template

```typescript
// my-evaluator-prompt.ts
import { definePromptTemplate } from '@agentv/eval';

export default definePromptTemplate((ctx) => `
You are evaluating a response to the following question:

Question: ${ctx.question}

Candidate Answer:
${ctx.candidateAnswer}

${ctx.referenceAnswer ? `Reference Answer:\n${ctx.referenceAnswer}` : ''}

${ctx.config?.rubric ? `Evaluation Criteria:\n${ctx.config.rubric}` : ''}

Evaluate the candidate answer and provide a score from 0 to 1.
`);
```

### YAML Configuration

```yaml
cases:
  - id: example
    question: "What is the capital of France?"
    evaluator:
      type: llm_judge
      prompt: ./prompts/my-evaluator-prompt.ts  # Detected as executable
```

## Trade-offs

| Aspect | Subprocess Pattern | In-process (jiti) |
|--------|-------------------|-------------------|
| Consistency | Same as code judges | New pattern |
| Dependencies | None (existing infra) | Adds jiti |
| Performance | Process spawn overhead | Faster |
| Isolation | Sandboxed | In-process |
| Language support | Any (TS, Python, etc.) | TS/JS only |

The subprocess pattern is preferred because:
1. **Consistency** - Same mental model as code judges
2. **No new dependencies** - Uses existing `executeScript` infrastructure
3. **Isolation** - User code runs in separate process
4. **Language agnostic** - Could support Python prompt templates in future

## Alternatives Considered

### In-process loading with jiti
Rejected: Adds dependency, inconsistent with code judge pattern, runs user code in main process.

### Require pre-compiled JS only
Rejected: Worse DX - users already expect `bun run` to handle `.ts` files.
