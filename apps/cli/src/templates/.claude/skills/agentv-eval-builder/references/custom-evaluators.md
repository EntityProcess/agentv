# Custom Evaluators Guide

Templates and best practices for code evaluators and LLM judges. For YAML configuration, see `SKILL.md`.

## Code Evaluator Contract

Code evaluators receive input via stdin and write output to stdout, both as JSON.

### Input Format (via stdin)

Wire format uses snake_case for cross-language compatibility:

```json
{
  "question": "string describing the task/question",
  "expected_outcome": "expected outcome description",
  "reference_answer": "gold standard answer (optional)",
  "candidate_answer": "generated code/text from the agent",
  "guideline_files": ["path1", "path2"],
  "input_files": ["file1", "file2"],
  "input_messages": [{"role": "user", "content": "..."}],
  "expected_messages": [
    {
      "role": "assistant",
      "tool_calls": [
        {
          "tool": "vector_search",
          "input": { "query": "..." },
          "output": { "results": ["doc1", "doc2"] }
        }
      ]
    }
  ],
  "output_messages": [
    {
      "role": "assistant",
      "content": "...",
      "tool_calls": [...]
    }
  ],
  "trace_summary": {
    "event_count": 5,
    "tool_names": ["fetch", "search"],
    "tool_calls_by_name": { "search": 2, "fetch": 1 },
    "error_count": 0,
    "token_usage": { "input": 1000, "output": 500 },
    "cost_usd": 0.0015,
    "duration_ms": 3500
  }
}
```

**Key fields:**
- `expected_messages` - Expected agent behavior from YAML, including tool calls with outputs (use for retrieval context in RAG evals)
- `output_messages` - Actual agent execution trace with tool calls (from live agent runs)
- `trace_summary` - Lightweight summary with execution metrics (counts only, no tool arguments)

### Output Format (to stdout)

```json
{
  "score": 0.85,
  "hits": ["successful check 1", "successful check 2"],
  "misses": ["failed check 1"],
  "reasoning": "Brief explanation of the score"
}
```

**Field Requirements:**
- `score`: Float between 0.0 and 1.0 (required)
- `hits`: Array of strings describing what passed (optional but recommended)
- `misses`: Array of strings describing what failed (optional but recommended)
- `reasoning`: String explaining the score (optional but recommended)

## Python Code Evaluator Template

```python
#!/usr/bin/env python3
import json
import sys

def evaluate(data: dict) -> dict:
    candidate = data.get("candidate_answer", "")
    hits, misses = [], []

    # Your validation logic here
    keywords = ["async", "await"]
    for kw in keywords:
        (hits if kw in candidate else misses).append(f"Keyword '{kw}'")

    return {
        "score": len(hits) / len(keywords) if keywords else 1.0,
        "hits": hits,
        "misses": misses,
        "reasoning": f"Found {len(hits)}/{len(keywords)} keywords"
    }

if __name__ == "__main__":
    try:
        result = evaluate(json.loads(sys.stdin.read()))
        print(json.dumps(result, indent=2))
    except Exception as e:
        print(json.dumps({"score": 0, "hits": [], "misses": [str(e)], "reasoning": "Error"}))
        sys.exit(1)
```

## TypeScript Code Evaluator Template

<<<<<<< HEAD
The `@agentv/eval` SDK provides a declarative API with automatic stdin/stdout handling.
||||||| parent of dfe8eaf (refactor: sync Claude skills from root to CLI templates)
The `@agentv/eval` SDK provides a declarative API for code evaluators with automatic stdin/stdout handling, validation, and error handling.

**Execution:** Keep evaluators as `.ts` files and run via `bun run` or Node loaders like `npx --yes tsx ./evaluators/my-check.ts`.
=======
The optional `@agentv/core` SDK provides type-safe payload parsing with camelCase properties (`candidateAnswer` vs `candidate_answer`).

**Execution:** Keep evaluators as `.ts` files and run via Node loaders like `npx --yes tsx ./evaluators/my-check.ts` so users don't need Bun after `npm install -g agentv`.

**Without SDK:** Skip the import and parse JSON from stdin directly (similar to the Python template above).
>>>>>>> dfe8eaf (refactor: sync Claude skills from root to CLI templates)

