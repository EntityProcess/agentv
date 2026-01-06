# Code Judge SDK Helper

Demonstrates how a TypeScript code_judge evaluator can use `defineCodeJudge` from `@agentv/eval` for a declarative, zero-boilerplate approach.

## Files

- `evals/dataset.yaml`: Example eval case that uses a code_judge evaluator.
- `scripts/verify-attachments.ts`: Code judge script using `defineCodeJudge`.
- `evals/example.txt`, `evals/python.instructions.md`: Attachment fixtures.

## Setup

From repository root:

```bash
bun install  # Links workspace dependencies
bun run build  # Builds @agentv/core package
```

## Run

### Standalone Test

Test the SDK-based code judge directly with a mock payload:

```bash
cd examples/features/code-judge-sdk
cat << 'EOF' | bun run scripts/verify-attachments.ts
{
  "question": "Please echo this request",
  "expected_outcome": "The CLI echoes the prompt and lists attachment names.",
  "expected_messages": [{"role": "assistant", "content": "Attachments detected (2): example.txt, python.instructions.md."}],
  "candidate_answer": "Attachments detected (2): example.txt, python.instructions.md.",
  "guideline_files": ["evals/python.instructions.md"],
  "input_files": ["evals/example.txt"],
  "input_messages": []
}
EOF
```

### Full Evaluation

From the repository root:

```bash
cd examples/features
bun agentv eval code-judge-sdk/evals/dataset.yaml --target local_cli
```

This requires a CLI target named `local_cli` configured in `.agentv/targets.yaml`.

## API

The `defineCodeJudge` helper:
- Reads JSON from stdin automatically
- Converts snake_case to camelCase
- Validates input and output with Zod schemas
- Handles errors gracefully

```typescript
import { defineCodeJudge } from '@agentv/eval';

export default defineCodeJudge(({ candidateAnswer, expectedOutcome }) => ({
  score: candidateAnswer.includes(expectedOutcome) ? 1.0 : 0.0,
  hits: ['Check passed'],
  misses: [],
}));
```
