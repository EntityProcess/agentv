# Tool-Call F1 Scoring

Code judge plugins that compute **F1 scores** over tool calls, comparing expected tools against actual agent behavior.

## Judges

### `judges/tool-call-f1.ts` — Name-only F1

Computes precision, recall, and F1 by comparing expected tool names against actual tool calls from `outputMessages`.

- **True positive**: expected tool was called
- **False negative**: expected tool was NOT called
- **False positive**: unexpected tool was called

```yaml
evaluators:
  - name: tool-f1
    type: code_judge
    script: ["bun", "run", "../judges/tool-call-f1.ts"]
    expected_tools: ["search", "fetch"]
```

### `judges/tool-args-f1.ts` — Name + argument F1

Extends the name-only judge by also validating tool arguments. A call is a hit only if both the name matches AND the required arguments are present (subset match).

```yaml
evaluators:
  - name: tool-args-f1
    type: code_judge
    script: ["bun", "run", "../judges/tool-args-f1.ts"]
    expected_tools:
      - tool: search
        args: { query: "weather tokyo" }
      - tool: fetch
```

## Running

```bash
cd examples/features/tool-evaluation-plugins
bun agentv eval evals/dataset.yaml --target <your-target>
```

## Output

Each judge returns:

```json
{
  "score": 0.667,
  "hits": ["Expected tool 'search' was called"],
  "misses": ["Expected tool 'fetch' was NOT called"],
  "reasoning": "precision=1.000 recall=0.500 F1=0.667 | expected=2 actual=1 TP=1 FP=0 FN=1",
  "details": { "precision": 1, "recall": 0.5, "f1": 0.667, "tp": 1, "fp": 0, "fn": 1 }
}
```

## When to Use

| Need | Solution |
|------|----------|
| Exact tool sequence | Built-in `tool_trajectory` with `mode: in_order` |
| Minimum tool counts | Built-in `tool_trajectory` with `minimums` |
| Set-based F1 scoring | **This plugin** (`tool-call-f1.ts`) |
| F1 with argument validation | **This plugin** (`tool-args-f1.ts`) |
