# Example: End-to-End Trace Evaluation Demo

This example demonstrates the core trace evaluation workflow - from agent execution to evaluation results.

## Scenario

A support agent answers questions by searching a knowledge base. We want to ensure it performs adequate research (at least 3 searches) before answering.

## Step 1: Agent Execution

User asks: **"How do I deactivate a branch?"**

The agent performs research and produces this trace:

```json
{
  "trace": [
    {
      "type": "tool_call",
      "timestamp": "2024-01-15T10:00:01Z",
      "id": "call_1",
      "name": "semanticSearch",
      "input": { "query": "branch deactivation process" }
    },
    {
      "type": "tool_result",
      "timestamp": "2024-01-15T10:00:02Z",
      "id": "call_1",
      "output": { "results": ["Navigate to Settings > Branches..."] }
    },
    {
      "type": "tool_call",
      "timestamp": "2024-01-15T10:00:03Z",
      "id": "call_2",
      "name": "semanticSearch",
      "input": { "query": "branch permissions requirements" }
    },
    {
      "type": "tool_result",
      "timestamp": "2024-01-15T10:00:04Z",
      "id": "call_2",
      "output": { "results": ["Only admins can deactivate branches..."] }
    },
    {
      "type": "tool_call",
      "timestamp": "2024-01-15T10:00:05Z",
      "id": "call_3",
      "name": "semanticSearch",
      "input": { "query": "branch deactivation prerequisites" }
    },
    {
      "type": "tool_result",
      "timestamp": "2024-01-15T10:00:06Z",
      "id": "call_3",
      "output": { "results": ["Resolve pending transactions first..."] }
    }
  ],
  "candidate_answer": "To deactivate a branch: 1) Ensure you have admin permissions, 2) Resolve pending transactions, 3) Navigate to Settings > Branches and click Deactivate."
}
```

## Step 2: Evaluation Configuration

Create an eval file that validates the agent's research behavior:

```yaml
# evals/support-agent.yaml
description: Support agent must research thoroughly before answering
target: support-agent

evalcases:
  - id: branch-deactivation
    input_messages:
      - role: user
        content: "How do I deactivate a branch?"
    
    evaluators:
      - name: research_depth
        type: tool_trajectory
        mode: any_order
        minimums:
          semanticSearch: 3
```

## Step 3: Run Evaluation

```bash
agentv eval evals/support-agent.yaml
```

## Step 4: Evaluation Result

```json
{
  "id": "branch-deactivation",
  "status": "pass",
  "score": 1.0,
  "evaluator_results": [
    {
      "name": "research_depth",
      "type": "tool_trajectory",
      "score": 1.0,
      "hits": ["semanticSearch called 3 times (minimum: 3)"],
      "misses": []
    }
  ],
  "trace_summary": {
    "eventCount": 6,
    "toolNames": ["semanticSearch"],
    "toolCallsByName": { "semanticSearch": 3 },
    "errorCount": 0
  }
}
```

## What This Validates

1. **Trace capture works** - Provider trace is captured and normalized
2. **TraceSummary is computed** - Tool calls are counted correctly
3. **tool_trajectory evaluator works** - Minimum threshold is validated
4. **Results include trace data** - `trace_summary` appears in output

## Pattern A: Precise Tool Call Validation

Use `expected_messages` with `tool_calls` to validate exact tool usage:

```yaml
evalcases:
  - id: branch-deactivation-precise
    input_messages:
      - role: user
        content: "How do I deactivate a branch?"
    
    # Validate exact tool calls with inputs
    expected_messages:
      - role: assistant
        tool_calls:
          - tool: semanticSearch
            input: { query: "branch deactivation process" }
          - tool: semanticSearch
            input: { query: "branch permissions requirements" }
          - tool: semanticSearch
            input: { query: "branch deactivation prerequisites" }
```

This validates:
- Tool names match exactly
- Tool inputs match via deep equality
- Calls appear in the specified order

## Pattern B: Flexible Constraints

Use `tool_trajectory` evaluator for high-level constraints:

```yaml
evalcases:
  - id: branch-deactivation-flexible
    input_messages:
      - role: user
        content: "How do I deactivate a branch?"
    
    evaluators:
      - name: research_depth
        type: tool_trajectory
        mode: any_order
        minimums:
          semanticSearch: 3
```

This validates:
- At least 3 calls to semanticSearch
- Order doesn't matter
- Input values don't matter

## Combining Both Patterns

Use both for precision + guardrails:

```yaml
evalcases:
  - id: branch-deactivation-strict
    input_messages:
      - role: user
        content: "How do I deactivate a branch?"
    
    # Precise validation of expected flow
    expected_messages:
      - role: assistant
        tool_calls:
          - tool: semanticSearch
            input: { query: "branch deactivation process" }
          - tool: semanticSearch
          - tool: semanticSearch
    
    # Safety net: must have at least 3 searches
    evaluators:
      - name: research_depth
        type: tool_trajectory
        mode: any_order
        minimums:
          semanticSearch: 3
```

Overall score is the mean of all validation results.
