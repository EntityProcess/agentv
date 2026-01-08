# Code Judge with LLM Calls

This example demonstrates how code judge evaluators can make LLM calls through a secure local proxy without needing direct API credentials.

## Contextual Precision Metric

This example implements the **Contextual Precision** metric for RAG (Retrieval Augmented Generation) systems. This metric evaluates whether your retriever ranks relevant documents higher than irrelevant ones.

### How It Works

1. **Multiple Judge Calls**: For each retrieval node, the evaluator makes an LLM call to determine binary relevance (relevant=1, irrelevant=0)
2. **Weighted Precision**: Calculates precision at each rank position, rewarding relevant nodes that appear earlier
3. **Final Score**: Average of precision values at relevant positions

### Formula

```
Contextual Precision = (1/R) × Σ(Precision@k × r_k) for k=1 to n

where:
- R = total number of relevant nodes
- r_k = binary relevance at position k (1 if relevant, 0 otherwise)
- Precision@k = (relevant nodes up to k) / k
```

### Example Calculation

**Question**: "What is the capital of France?"
**Retrieval Context**:
1. "Paris is the capital and most populous city of France." (**Relevant**)
2. "The Eiffel Tower was built in 1887." (**Irrelevant**)
3. "Paris is often referred to as the City of Light." (**Relevant**)

**Calculation**:
- Node 1 (Relevant): Precision@1 = 1/1 = 1.0
- Node 2 (Irrelevant): skipped
- Node 3 (Relevant): Precision@3 = 2/3 = 0.667

**Final Score** = (1/2) × (1.0 + 0.667) = **0.833**

If both relevant nodes were ranked first (before the irrelevant one), the score would be 1.0.

### Understanding the Output

Results show `hits` (relevant nodes) and `misses` (irrelevant nodes) for transparency. However, **misses don't penalize the score** - only the ranking of relevant nodes matters.

- If all relevant nodes are ranked first → score = 1.0 (even with irrelevant nodes after)
- If relevant nodes are buried below irrelevant ones → score decreases proportionally

## Security

The target proxy is designed with security in mind:
- Binds to **loopback only** (127.0.0.1) - not accessible from network
- Uses **bearer token authentication** - unique per execution
- Enforces **max_calls limit** - prevents runaway costs
- **Auto-shutdown** - proxy terminates when evaluator completes

## Configuration

Enable target access by adding a `target` block to your `code_judge` evaluator:

```yaml
evaluators:
  - name: contextual_precision
    type: code_judge
    script: [bun, run, scripts/contextual-precision.ts]
    target:
      max_calls: 10  # At least N nodes to evaluate
```

## Usage in Code

```typescript
import { createTargetClient, defineCodeJudge } from '@agentv/eval';

export default defineCodeJudge(async ({ question, config }) => {
  const target = createTargetClient();
  const retrievalContext = config?.retrieval_context ?? [];

  // Batch evaluation of all nodes
  const requests = retrievalContext.map((node, i) => ({
    question: `Is this node relevant to: ${question}\n\nNode: ${node}`,
    systemPrompt: 'Respond with JSON: { "relevant": true/false }'
  }));

  const responses = await target.invokeBatch(requests);

  // Calculate weighted precision score...
});
```

## Environment Variables

When `target` is configured, these environment variables are automatically set:
- `AGENTV_TARGET_PROXY_URL` - Local proxy URL (e.g., `http://127.0.0.1:45123`)
- `AGENTV_TARGET_PROXY_TOKEN` - Bearer token for authentication

The `createTargetClient()` function reads these automatically.

## Running

```bash
# From the agentv monorepo root:
bun run agentv eval examples/features/code-judge-with-llm-calls/evals/dataset.yaml --target gemini_base
```

Expected output shows varying scores based on retrieval ranking:
- **perfect-ranking**: ~1.0 (relevant nodes ranked first)
- **buried-relevant-node**: ~0.833 (relevant node buried at rank 3)
- **relevant-node-last**: ~0.333 (only relevant node is last)
