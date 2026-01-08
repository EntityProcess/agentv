# Custom Evaluators Guide

Guide for writing custom code evaluators and LLM judges for AgentV eval files.

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
- `expected_messages` - Expected agent behavior from YAML, including expected tool calls with outputs (use for retrieval context in RAG evals)
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
"""
Example code evaluator for AgentV

This evaluator checks for specific keywords in the output.
Replace validation logic as needed.
"""

import json
import sys
from typing import Any


def evaluate(input_data: dict[str, Any]) -> dict[str, Any]:
    """
    Evaluate the agent output.
    
    Args:
        input_data: Full input context from AgentV
    
    Returns:
        Evaluation result with score, hits, misses, reasoning
    """
    # Extract only the fields you need
    # Most evaluators only need 'candidate_answer' - avoid using unnecessary fields
    candidate_answer = input_data.get("candidate_answer", "")
    
    # Your validation logic here
    hits = []
    misses = []
    
    # Example: Check for keywords
    required_keywords = ["async", "await"]
    for keyword in required_keywords:
        if keyword in candidate_answer:
            hits.append(f"Contains required keyword: {keyword}")
        else:
            misses.append(f"Missing required keyword: {keyword}")
    
    # Calculate score
    if not required_keywords:
        score = 1.0
    else:
        score = len(hits) / len(required_keywords)
    
    # Build result
    return {
        "score": score,
        "hits": hits,
        "misses": misses,
        "reasoning": f"Found {len(hits)}/{len(required_keywords)} required keywords"
    }


def main():
    """Main entry point for AgentV code evaluator."""
    try:
        # Read input from stdin
        input_data = json.loads(sys.stdin.read())
        
        # Run evaluation
        result = evaluate(input_data)
        
        # Write result to stdout
        print(json.dumps(result, indent=2))
        
    except Exception as e:
        # Error handling: return zero score with error message
        error_result = {
            "score": 0.0,
            "hits": [],
            "misses": [f"Evaluator error: {str(e)}"],
            "reasoning": f"Evaluator error: {str(e)}"
        }
        print(json.dumps(error_result, indent=2))
        sys.exit(1)


if __name__ == "__main__":
    main()
```

## TypeScript Code Evaluator Template (with SDK)

The `@agentv/eval` SDK provides a declarative API for code evaluators with automatic stdin/stdout handling, validation, and error handling.

**Execution:** Keep evaluators as `.ts` files and run via `bun run` or Node loaders like `npx --yes tsx ./evaluators/my-check.ts`.

```typescript
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

export default defineCodeJudge(({ candidateAnswer, expectedOutcome, inputFiles, guidelineFiles }) => {
  const hits: string[] = [];
  const misses: string[] = [];

  // Example: Check if answer contains expected outcome
  if (candidateAnswer.includes(expectedOutcome)) {
    hits.push('Answer matches expected outcome');
  } else {
    misses.push('Answer does not match expected outcome');
  }

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
    hits,
    misses,
    reasoning: `Passed ${hits.length}/${totalChecks} checks`,
  };
});
```

**TypeScript SDK Benefits:**
- **Zero boilerplate**: No try/catch, stdin parsing, or JSON.stringify needed
- **Type-safe**: `CodeJudgeInput` interface with all fields typed
- **camelCase**: Idiomatic TypeScript naming (`candidateAnswer` vs `candidate_answer`)
- **Validation**: Zod schemas validate input and output at runtime
- **Error handling**: Exceptions automatically produce valid failure results

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

**See also:** `examples/features/code-judge-sdk/` for complete working examples

## Target Access for Code Evaluators

Code judges can access an LLM through a **target proxy** when sophisticated evaluation logic requires multiple LLM calls. This is useful for metrics like contextual precision, semantic similarity, or multi-step reasoning evaluation.

### Security

The target proxy is designed with security in mind:
- **Loopback only** - Binds to 127.0.0.1, not accessible from network
- **Bearer token auth** - Unique cryptographic token per execution
- **Call limits** - Enforces `max_calls` to prevent runaway costs
- **Auto-shutdown** - Proxy terminates when evaluator completes

### Configuration

Enable target access by adding a `target` block to your `code_judge` evaluator:

```yaml
evaluators:
  - name: contextual-precision
    type: code_judge
    script: bun scripts/contextual-precision.ts
    # Enable with defaults (max_calls: 50)
    target: {}

  - name: semantic-check
    type: code_judge
    script: bun scripts/semantic-check.ts
    # Custom call limit
    target:
      max_calls: 10
