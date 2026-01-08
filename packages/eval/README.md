# @agentv/eval

Evaluation SDK for AgentV - build custom code judges with zero boilerplate.

## Installation

```bash
npm install @agentv/eval
```

## Quick Start

```typescript
#!/usr/bin/env bun
import { defineCodeJudge } from '@agentv/eval';

export default defineCodeJudge(({ candidateAnswer, traceSummary }) => ({
  score: candidateAnswer.length > 0 ? 1.0 : 0.0,
  hits: ['Output received'],
}));
```

The `defineCodeJudge` function handles stdin/stdout parsing, snake_case conversion, Zod validation, and error handling automatically.

## Exports

- `defineCodeJudge(handler)` - Define a code judge evaluator
- `CodeJudgeInput`, `CodeJudgeResult` - TypeScript types
- `TraceSummary`, `OutputMessage`, `ToolCall` - Trace data types
- `z` - Re-exported Zod for custom config schemas

## Documentation

For complete documentation including:
- Full input/output schemas
- Typed config examples
- Execution metrics usage
- Best practices

See the [Custom Evaluators Guide](../../.claude/skills/agentv-eval-builder/references/custom-evaluators.md) or run AgentV's `/agentv-eval-builder` skill.

## Repository

[https://github.com/EntityProcess/agentv](https://github.com/EntityProcess/agentv)

## License

MIT License - see [LICENSE](../../LICENSE) for details.
