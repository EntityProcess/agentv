# Custom Evaluators

## Wire Format

### Input (stdin JSON)

```json
{
  "question": "string",
  "criteria": "string",
  "reference_answer": "string",
  "answer": "string",
  "guideline_files": ["path"],
  "input_files": ["path"],
  "input": [{"role": "user", "content": "..."}],
  "expected_output": [{"role": "assistant", "content": "..."}],
  "output": [{"role": "assistant", "content": "..."}],
  "trace": {
    "event_count": 5,
    "tool_names": ["fetch"],
    "tool_calls_by_name": {"fetch": 1},
    "error_count": 0,
    "llm_call_count": 2,
    "token_usage": {"input": 1000, "output": 500},
    "cost_usd": 0.0015,
    "duration_ms": 3500,
    "start_time": "2026-02-13T10:00:00.000Z",
    "end_time": "2026-02-13T10:00:03.500Z"
  }
}
```

### Output (stdout JSON)

```json
{
  "score": 0.85,
  "hits": ["passed check"],
  "misses": ["failed check"],
  "reasoning": "explanation"
}
```

`score` (0.0-1.0) required. `hits`, `misses`, `reasoning` optional.

## SDK Functions

```typescript
import { defineCodeJudge, createTargetClient, definePromptTemplate } from '@agentv/eval';
```

- `defineCodeJudge(fn)` - Wraps evaluation function with stdin/stdout handling
- `createTargetClient()` - Returns LLM proxy client (when `target: {}` configured)
  - `.invoke({question, systemPrompt})` - Single LLM call
  - `.invokeBatch(requests)` - Batch LLM calls
- `definePromptTemplate(fn)` - Wraps prompt generation function
  - Context fields: `question`, `answer`, `referenceAnswer`, `criteria`, `expectedOutput`, `output`, `config`, `trace`

## Python Example

```python
#!/usr/bin/env python3
import json, sys

def evaluate(data: dict) -> dict:
    candidate = data.get("answer", "")
    hits, misses = [], []
    for kw in ["async", "await"]:
        (hits if kw in candidate else misses).append(f"Keyword '{kw}'")
    return {
        "score": len(hits) / max(len(hits) + len(misses), 1),
        "hits": hits, "misses": misses
    }

if __name__ == "__main__":
    try:
        print(json.dumps(evaluate(json.loads(sys.stdin.read()))))
    except Exception as e:
        print(json.dumps({"score": 0, "misses": [str(e)]}))
        sys.exit(1)
```

## TypeScript Example

```typescript
#!/usr/bin/env bun
import { defineCodeJudge } from '@agentv/eval';

export default defineCodeJudge(({ answer, criteria }) => {
  const hits: string[] = [];
  const misses: string[] = [];
  if (answer.includes(criteria)) {
    hits.push('Matches expected outcome');
  } else {
    misses.push('Does not match expected outcome');
  }
  return {
    score: hits.length / Math.max(hits.length + misses.length, 1),
    hits, misses,
  };
});
```

## Template Variables

Derived from test fields (users never author these directly):

| Variable | Source |
|----------|--------|
| `question` | First user message in `input` |
| `criteria` | Test `criteria` field |
| `reference_answer` | Last entry in `expected_output` |
| `answer` | Last entry in `output` (runtime) |
| `input` | Full resolved input array (JSON) |
| `expected_output` | Full resolved expected array (JSON) |
| `output` | Full provider output array (JSON) |

Markdown templates use `{{variable}}` syntax. TypeScript templates receive context object.
