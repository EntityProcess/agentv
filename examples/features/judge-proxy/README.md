# Judge Proxy Example

This example demonstrates the **judge proxy** feature, which allows code judge evaluators to make LLM calls through a secure local proxy without needing direct API credentials.

## Overview

The judge proxy enables sophisticated evaluation patterns like:
- **Contextual precision** - Is the response relevant to the question?
- **Semantic similarity** - Does the response match the expected meaning?
- **Multi-step reasoning** - Break down complex evaluations into multiple LLM calls

## Security

The judge proxy is designed with security in mind:
- Binds to **loopback only** (127.0.0.1) - not accessible from network
- Uses **bearer token authentication** - unique per execution
- Enforces **max_calls limit** - prevents runaway costs
- **Auto-shutdown** - proxy terminates when evaluator completes

## Configuration

Enable judge proxy access by adding a `judge` block to your `code_judge` evaluator:

```yaml
evaluators:
  - name: contextual-precision
    type: code_judge
    script: bun scripts/contextual-precision.ts
    # Enable with defaults (max_calls: 50)
    judge: {}

  # Or with custom settings
  - name: custom-judge
    type: code_judge
    script: bun scripts/custom.ts
    judge:
      max_calls: 10  # Limit proxy calls
```

## Usage in Code

```typescript
import { createJudgeProxyClientFromEnv, defineCodeJudge } from '@agentv/eval';

export default defineCodeJudge(async ({ question, candidateAnswer }) => {
  const judge = createJudgeProxyClientFromEnv();

  if (!judge) {
    return { score: 0, misses: ['Judge proxy not available'] };
  }

  const response = await judge.invoke({
    question: `Is this relevant? ${candidateAnswer}`,
    systemPrompt: 'Respond with JSON: { "relevant": true/false }'
  });

  const result = JSON.parse(response.rawText ?? '{}');
  return { score: result.relevant ? 1.0 : 0.0 };
});
```

## Environment Variables

When `judge` is configured, these environment variables are automatically set:
- `AGENTV_JUDGE_PROXY_URL` - Local proxy URL (e.g., `http://127.0.0.1:45123`)
- `AGENTV_JUDGE_PROXY_TOKEN` - Bearer token for authentication

The `createJudgeProxyClientFromEnv()` function reads these automatically.

## Running

```bash
# From the agentv monorepo root:
bun run agentv eval examples/features/judge-proxy/evals/contextual-precision.yaml --target gemini_base
```

The example eval file configures:
- A `code_judge` evaluator with `judge: {}` to enable proxy access
- The script runs from the monorepo root with access to `@agentv/eval`
