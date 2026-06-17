# Custom Graders

## Wire Format

### Input (stdin JSON)

```json
{
  "criteria": "string",
  "input_files": ["path"],
  "input": [{"role": "user", "content": "..."}],
  "expected_output": [{"role": "assistant", "content": "..."}],
  "output": "final answer text",
  "answer": "deprecated alias for output",
  "messages": [{"role": "assistant", "content": "final answer text"}],
  "trace": {
    "schema_version": "agentv.trace.v1",
    "event_count": 5,
    "tool_calls": {"fetch": 1},
    "error_count": 0,
    "llm_call_count": 2,
    "messages": [],
    "events": []
  },
  "trace_summary": {
    "event_count": 5,
    "tool_calls": {"fetch": 1},
    "error_count": 0,
    "llm_call_count": 2
  },
  "token_usage": {"input": 1000, "output": 500},
  "cost_usd": 0.0015,
  "duration_ms": 3500,
  "start_time": "2026-02-13T10:00:00.000Z",
  "end_time": "2026-02-13T10:00:03.500Z"
}
```

### Output (stdout JSON)

```json
{
  "score": 0.85,
  "assertions": [
    { "text": "passed check", "passed": true },
    { "text": "failed check", "passed": false }
  ],
  "reasoning": "explanation"
}
```

`score` (0.0-1.0) required. `assertions`, `reasoning` optional.

## SDK Functions

```typescript
import { defineCodeGrader, createTargetClient, definePromptTemplate } from '@agentv/eval';
```

- `defineCodeGrader(fn)` - Wraps evaluation function with stdin/stdout handling
- `createTargetClient()` - Returns LLM proxy client (when `target: {}` configured)
  - `.invoke({question, systemPrompt})` - Single LLM call
  - `.invokeBatch(requests)` - Batch LLM calls
- `definePromptTemplate(fn)` - Wraps prompt generation function
  - Raw stdin uses `snake_case`; SDK handlers receive `camelCase`
  - Context fields: `input`, `expectedOutput`, `output`, `answer`, `messages`, `criteria`, `config`, `trace`, `traceSummary`, `tokenUsage`, `costUsd`, `durationMs`, `startTime`, `endTime`

## Python Example

```python
#!/usr/bin/env python3
import json, sys

def evaluate(data: dict) -> dict:
    candidate = data.get("answer", "")
    assertions = []
    for kw in ["async", "await"]:
        assertions.append({"text": f"Keyword '{kw}'", "passed": kw in candidate})
    passed = sum(1 for a in assertions if a["passed"])
    return {
        "score": passed / max(len(assertions), 1),
        "assertions": assertions,
    }

if __name__ == "__main__":
    try:
        print(json.dumps(evaluate(json.loads(sys.stdin.read()))))
    except Exception as e:
        print(json.dumps({"score": 0, "assertions": [{"text": str(e), "passed": False}]}))
        sys.exit(1)
```

## TypeScript Example

```typescript
#!/usr/bin/env bun
import { defineCodeGrader } from '@agentv/eval';

export default defineCodeGrader(({ output, criteria }) => {
  const answer = output ?? '';
  const assertions: Array<{ text: string; passed: boolean }> = [];
  if (answer.includes(criteria)) {
    assertions.push({ text: 'Matches expected outcome', passed: true });
  } else {
    assertions.push({ text: 'Does not match expected outcome', passed: false });
  }
  const passed = assertions.filter(a => a.passed).length;
  return {
    score: passed / Math.max(assertions.length, 1),
    assertions,
  };
});
```

## Template Variables

Derived from test fields (users never author these directly):

| Variable | Source |
|----------|--------|
| `criteria` | Test `criteria` field |
| `input` | Full resolved input array (JSON) |
| `expected_output` | Full resolved expected array (JSON) |
| `output` | Final answer / scored result string |
| `answer` | Deprecated alias for `output` |
| `messages` | Transcript messages from target execution |

Markdown templates use `{{variable}}` syntax. TypeScript templates receive context object.