```

### Usage in TypeScript

**Single invocation:**

```typescript
#!/usr/bin/env bun
import { createTargetClient, defineCodeJudge } from '@agentv/eval';

export default defineCodeJudge(async ({ question, candidateAnswer }) => {
  const target = createTargetClient();

  if (!target) {
    // Target not available - likely missing `target` config
    return { score: 0, misses: ['Target not configured'] };
  }

  // Make an LLM call through the target proxy
  const response = await target.invoke({
    question: `Is this response relevant to: ${question}? Response: ${candidateAnswer}`,
    systemPrompt: 'Respond with JSON: { "relevant": true/false, "reasoning": "..." }'
  });

  // Parse the response
  const result = JSON.parse(response.rawText ?? '{}');
  return {
    score: result.relevant ? 1.0 : 0.0,
    reasoning: result.reasoning
  };
});
```

**Batch invocation (for metrics like Contextual Precision):**

```typescript
#!/usr/bin/env bun
import { createTargetClient, defineCodeJudge } from '@agentv/eval';

// Contextual Precision: evaluates retrieval ranking quality
// Retrieval context is extracted from expected_messages.tool_calls
export default defineCodeJudge(async ({ question, expectedMessages }) => {
  const target = createTargetClient();

  // Extract retrieval results from expected tool calls
  const retrievalContext: string[] = [];
  for (const msg of expectedMessages ?? []) {
    for (const tc of (msg as any).toolCalls ?? []) {
      const results = (tc.output as any)?.results;
      if (Array.isArray(results)) {
        retrievalContext.push(...results.filter((r: unknown) => typeof r === 'string'));
      }
    }
  }

  if (!target || retrievalContext.length === 0) {
    return { score: 0, misses: ['Target or retrieval context not available'] };
  }

  // Evaluate each retrieval node in batch
  const requests = retrievalContext.map((node) => ({
    question: `Is this node relevant to: ${question}\n\nNode: ${node}`,
    systemPrompt: 'Respond with JSON: { "relevant": true/false }'
  }));

  const responses = await target.invokeBatch(requests);

  // Parse relevance for each node
  const relevance = responses.map(r => {
    try {
      return JSON.parse(r.rawText ?? '{}').relevant === true;
    } catch { return false; }
  });

  // Calculate weighted precision (relevant nodes ranked higher = better score)
  const totalRelevant = relevance.filter(Boolean).length;
  if (totalRelevant === 0) return { score: 0, misses: ['No relevant nodes found'] };

  let precisionSum = 0, relevantSoFar = 0;
  for (let k = 0; k < relevance.length; k++) {
    if (relevance[k]) {
      relevantSoFar++;
      precisionSum += relevantSoFar / (k + 1);
    }
  }

  return { score: precisionSum / totalRelevant };
});
```

**YAML for batch example:**

```yaml
evalcases:
  - id: retrieval-ranking
    question: What is the capital of France?
    expected_outcome: Paris is the capital
    input_messages:
      - role: user
        content: What is the capital of France?
    # Retrieval context via expected tool calls
    expected_messages:
      - role: assistant
        tool_calls:
          - tool: vector_search
            input: { query: "capital of France" }
            output:
              results:
                - "Paris is the capital of France."
                - "The Eiffel Tower is in Paris."
                - "France is a European country."
      - role: assistant
        content: Paris is the capital of France.
```

### Usage in Python

```python
#!/usr/bin/env python3
import json
import os
import sys
import requests

def create_target_client():
    """Create target client from environment variables."""
    url = os.environ.get('AGENTV_TARGET_PROXY_URL')
    token = os.environ.get('AGENTV_TARGET_PROXY_TOKEN')
    if not url or not token:
        return None
    return {'url': url, 'token': token}

def invoke_target(client, question, system_prompt=None):
    """Invoke the target proxy."""
    response = requests.post(
        f"{client['url']}/invoke",
        headers={
            'Authorization': f"Bearer {client['token']}",
            'Content-Type': 'application/json'
        },
        json={
            'question': question,
            'systemPrompt': system_prompt
        }
    )
    response.raise_for_status()
    return response.json()