```typescript
<<<<<<< HEAD
#!/usr/bin/env bun
import { defineCodeJudge } from '@agentv/eval';
||||||| parent of dfe8eaf (refactor: sync Claude skills from root to CLI templates)
#!/usr/bin/env bun
/**
 * Example TypeScript code evaluator using defineCodeJudge
 *
 * Run with: bun run ./evaluators/example-check.ts
 *        or: npx --yes tsx ./evaluators/example-check.ts
 *
 * The SDK handles:
 * - Reading JSON from stdin
 * - Converting snake_case to camelCase
 * - Validating input with Zod
 * - Error handling and output formatting
 */
import { defineCodeJudge } from '@agentv/eval';
=======
/**
 * Example TypeScript code evaluator using the AgentV SDK
 *
 * Run with: npx --yes tsx ./evaluators/example-check.ts
 *
 * The SDK provides:
 * - Type-safe CodeJudgePayload interface with all fields
 * - camelCase properties (candidateAnswer, expectedOutcome, etc.)
 * - Automatic conversion from snake_case wire format
 */
>>>>>>> dfe8eaf (refactor: sync Claude skills from root to CLI templates)

<<<<<<< HEAD
export default defineCodeJudge(({ candidateAnswer, expectedOutcome }) => {
||||||| parent of dfe8eaf (refactor: sync Claude skills from root to CLI templates)
export default defineCodeJudge(({ candidateAnswer, expectedOutcome, inputFiles, guidelineFiles }) => {
=======
import { readCodeJudgePayload } from '@agentv/core';

try {
  // Read and parse stdin with automatic snake_case → camelCase conversion
  const payload = readCodeJudgePayload();

  // Type-safe camelCase access to all fields
  const { candidateAnswer, expectedOutcome, inputFiles, guidelineFiles } = payload;

  // Your validation logic here
>>>>>>> dfe8eaf (refactor: sync Claude skills from root to CLI templates)
  const hits: string[] = [];
  const misses: string[] = [];

  // Your validation logic here
  if (candidateAnswer.includes(expectedOutcome)) {
    hits.push('Answer matches expected outcome');
  } else {
    misses.push('Answer does not match expected outcome');
  }

<<<<<<< HEAD
  const total = hits.length + misses.length;
  return {
    score: total === 0 ? 0 : hits.length / total,
||||||| parent of dfe8eaf (refactor: sync Claude skills from root to CLI templates)
  // Example: Check attachment mentions
  const attachments = [...guidelineFiles, ...inputFiles];
  for (const filePath of attachments) {
    const fileName = filePath.split('/').pop() ?? filePath;
    if (candidateAnswer.includes(fileName)) {
      hits.push(`Mentions attachment: ${fileName}`);
    } else {
      misses.push(`Missing attachment: ${fileName}`);
    }
  }

  // Calculate score
  const totalChecks = hits.length + misses.length;
  const score = totalChecks === 0 ? 0 : hits.length / totalChecks;

  return {
    score,
=======
  // Example: Check attachment mentions
  const attachments = [...guidelineFiles, ...inputFiles];
  for (const filePath of attachments) {
    const fileName = filePath.split('/').pop() ?? filePath;
    if (candidateAnswer.includes(fileName)) {
      hits.push(`Mentions attachment: ${fileName}`);
    } else {
      misses.push(`Missing attachment: ${fileName}`);
    }
  }

  // Calculate score
  const totalChecks = hits.length + misses.length;
  const score = totalChecks === 0 ? 0 : hits.length / totalChecks;

  // Build result
  const result = {
    score,
>>>>>>> dfe8eaf (refactor: sync Claude skills from root to CLI templates)
    hits,
    misses,
<<<<<<< HEAD
    reasoning: `Passed ${hits.length}/${total} checks`,
||||||| parent of dfe8eaf (refactor: sync Claude skills from root to CLI templates)
    reasoning: `Passed ${hits.length}/${totalChecks} checks`,
=======
    reasoning: `Passed ${hits.length}/${totalChecks} checks`
>>>>>>> dfe8eaf (refactor: sync Claude skills from root to CLI templates)
  };

  console.log(JSON.stringify(result, null, 2));

} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.log(JSON.stringify({
    score: 0,
    hits: [],
    misses: [`Error: ${message}`],
    reasoning: 'Evaluator error'
  }, null, 2));
  process.exit(1);
}
```

<<<<<<< HEAD
**SDK exports:** `defineCodeJudge`, `Message`, `ToolCall`, `TraceSummary`, `CodeJudgeInput`, `CodeJudgeResult`
||||||| parent of dfe8eaf (refactor: sync Claude skills from root to CLI templates)
**TypeScript SDK Benefits:**
- **Zero boilerplate**: No try/catch, stdin parsing, or JSON.stringify needed
- **Type-safe**: `CodeJudgeInput` interface with all fields typed
- **camelCase**: Idiomatic TypeScript naming (`candidateAnswer` vs `candidate_answer`)
- **Validation**: Zod schemas validate input and output at runtime
- **Error handling**: Exceptions automatically produce valid failure results
=======
**TypeScript SDK Benefits:**
- **Type-safe**: `CodeJudgePayload` interface with all fields typed
- **camelCase**: Idiomatic TypeScript naming (`candidateAnswer` vs `candidate_answer`)
- **Automatic conversion**: Handles snake_case wire format → camelCase objects
- **Compile-time safety**: Catch typos and missing fields before runtime
>>>>>>> dfe8eaf (refactor: sync Claude skills from root to CLI templates)

