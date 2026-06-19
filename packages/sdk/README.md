# @agentv/sdk

Evaluation SDK for AgentV - build YAML-aligned eval suites, custom graders, and prompt templates around the canonical AgentV eval model.

## Installation

```bash
npm install @agentv/sdk
```

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
import { defineEval } from '@agentv/sdk';

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
      assertions: [{ type: 'contains', value: 'Hello' }],
    },
  ],
});
```

`defineEval()` keeps TypeScript authoring in camelCase and lowers to the canonical snake_case YAML/runtime contract when AgentV loads the `.eval.ts` file.

## Exports

- `defineAssertion(handler)` - Define a custom assertion (pass/fail + optional score)
- `defineCodeGrader(handler)` - Define a code grader grader (full score control)
- `definePromptTemplate(handler)` - Define a dynamic prompt template
- `defineEval(definition)` / `evalSuite(definition)` - Define a YAML-aligned `.eval.ts` suite
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
