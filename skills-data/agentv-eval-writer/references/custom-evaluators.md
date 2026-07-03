# Custom Graders

## Wire Format

### Input (stdin JSON)

```json
{
  "input_files": ["path"],
  "input": [{"role": "user", "content": "..."}],
  "expected_output": [{"role": "assistant", "content": "..."}],
  "output": "final answer text",
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
  ]
}
```

`score` (0.0-1.0) required. `assertions` and `details` optional.

## TypeScript SDK Functions

```typescript
import {
  createTargetClient,
  defineScriptGrader,
  defineEval,
  definePromptTemplate,
  graders,
} from '@agentv/sdk';
```

- `defineScriptGrader(fn)` - Wraps evaluation function with stdin/stdout handling
- `defineEval(definition)` - Defines a YAML-aligned `.eval.ts` suite
- `graders` - Helper catalog that returns ordinary AgentV `assert` entries
- `createTargetClient()` - Returns LLM proxy client (when `target: {}` configured)
  - `.invoke({question, systemPrompt})` - Single LLM call
  - `.invokeBatch(requests)` - Batch LLM calls
- `definePromptTemplate(fn)` - Wraps prompt generation function
  - Raw stdin uses `snake_case`; SDK handlers receive `camelCase`
  - Context fields: `input`, `expectedOutput`, `output`, `messages`, `config`, `trace`, `traceSummary`, `tokenUsage`, `costUsd`, `durationMs`, `startTime`, `endTime`

For Python, the repo-local helper example in `examples/features/sdk-python/` keeps canonical `snake_case` fields and rejects deprecated wire aliases like `output_text`, `input_text`, and `reference_answer`. It is not a separate Python runner or a promised published package; generated evals still run through the AgentV CLI.

## YAML-Aligned Helper Example

Use helper factories for reusable Braintrust/DeepEval-inspired checks, but keep the result as AgentV `assert` entries:

```typescript
import { defineEval, graders } from '@agentv/sdk';

function ragFaithfulness() {
  return graders.llmRubric(undefined, {
    name: 'rag-faithfulness',
    target: 'grader-target',
    prompt: 'Grade whether the answer is supported by the retrieved context.',
  });
}

export default defineEval({
  name: 'rag-suite',
  tests: [
    {
      id: 'grounded-answer',
      input: 'Answer using the retrieved context.',
      assert: [
        graders.contains('source', { name: 'mentions-source' }),
        ragFaithfulness(),
      ],
    },
  ],
});
```

The helper lowers to ordinary YAML:

```yaml
assert:
  - name: mentions-source
    type: contains
    value: source
  - name: rag-faithfulness
    type: llm-rubric
    target: grader-target
    prompt: Grade whether the answer is supported by the retrieved context.
```

## Python Example

```python
#!/usr/bin/env python3
from agentv_py.grader import Assertion, ScriptGraderResult, define_script_grader


def evaluate(context):
    candidate = context.output or ""
    assertions = []
    for kw in ["async", "await"]:
        assertions.append(Assertion(text=f"Keyword '{kw}'", passed=kw in candidate))
    passed = sum(1 for item in assertions if item.passed)
    return ScriptGraderResult(
        score=passed / max(len(assertions), 1),
        assertions=assertions,
    )


if __name__ == "__main__":
    define_script_grader(evaluate)
```

## TypeScript Example

```typescript
#!/usr/bin/env bun
import { defineScriptGrader } from '@agentv/sdk';

export default defineScriptGrader(({ output, expectedOutput }) => {
  const candidate = output ?? '';
  const expected = expectedOutput
    ?.map((message) => (typeof message.content === 'string' ? message.content : ''))
    .join('\n') ?? '';
  const assertions: Array<{ text: string; passed: boolean }> = [];
  if (expected.length > 0 && candidate.includes(expected)) {
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
| `input` | Full resolved input array (JSON) |
| `expected_output` | Full resolved expected array (JSON) |
| `output` | Final answer / scored result string |
| `messages` | Transcript messages from target execution |

Markdown templates use `{{variable}}` syntax. TypeScript templates receive context object.
