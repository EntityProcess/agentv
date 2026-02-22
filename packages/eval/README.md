# @agentv/eval

Evaluation SDK for AgentV - build custom evaluators with zero boilerplate.

## Installation

```bash
npm install @agentv/eval
```

## Quick Start

### defineAssertion (simplest way)

```typescript
#!/usr/bin/env bun
import { defineAssertion } from '@agentv/eval';

export default defineAssertion(({ answer }) => ({
  pass: answer.toLowerCase().includes('hello'),
  reasoning: 'Checks for greeting',
}));
```

Assertions support `pass: boolean` for simple checks and `score: number` (0-1) for granular scoring.

### defineCodeJudge (full control)

```typescript
#!/usr/bin/env bun
import { defineCodeJudge } from '@agentv/eval';

export default defineCodeJudge(({ answer, trace }) => ({
  score: answer.length > 0 ? 1.0 : 0.0,
  hits: ['Output received'],
}));
```

Both functions handle stdin/stdout parsing, snake_case conversion, Zod validation, and error handling automatically.

## Exports

- `defineAssertion(handler)` - Define a custom assertion (pass/fail + optional score)
- `defineCodeJudge(handler)` - Define a code judge evaluator (full score control)
- `definePromptTemplate(handler)` - Define a dynamic prompt template
- `AssertionContext`, `AssertionScore` - Assertion types
- `CodeJudgeInput`, `CodeJudgeResult` - Code judge types
- `TraceSummary`, `Message`, `ToolCall` - Trace data types
- `createTargetClient()` - LLM target proxy for evaluators
- `z` - Re-exported Zod for custom config schemas

## Documentation

For complete documentation including:
- Full input/output schemas
- Typed config examples
- Execution metrics usage
- Best practices

See the [Custom Evaluators Guide](../../plugins/agentv-dev/skills/agentv-eval-builder/references/custom-evaluators.md) or run AgentV's `/agentv-eval-builder` skill.

## Repository

[https://github.com/EntityProcess/agentv](https://github.com/EntityProcess/agentv)

## License

MIT License - see [LICENSE](../../LICENSE) for details.
