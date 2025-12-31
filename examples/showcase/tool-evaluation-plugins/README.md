# Tool Evaluation Plugin Patterns

This showcase demonstrates **plugin-based tool evaluation patterns** that complement AgentV's built-in `tool_trajectory` evaluator. These patterns are intentionally implemented as plugins (code judges) rather than built-ins because they involve domain-specific logic or semantic evaluation.

## When to Use Plugins vs Built-ins

| Pattern | Implementation | Reason |
|---------|----------------|--------|
| Tool name/sequence matching | Built-in (`tool_trajectory`) | Deterministic, reusable primitive |
| Argument matching | Built-in (planned) | Extension of existing primitive |
| Tool selection correctness | **Plugin** | Requires semantic judgment |
| Tool input appropriateness | **Plugin** | Domain-specific criteria |
| Tool output utilization | **Plugin** | Requires understanding tool purposes |
| Efficiency scoring | **Plugin** | Custom thresholds, domain-specific |
| Pairwise comparison | **Plugin** | Specialized evaluation pattern |

## Plugin Examples

### 1. Tool Selection Evaluator (`tool_selection_judge.py`)

Evaluates whether the agent selected the **right tools** for the task. Uses LLM-as-judge pattern to semantically assess tool choices.

```yaml
evaluators:
  - name: tool-selection
    type: code_judge
    script: scripts/tool_selection_judge.py
```

### 2. Tool Input Validator (`tool_input_validator.ts`)

Validates that tool **arguments are semantically appropriate** (not just syntactically correct). Checks if argument values make sense in context.

```yaml
evaluators:
  - name: input-validation
    type: code_judge
    script: scripts/tool_input_validator.ts
```

### 3. Tool Efficiency Scorer (`efficiency_scorer.py`)

Computes efficiency metrics and scores based on configurable thresholds. Demonstrates how to use execution metrics in evaluation.

```yaml
evaluators:
  - name: efficiency
    type: code_judge
    script: scripts/efficiency_scorer.py
```

### 4. Pairwise Tool Comparison (`pairwise_tool_compare.py`)

Compares two agent responses for tool usage quality with position bias mitigation (runs comparison twice with swapped order).

```yaml
evaluators:
  - name: pairwise-compare
    type: code_judge
    script: scripts/pairwise_tool_compare.py
```

## Running the Examples

```bash
cd examples/showcase/tool-evaluation-plugins
npx agentv eval tool-eval-demo.yaml --target mock_agent
```

## Input Contract

All code judges receive a JSON object on stdin with:

```json
{
  "question": "User's question/task",
  "expected_outcome": "Expected behavior description",
  "candidate_answer": "Agent's final response",
  "output_messages": [
    {
      "role": "assistant",
      "content": "...",
      "toolCalls": [
        { "id": "...", "tool": "search", "args": { "query": "..." } }
      ]
    },
    {
      "role": "tool",
      "toolCallId": "...",
      "toolName": "search",
      "content": "Tool result..."
    }
  ],
  "candidate_trace_summary": {
    "eventCount": 5,
    "toolNames": ["search", "fetch"],
    "toolCallsByName": { "search": 2, "fetch": 1 },
    "errorCount": 0
  },
  "execution_metrics": {
    "tokenUsage": { "input": 1000, "output": 500 },
    "durationMs": 3500,
    "costUsd": 0.0015
  }
}
```

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
