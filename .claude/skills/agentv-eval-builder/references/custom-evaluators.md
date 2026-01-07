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
  "output_messages": [
    {
      "role": "assistant",
      "content": "...",
      "tool_calls": [
        {
          "tool": "search",
          "input": { "query": "..." },
          "output": { "results": [...] },
          "id": "call_123",
          "timestamp": "2024-01-15T10:30:00Z"
        }
      ]
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
- `output_messages` - Full agent execution trace with tool calls (use `tool_calls[].input` for arguments)
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

Run via `npx --yes tsx ./evaluator.ts`. The optional `@agentv/core` SDK provides type-safe camelCase payload parsing.

```typescript
// With SDK (recommended)
import { readCodeJudgePayload } from '@agentv/core';

try {
  const { candidateAnswer, expectedOutcome } = readCodeJudgePayload();
  const hits: string[] = [];
  const misses: string[] = [];

  // Your validation logic here
  if (candidateAnswer.includes(expectedOutcome)) {
    hits.push('Answer matches expected outcome');
  } else {
    misses.push('Answer does not match expected outcome');
  }

  const total = hits.length + misses.length;
  console.log(JSON.stringify({
    score: total === 0 ? 0 : hits.length / total,
    hits, misses,
    reasoning: `Passed ${hits.length}/${total} checks`
  }, null, 2));
} catch (e) {
  console.log(JSON.stringify({ score: 0, hits: [], misses: [String(e)], reasoning: 'Error' }));
  process.exit(1);
}
```

**Without SDK:** Parse stdin JSON directly (see Python template).

**SDK exports:** `readCodeJudgePayload()`, `parseCodeJudgePayload(json)`, `CodeJudgePayload` type

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

## Testing Evaluators Locally

```bash
# Python
echo '{"candidate_answer": "test", "question": "task", "expected_outcome": "result"}' | uv run my_validator.py

# TypeScript
echo '{"candidate_answer": "test", "question": "task", "expected_outcome": "result"}' | npx --yes tsx ./check.ts
```
