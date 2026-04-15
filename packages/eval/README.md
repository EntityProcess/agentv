# @agentv/eval

Evaluation SDK for AgentV - build custom graders with zero boilerplate.

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

### defineCodeGrader (full control)

```typescript
#!/usr/bin/env bun
import { defineCodeGrader } from '@agentv/eval';

export default defineCodeGrader(({ answer, trace }) => ({
  score: answer.length > 0 ? 1.0 : 0.0,
  assertions: [{ text: 'Output received', passed: answer.length > 0 }],
}));
```

Both functions handle stdin/stdout parsing, snake_case conversion, Zod validation, and error handling automatically.

## Exports

- `defineAssertion(handler)` - Define a custom assertion (pass/fail + optional score)
- `defineCodeGrader(handler)` - Define a code grader grader (full score control)
- `definePromptTemplate(handler)` - Define a dynamic prompt template
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

See the [Custom Graders Guide](../../plugins/agentv-dev/skills/agentv-eval-writer/references/custom-graders.md) or run AgentV's `/agentv-eval-builder` skill.

## Repository

[https://github.com/EntityProcess/agentv](https://github.com/EntityProcess/agentv)

## License

MIT License - see [LICENSE](../../LICENSE) for details.
