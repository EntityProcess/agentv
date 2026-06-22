# @agentv/sdk

Public lightweight SDK for AgentV - build YAML-aligned eval suites, custom graders, and prompt templates around the canonical AgentV eval model.

## Installation

```bash
npm install @agentv/sdk
```

## Migrating from `@agentv/eval`

Use `@agentv/sdk` for new code:

```bash
npm uninstall @agentv/eval
npm install @agentv/sdk
```

```typescript
import { defineCodeGrader } from '@agentv/sdk';
```

`@agentv/eval` was a temporary deprecated compatibility package for this SDK. It is no longer published from this repository. Use `@agentv/sdk` directly.

## Quick Start

### defineAssertion (simplest way)

```typescript
#!/usr/bin/env bun
import { defineAssertion } from '@agentv/sdk';

export default defineAssertion(({ output }) => ({
  pass: (output ?? '').toLowerCase().includes('hello'),
  reasoning: 'Checks for greeting',
}));
```

Assertions support `pass: boolean` for simple checks and `score: number` (0-1) for granular scoring.

### defineCodeGrader (full control)

```typescript
#!/usr/bin/env bun
import { defineCodeGrader } from '@agentv/sdk';

export default defineCodeGrader(({ output, traceSummary }) => ({
  score: (output ?? '').length > 0 ? 1.0 : 0.0,
  assertions: [
    { text: 'Output received', passed: (output ?? '').length > 0 },
    { text: 'Trace summary available', passed: traceSummary !== null },
  ],
}));
```

Both functions handle stdin/stdout parsing, snake_case conversion, Zod validation, and error handling automatically.

### defineEval (YAML-aligned `.eval.ts` authoring)

```typescript
#!/usr/bin/env bun
import { defineEval, graders } from '@agentv/sdk';

export default defineEval({
  name: 'hello-suite',
  execution: {
    targets: ['mock-sdk'],
  },
  tests: [
    {
      id: 'hello',
      input: 'Say hello',
      expectedOutput: 'Hello from the mock target',
      assertions: [graders.contains('Hello')],
    },
  ],
});
```

`defineEval()` keeps TypeScript authoring in camelCase and lowers to the canonical snake_case YAML/runtime contract when AgentV loads the `.eval.ts` file.

### Grader helpers

Use the `graders` catalog when you want TypeScript helpers for common AgentV grader configs without creating a new eval vocabulary:

```typescript
import { defineEval, graders } from '@agentv/sdk';

export default defineEval({
  name: 'grader-helper-suite',
  tests: [
    {
      id: 'json-greeting',
      input: 'Return a JSON greeting.',
      assertions: [
        graders.contains('Hello', { name: 'mentions-hello' }),
        graders.regex(/"message"\s*:/, { name: 'message-key' }),
        graders.json({ name: 'valid-json', required: true }),
        graders.rubrics(['Greets the user'], { name: 'rubric-review' }),
        graders.llmGrader({
          name: 'llm-review',
          prompt: 'Grade whether the answer is useful.',
          target: 'grader-target',
        }),
        graders.codeGrader(['bun', 'run', 'graders/check.ts'], { name: 'scripted-check' }),
      ],
    },
  ],
});
```

The helpers return ordinary `assertions` entries such as `type: contains`, `type: llm-grader`, and `type: code-grader`. CamelCase SDK options such as `minScore` and `maxSteps` lower to canonical YAML keys such as `min_score` and `max_steps`.

If you are coming from Braintrust `scores` or DeepEval metrics, model reusable checks as small AgentV-native helper factories that return these grader configs. They still lower to the same YAML/runtime contract:

```typescript
import { defineEval, graders } from '@agentv/sdk';

function ragFaithfulness() {
  return graders.llmGrader({
    name: 'rag-faithfulness',
    target: 'grader-target',
    prompt: 'Grade whether the answer is supported by the provided context.',
  });
}

export default defineEval({
  name: 'rag-suite',
  tests: [
    {
      id: 'grounded-answer',
      input: 'Answer using the retrieved context.',
      assertions: [ragFaithfulness()],
    },
  ],
});
```

Python workflows should emit canonical YAML/JSONL or implement code graders over the stdin/stdout contract. The repo-local helper under `examples/features/sdk-python/` is an example, not a promised published Python package.

## Exports

- `defineAssertion(handler)` - Define a custom assertion (pass/fail + optional score)
- `defineCodeGrader(handler)` - Define a code grader (full score control)
- `definePromptTemplate(handler)` - Define a dynamic prompt template
- `defineEval(definition)` / `evalSuite(definition)` - Define a YAML-aligned `.eval.ts` suite
- `graders` - Catalog of built-in AgentV grader config helpers
- `containsGrader`, `equalsGrader`, `exactGrader`, `regexGrader`, `isJsonGrader`, `jsonGrader`, `rubricsGrader`, `llmGrader`, `codeGrader` - Named grader helper functions
- `toEvalYamlObject(definition)` / `serializeEvalYaml(definition)` - Lower or serialize canonical eval YAML
- `AssertionContext`, `AssertionScore` - Assertion types
- `CodeGraderInput`, `CodeGraderResult` - Code grader types
- `TraceSummary`, `Message`, `ToolCall` - Trace data types
- `createTargetClient()` - LLM target proxy for graders
- `z` - Re-exported Zod for custom config schemas

## Documentation

For complete documentation including:
- Full input/output schemas
- Typed config examples
- Execution metrics usage
- Best practices

See the docs site guides under `apps/web/src/content/docs/docs/graders/` or run `agentv skills get agentv-eval-writer`.

## Repository

[https://github.com/EntityProcess/agentv](https://github.com/EntityProcess/agentv)

## License

MIT License - see [LICENSE](../../LICENSE) for details.