def main():
    input_data = json.loads(sys.stdin.read())
    target = create_target_client()

    if not target:
        print(json.dumps({
            'score': 0,
            'misses': ['Target not configured']
        }))
        sys.exit(0)

    result = invoke_target(
        target,
        f"Is this relevant? {input_data['candidate_answer']}",
        'Respond with JSON: { "relevant": true/false }'
    )

    parsed = json.loads(result.get('rawText', '{}'))
    print(json.dumps({
        'score': 1.0 if parsed.get('relevant') else 0.0,
        'reasoning': parsed.get('reasoning', '')
    }))

if __name__ == '__main__':
    main()
```

### Environment Variables

When `target` is configured, these environment variables are set automatically:
- `AGENTV_TARGET_PROXY_URL` - Local proxy URL (e.g., `http://127.0.0.1:45123`)
- `AGENTV_TARGET_PROXY_TOKEN` - Bearer token for authentication

### Metadata

Target proxy usage is recorded in the evaluator output:

```json
{
  "evaluatorProviderRequest": {
    "script": ["bun", "scripts/contextual-precision.ts"],
    "targetProxy": {
      "targetName": "claude-sonnet-4-20250514",
      "callCount": 3,
      "maxCalls": 50
    }
  }
}
```

**See also:** `examples/features/code-judge-with-llm-calls/` for complete working examples

## LLM Judge Prompt Template

LLM judges use markdown prompts to guide evaluation. AgentV automatically handles the output format, so focus your prompt on evaluation criteria and guidelines.

**Available Template Variables:**
- `{{question}}` - The original question/task
- `{{expected_outcome}}` - What the answer should accomplish
- `{{candidate_answer}}` - The actual output to evaluate
- `{{reference_answer}}` - Gold standard answer (optional, may be empty)
- `{{input_messages}}` - JSON stringified input message segments
- `{{output_messages}}` - JSON stringified expected output segments

**Default Evaluator Template:**

If you don't specify a custom evaluator template, AgentV uses this default:

```
You are an expert evaluator. Your goal is to grade the candidate_answer based on how well it achieves the expected_outcome for the original task.

Use the reference_answer as a gold standard for a high-quality response (if provided). The candidate_answer does not need to match it verbatim, but should capture the key points and follow the same spirit.

Be concise and focused in your evaluation. Provide succinct, specific feedback rather than verbose explanations.

[[ ## expected_outcome ## ]]
{{expected_outcome}}

[[ ## question ## ]]
{{question}}

[[ ## reference_answer ## ]]
{{reference_answer}}

[[ ## candidate_answer ## ]]
{{candidate_answer}}
```

You can customize this template in your eval file using the `evaluatorTemplate` field to add domain-specific criteria or scoring guidelines.

## Best Practices

### For Code-based Evaluators

1. **Focus on relevant fields** - Most evaluators only need the `candidate_answer` field
2. **Avoid false positives** - Don't check fields like `question` or `reference_answer` unless you specifically need context
3. **Be deterministic** - Same input should always produce same output
4. **Handle errors gracefully** - Return a valid result even when evaluation fails
5. **Provide helpful feedback** - Use `hits` and `misses` to explain the score

### For Prompt-based Evaluators (LLM Judges)

1. **Clear criteria** - Define what you're evaluating
2. **Specific guidelines** - Provide scoring rubrics
3. **JSON output** - Enforce structured output format
4. **Examples** - Show what good/bad looks like
5. **Concise prompts** - Keep instructions focused

## Running Code Evaluators

### In Eval Files

```yaml
execution:
  evaluators:
    - name: my_validator
      type: code_judge
      script: uv run my_validator.py
      cwd: ./evaluators
```

TypeScript evaluators use the same structure but invoke `tsx` (or another Node-compatible loader) so they work everywhere:

```yaml
execution:
  evaluators:
    - name: csv_guardrail
      type: code_judge
      script: npx --yes tsx ./evaluators/check-csv.ts
      cwd: ./evaluators
```

### Command Line Testing

Test your evaluator locally:

```bash
# Create test input
echo '{
  "candidate_answer": "test output here",
  "question": "test task",
  "expected_outcome": "expected result"
}' | uv run my_validator.py

# Should output:
# {
#   "score": 0.8,
#   "hits": ["check 1 passed"],
#   "misses": ["check 2 failed"],
#   "reasoning": "..."
# }
```

```bash
# TypeScript (uses tsx loader under Node)
echo '{
  "candidate_answer": "test output here",
  "question": "test task",
  "expected_outcome": "expected result"
}' | npx --yes tsx ./evaluators/check-csv.ts
```
