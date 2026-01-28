# Design: TypeScript Template Literals for Evaluator Prompts

## Architecture

Follow the established code judge pattern: subprocess execution with an SDK wrapper that handles stdin/stdout, using **explicit script arrays** to specify the runtime.

### Key Design Decision: Explicit Script Arrays

Executable prompt templates use the same explicit script array pattern as `code_judge`:

```yaml
# code_judge pattern (existing)
evaluator:
  type: code_judge
  script: [bun, run, ../scripts/verify.ts]

# Executable prompt template (new - same pattern)
evaluator:
  type: llm_judge
  prompt:
    script: [bun, run, ../prompts/custom-evaluator.ts]
    config:
      rubric: "..."
```

**Why explicit script arrays instead of auto-detection?**

| Approach | Pros | Cons |
|----------|------|------|
| Auto-detect by extension (`.ts` → bun) | Less verbose | Ambiguous, magic behavior, limited to known runtimes |
| Explicit script array | Consistent with code_judge, supports any runtime | More verbose |

We chose explicit script arrays because:
1. **Consistency** - Same pattern as code_judge, one mental model
2. **No ambiguity** - User explicitly chooses bun, node, python, deno, etc.
3. **Future-proof** - Works with any runtime without code changes
4. **Aligns with design principles** - "Built-ins for Primitives Only" - the primitive is "execute a script"

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

### Core: Type Definitions

```typescript
// packages/core/src/evaluation/types.ts

/**
 * Executable prompt template configuration.
 * Matches code_judge pattern for consistency.
 */
export type PromptScriptConfig = {
  /** Command array to execute (e.g., ["bun", "run", "template.ts"]) */
  readonly script: readonly string[];
  /** Pass-through configuration for the prompt template */
  readonly config?: Record<string, unknown>;
};

export type LlmJudgeEvaluatorConfig = {
  readonly name: string;
  readonly type: 'llm_judge';
  /** Text prompt (inline or file path) or executable script config */
  readonly prompt?: string | PromptScriptConfig;
  // ... other fields
  /** Resolved script array for executable prompts (matches code_judge pattern) */
  readonly resolvedPromptScript?: readonly string[];
};
```

### Core: Loader Changes

The evaluator parser resolves `prompt.script` to `resolvedPromptScript`:

```typescript
// packages/core/src/evaluation/loaders/evaluator-parser.ts
if (isJsonObject(rawPrompt)) {
  // Executable prompt template: { script: [...], config: {...} }
  const scriptArray = asStringArray(rawPrompt.script, ...);

  // Resolve the script path (last element)
  const scriptPath = scriptArray[scriptArray.length - 1];
  const resolved = await resolveFileReference(scriptPath, searchRoots);

  if (resolved.resolvedPath) {
    resolvedPromptScript = [...scriptArray.slice(0, -1), path.resolve(resolved.resolvedPath)];
  }
}
```

The orchestrator executes using the resolved script array:

```typescript
// packages/core/src/evaluation/orchestrator.ts
async function executePromptTemplate(
  script: readonly string[],  // e.g., ['bun', 'run', '/abs/path/template.ts']
  context: ResolveCustomPromptContext,
  config?: Record<string, unknown>,
  timeoutMs?: number,
): Promise<string> {
  const payload = { /* ... same as code judge */ };
  const inputJson = JSON.stringify(toSnakeCaseDeep(payload), null, 2);
  const cwd = path.dirname(script[script.length - 1]);

  const stdout = await executeScript(script, inputJson, timeoutMs, cwd);
  return stdout.trim();
}
```

## User Experience

### Writing a Prompt Template

```typescript
// prompts/custom-evaluator.ts
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
evalcases:
  - id: example
    question: "What is the capital of France?"
    execution:
      evaluators:
        - name: custom-eval
          type: llm_judge
          # Executable prompt template with explicit script array
          prompt:
            script: [bun, run, ../prompts/custom-evaluator.ts]
            config:
              rubric: |
                - Must be factually correct
                - Should be concise
```

### Supported Runtimes

The explicit script array supports any runtime:

```yaml
# TypeScript with Bun
prompt:
  script: [bun, run, ./template.ts]

# TypeScript with Node + tsx
prompt:
  script: [npx, tsx, ./template.ts]

# JavaScript with Node
prompt:
  script: [node, ./template.js]

# Python (future)
prompt:
  script: [python, ./template.py]
```

## Trade-offs

| Aspect | Subprocess Pattern | In-process (jiti/dynamic import) |
|--------|-------------------|----------------------------------|
| Consistency | Same as code judges | New pattern, different from code_judge |
| Dependencies | None (existing infra) | Adds jiti dependency |
| Performance | Process spawn overhead | Faster execution |
| Isolation | Sandboxed in subprocess | Runs in main process |
| Language support | Any (TS, JS, Python, etc.) | TypeScript/JavaScript only |
| API compatibility | Works with existing SDK | Would require different SDK API |

The subprocess pattern is preferred because:
1. **Consistency** - Same mental model as code judges
2. **No new dependencies** - Uses existing `executeScript` infrastructure
3. **Isolation** - User code runs in separate process
4. **Language agnostic** - Supports any runtime (bun, node, python, deno)
5. **SDK compatibility** - The `definePromptTemplate` SDK is designed for stdin/stdout

## Alternatives Considered

### In-process loading with jiti

**Rejected.** While jiti provides lighter-weight TypeScript execution without subprocess overhead:
- Adds a new dependency
- Inconsistent with code_judge pattern (subprocess)
- Runs user code in the main process (less isolation)
- Would require a different API - the current SDK reads stdin/writes stdout
- Only works for JS/TS, not other languages

If there's demand for a lighter-weight in-process option in the future, it could be added as a separate feature (e.g., `prompt_module: ./file.ts`) rather than replacing the subprocess approach.

### Auto-detect runtime by file extension

**Rejected.** The original design auto-detected runtime based on file extension (`.ts` → `bun run`). This was changed to explicit script arrays because:
- Ambiguous: What runtime does `.ts` use? bun? node? tsx?
- Inconsistent: code_judge requires explicit `script:` array
- Inflexible: Adding new runtimes requires code changes

### Require pre-compiled JS only

**Rejected.** Worse DX - users already expect `bun run` to handle `.ts` files directly.
