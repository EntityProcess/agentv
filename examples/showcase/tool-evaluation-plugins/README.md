# Tool Evaluation Plugin Patterns

This showcase demonstrates **plugin-based tool evaluation patterns** that complement AgentV's built-in `tool_trajectory` evaluator. These patterns are intentionally implemented as plugins (code judges) rather than built-ins because they involve domain-specific logic or semantic evaluation.

## When to Use Plugins vs Built-ins

| Pattern | Implementation | Reason |
|---------|----------------|--------|
| Tool name/sequence matching | Built-in (`tool_trajectory`) | Deterministic, reusable primitive |
| Argument matching | Built-in (`tool_trajectory`) | Extension of sequence matching |
| Tool selection correctness | **Plugin** | Requires semantic judgment |
| Tool input appropriateness | **Plugin** | Domain-specific criteria |
| Tool output utilization | **Plugin** | Requires understanding tool purposes |
| Efficiency scoring | **Plugin** | Custom thresholds, domain-specific |
| Pairwise comparison | **Plugin** | Specialized evaluation pattern |

## Plugin Examples

### 1. Tool Selection Evaluator (`tool-selection-judge.ts`)

Evaluates whether the agent selected the **right tools** for the task. Uses heuristic matching to assess tool choices against task keywords.

```yaml
evaluators:
  - name: tool-selection
    type: code_judge
    script: ["bun", "run", "scripts/tool-selection-judge.ts"]
```

### 2. Tool Efficiency Scorer (`efficiency-scorer.ts`)

Computes efficiency metrics and scores based on configurable thresholds. Demonstrates how to use execution metrics in evaluation.

```yaml
evaluators:
  - name: efficiency
    type: code_judge
    script: ["bun", "run", "scripts/efficiency-scorer.ts"]
```

### 3. Pairwise Tool Comparison (`pairwise-tool-compare.ts`)

Compares two agent responses for tool usage quality with position bias mitigation (runs comparison twice with swapped order).

```yaml
evaluators:
  - name: pairwise-compare
    type: code_judge
    script: ["bun", "run", "scripts/pairwise-tool-compare.ts"]
```

## Running the Examples

```bash
# Set the required environment variable for the mock agent
export TOOL_EVAL_PLUGINS_DIR=$(pwd)/examples/showcase/tool-evaluation-plugins

# Run the demo
npx agentv eval examples/showcase/tool-evaluation-plugins/tool-eval-demo.yaml
```

## Input Contract

All code judges receive a JSON object on stdin with:

```json
{
  "question": "User's question/task",
  "criteria": "Expected behavior description",
  "reference_answer": "Gold standard answer (from expected_output)",
  "candidate_answer": "Agent's final response",
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

**Note:** `trace_summary` is a lightweight summary (just counts). To access tool call arguments, use `output_messages[].tool_calls[].input`.

## Output Contract

Code judges must output JSON with:

```json
{
  "score": 0.85,
  "hits": ["Used appropriate search tool", "Validated input before fetch"],
  "misses": ["Redundant search call"],
  "reasoning": "Agent demonstrated good tool selection with minor inefficiency"
}
```