<<<<<<< HEAD
## Target Access for Code Evaluators

Code judges can access an LLM through a **target proxy** for metrics requiring multiple LLM calls (contextual precision, semantic similarity, etc).

### Configuration

```yaml
evaluators:
  - name: contextual-precision
    type: code_judge
    script: bun scripts/contextual-precision.ts
    target:
      max_calls: 10  # Default: 50
```

### Usage

```typescript
#!/usr/bin/env bun
import { createTargetClient, defineCodeJudge } from '@agentv/eval';

export default defineCodeJudge(async ({ question, candidateAnswer }) => {
  const target = createTargetClient();
  if (!target) return { score: 0, misses: ['Target not configured'] };

  const response = await target.invoke({
    question: `Is this relevant to: ${question}? Response: ${candidateAnswer}`,
    systemPrompt: 'Respond with JSON: { "relevant": true/false }'
  });

  const result = JSON.parse(response.rawText ?? '{}');
  return { score: result.relevant ? 1.0 : 0.0 };
});
```
||||||| parent of dfe8eaf (refactor: sync Claude skills from root to CLI templates)
**Available exports from `@agentv/eval`:**
- `defineCodeJudge(handler)`: Define a code judge evaluator (recommended)
- `CodeJudgeInput`: TypeScript type for input payload
- `CodeJudgeResult`: TypeScript type for result
- `TraceSummary`, `OutputMessage`: Types for trace data
- `z`: Re-exported Zod for custom config schemas

**Using execution metrics:**

```typescript
import { defineCodeJudge } from '@agentv/eval';

export default defineCodeJudge(({ traceSummary }) => {
  if (!traceSummary) {
    return { score: 0.5, reasoning: 'No trace available' };
  }

  const efficient = traceSummary.eventCount <= 10;
  return {
    score: efficient ? 1.0 : 0.5,
    hits: efficient ? ['Efficient execution'] : [],
    misses: efficient ? [] : ['Too many tool calls'],
  };
});
```
=======
**Available in SDK:**
- `readCodeJudgePayload()`: Read stdin and convert to camelCase (recommended)
- `parseCodeJudgePayload(jsonString)`: Parse JSON string and convert to camelCase
- `CodeJudgePayload`: TypeScript interface for type safety
>>>>>>> dfe8eaf (refactor: sync Claude skills from root to CLI templates)

**Batch invocation:** Use `target.invokeBatch(requests)` for multiple calls.

**Environment variables** (set automatically when `target` is configured):
- `AGENTV_TARGET_PROXY_URL` - Local proxy URL
- `AGENTV_TARGET_PROXY_TOKEN` - Bearer token for authentication

**See also:** `examples/features/code-judge-with-llm-calls/`

## LLM Judge Prompt Template

LLM judges use markdown prompts. AgentV handles the output format automatically.

**Available Template Variables:**
- `{{question}}` - The original question/task
- `{{expected_outcome}}` - What the answer should accomplish
- `{{candidate_answer}}` - The actual output to evaluate
- `{{reference_answer}}` - Gold standard answer (optional)
- `{{input_messages}}` - JSON stringified input messages
- `{{output_messages}}` - JSON stringified output messages

**Default Template:**

```
You are an expert evaluator. Grade the candidate_answer based on how well it achieves the expected_outcome.

Use reference_answer as a gold standard (if provided). The candidate_answer doesn't need to match verbatim, but should capture key points.

Be concise. Provide specific feedback rather than verbose explanations.

[[ ## expected_outcome ## ]]
{{expected_outcome}}

[[ ## question ## ]]
{{question}}

[[ ## reference_answer ## ]]
{{reference_answer}}

[[ ## candidate_answer ## ]]
{{candidate_answer}}
```

## Best Practices

### Code Evaluators
1. **Focus on `candidate_answer`** - Most evaluators only need this field
2. **Be deterministic** - Same input → same output
3. **Handle errors gracefully** - Return valid result even on failure
4. **Use `hits`/`misses`** - Explain the score clearly

### LLM Judges
1. **Clear criteria** - Define what you're evaluating
2. **Specific rubrics** - Provide scoring guidelines
3. **Concise prompts** - Keep instructions focused

## Testing Locally

```bash
# Python
echo '{"candidate_answer": "test", "question": "task", "expected_outcome": "result"}' | uv run my_validator.py

# TypeScript
echo '{"candidate_answer": "test", "question": "task", "expected_outcome": "result"}' | bun run ./check.ts
```
