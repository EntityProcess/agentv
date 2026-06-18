# Code Grader SDK Helper

Demonstrates how a TypeScript `code-grader` can use `defineCodeGrader` from `@agentv/eval` for a declarative, low-boilerplate approach while still consuming the canonical AgentV wire format.

## Files

- `evals/dataset.eval.yaml`: Example test that uses a `code-grader`.
- `scripts/verify-attachments.ts`: Code grader script using `defineCodeGrader`.
- `evals/example.txt`, `evals/python.instructions.md`: Attachment fixtures.

## Setup

From repository root:

```bash
bun install  # Links workspace dependencies
bun run build  # Builds @agentv/core package
```

## Run

### Standalone Test

Test the SDK-based code grader directly with a mock payload:

```bash
cd examples/features/code-grader-sdk
cat << 'EOF' | bun run scripts/verify-attachments.ts
{
  "criteria": "The CLI echoes the prompt and lists attachment names.",
  "input": [{"role": "user", "content": "Please echo this request"}],
  "input_files": ["evals/python.instructions.md", "evals/example.txt"],
  "expected_output": [{"role": "assistant", "content": "Attachments detected (2): example.txt, python.instructions.md."}],
  "output": "Attachments detected (2): example.txt, python.instructions.md."
}
EOF
```

### Full Evaluation

From the repository root:

```bash
cd examples/features
bun agentv eval code-grader-sdk/evals/dataset.eval.yaml --target local_cli
```

This requires a CLI target named `local_cli` configured in `.agentv/targets.yaml`.

## API

The `defineCodeGrader` helper:
- Reads JSON from stdin automatically
- Converts snake_case to camelCase
- Validates input and output with Zod schemas
- Handles errors gracefully

```typescript
import { defineCodeGrader } from '@agentv/eval';

export default defineCodeGrader(({ output, criteria }) => ({
  score: (output ?? '').includes(criteria) ? 1.0 : 0.0,
  assertions: [{ text: 'Check passed', passed: (output ?? '').includes(criteria) }],
}));
```
