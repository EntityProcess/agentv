# Code Judge with LLM Calls

This example demonstrates how code judge evaluators can make LLM calls through a secure local proxy without needing direct API credentials.

This example implements two RAG metrics:
- **Contextual Precision**: Evaluates whether relevant documents are ranked higher
- **Contextual Recall**: Evaluates whether retrieval covers all expected information

## Contextual Precision Metric

This metric evaluates whether your retriever ranks relevant documents higher than irrelevant ones.

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

## Contextual Recall Metric

This metric evaluates whether the retrieval context contains enough information to support all statements in the expected answer.

### How It Works

1. **Statement Extraction**: An LLM extracts distinct factual statements from the expected answer
2. **Attribution Check**: For each statement, the LLM determines if it can be attributed to (supported by) the retrieval context
3. **Final Score**: Proportion of attributable statements

### Formula

```
Contextual Recall = Attributable Statements / Total Statements
```

### Example Calculation

**Question**: "Who created Python and when was it released?"
**Expected Answer**: "Python was created by Guido van Rossum and first released in 1991."
**Retrieval Context**:
1. "Python was created by Guido van Rossum while working at CWI." (**Supports statement 1**)
2. "Python was first released in 1991 as version 0.9.0." (**Supports statement 2**)
3. "Guido van Rossum remained Python's lead developer until 2018." (**Extra info**)

**Extracted Statements**:
1. "Python was created by Guido van Rossum" → **Attributable** (Node 1)
2. "Python was first released in 1991" → **Attributable** (Node 2)

**Final Score** = 2/2 = **1.0** (perfect recall)

### Understanding the Output

- `hits`: Statements that could be attributed to retrieval context
- `misses`: Statements NOT supported by retrieval context

A perfect score (1.0) means the retrieval context fully covers the expected answer. A low score indicates gaps in retrieval - information that should have been retrieved but wasn't.

## Limitations

### Multiple Tool Calls Are Flattened

The current implementation extracts retrieval context by iterating through **all** `expected_messages` and **all** `tool_calls`, flattening results into a single ordered list:

```yaml
expected_messages:
  - role: assistant
    tool_calls:
      - tool: vector_search
        output:
          results: ["Node A", "Node B"]
  - role: assistant
    tool_calls:
      - tool: vector_search
        output:
          results: ["Node C"]
```

This produces: `["Node A", "Node B", "Node C"]`

**Implications:**
- **Contextual Precision**: Ranking is evaluated across the flattened list. If tool calls represent independent searches (e.g., different queries), their rankings are conflated, which may not reflect true retrieval quality.
- **Contextual Recall**: Attribution checks against the combined context, which is generally fine since recall measures coverage, not ranking.

**Potential Solutions:**

All solutions below can be implemented entirely in the code judge - no core AgentV changes required. The code judge receives the full `expectedMessages` structure:

```typescript
// Available in input.expectedMessages
{
  role: 'assistant',
  toolCalls: [{
    tool: 'vector_search',
    input: { query: 'capital of France' },  // query metadata available
    output: { results: ['Paris is...', '...'] }
  }]
}
```

1. **Per-tool-call scoring**: Rewrite extraction to return `Array<{ query: string, results: string[] }>`, evaluate precision separately for each tool call, then aggregate (average, weighted by result count, etc.)

2. **Tool call metadata**: The query is already available via `toolCall.input.query`. Use this to group or label results by their source query.

3. **Nested structure**: Change the extraction to return `string[][]` (array of arrays) preserving tool call boundaries, then adapt scoring logic.

The current `extractRetrievalContext()` in `utils.ts` flattens for simplicity. For most single-query RAG evaluations, this works well. Consider the alternatives if your retrieval involves multiple independent searches per turn.

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
  - name: contextual_recall
    type: code_judge
    script: [bun, run, scripts/contextual-recall.ts]
    target:
      max_calls: 15  # 1 for extraction + N statements for attribution
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

## Querying Proxy Info

You can query information about the target proxy:

```typescript
const info = await target.getInfo();
console.log(`Target: ${info.targetName}`);
console.log(`Calls: ${info.callCount}/${info.maxCalls}`);
console.log(`Available targets: ${info.availableTargets.join(', ')}`);
```

## Target Override

Use different targets for different purposes within the same evaluator:

```typescript
// Use a coding agent for complex tasks
const agentResponses = await target.invokeBatch(
  nodes.map(node => ({
    question: `Is this relevant? ${node}`,
    target: 'pi'  // Override default target
  }))
);

// Use a base LLM for simple evaluation
const response = await target.invoke({
  question: complexAnalysisPrompt,
  target: 'gemini_base'  // Use different target
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

# Run contextual precision evaluation
bun run agentv eval examples/features/code-judge-with-llm-calls/evals/contextual-precision.yaml --target gemini_base

# Run contextual recall evaluation
bun run agentv eval examples/features/code-judge-with-llm-calls/evals/contextual-recall.yaml --target gemini_base
```

### Expected Results

**Contextual Precision** (`contextual-precision.yaml`):
- **perfect-ranking**: ~1.0 (relevant node ranked first)
- **mixed-ranking**: ~0.833 (relevant nodes at positions 1 and 3)
- **relevant-node-last**: ~0.333 (only relevant node is last)

**Contextual Recall** (`contextual-recall.yaml`):
- **perfect-recall**: ~1.0 (all expected statements attributable)
- **partial-recall**: ~0.33 (some statements missing from retrieval)
- **zero-recall**: ~0.0 (retrieval doesn't support expected answer)
