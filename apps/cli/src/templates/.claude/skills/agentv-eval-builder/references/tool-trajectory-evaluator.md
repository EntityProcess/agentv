# Tool Trajectory Evaluator Guide

Tool trajectory evaluators validate that an agent used the expected tools during execution. They work with trace data returned by agent providers (codex, vscode, cli with trace support).

## Tool Trajectory Evaluator

### Modes

#### 1. `any_order` - Minimum Tool Counts

Validates that each tool was called at least N times, regardless of order:

```yaml
execution:
  evaluators:
    - name: tool-usage
      type: tool_trajectory
      mode: any_order
      minimums:
        knowledgeSearch: 2    # Must be called at least twice
        documentRetrieve: 1   # Must be called at least once
```

**Use cases:**
- Ensure required tools are used
- Don't care about execution order
- Allow flexibility in agent implementation

#### 2. `in_order` - Sequential Matching

Validates tools appear in the expected sequence, but allows gaps (other tools can appear between):

```yaml
execution:
  evaluators:
    - name: workflow-sequence
      type: tool_trajectory
      mode: in_order
      expected:
        - tool: fetchData
        - tool: validateSchema
        - tool: transformData
        - tool: saveResults
```

**Use cases:**
- Validate logical workflow order
- Allow agent to use additional helper tools
- Check that key steps happen in sequence

#### 3. `exact` - Strict Sequence Match

Validates the exact tool sequence with no gaps or extra tools:

```yaml
execution:
  evaluators:
    - name: auth-sequence
      type: tool_trajectory
      mode: exact
      expected:
        - tool: checkCredentials
        - tool: generateToken
        - tool: auditLog
```

**Use cases:**
- Security-critical workflows
- Strict protocol validation
- Regression testing specific behavior

## Scoring

### tool_trajectory Scoring

| Mode | Score Calculation |
|------|------------------|
| `any_order` | (tools meeting minimum) / (total tools with minimums) |
| `in_order` | (matched tools in sequence) / (expected tools count) |
| `exact` | (correctly positioned tools) / (expected tools count) |

## Trace Data Requirements

Tool trajectory evaluators require trace data from the agent provider. Providers return `output_messages` containing `tool_calls` that capture agent tool usage.

### Output Messages Format

Providers return `output_messages` with `tool_calls` in the JSONL output:

```json
{
  "id": "eval-001",
  "output_messages": [
    {
      "role": "assistant",
      "content": "I'll search for information about this topic.",
      "tool_calls": [
        {
          "tool": "knowledgeSearch",
          "input": { "query": "REST vs GraphQL" },
          "output": { "results": [...] },
          "id": "call_123",
          "timestamp": "2024-01-15T10:30:00Z"
        }
      ]
    }
  ]
}
```

The evaluator extracts tool calls from `output_messages[].tool_calls[]`. Optional fields `id` and `timestamp` can be included for debugging.

### Supported Providers

- **codex** - Returns output_messages via JSONL log events
- **vscode / vscode-insiders** - Returns output_messages from Copilot execution
- **cli** - Returns `output_messages` with `tool_calls`

## Complete Examples

### Research Agent Validation

```yaml
description: Validate research agent tool usage

execution:
  target: codex_agent  # Provider that returns traces

evalcases:
  - id: comprehensive-research
    expected_outcome: Agent thoroughly researches the topic
    
    input_messages:
      - role: user
        content: Research machine learning frameworks
    
    execution:
      evaluators:
        # Check minimum tool usage
        - name: coverage
          type: tool_trajectory
          mode: any_order
          minimums:
            webSearch: 1
            documentRead: 2
            noteTaking: 1
        
        # Check workflow order
        - name: workflow
          type: tool_trajectory
          mode: in_order
          expected:
            - tool: webSearch
            - tool: documentRead
            - tool: summarize
```

### Multi-Step Pipeline

```yaml
evalcases:
  - id: data-pipeline
    expected_outcome: Process data through complete pipeline

    input_messages:
      - role: user
        content: Process the customer dataset

    execution:
      evaluators:
        - name: pipeline-check
          type: tool_trajectory
          mode: exact
          expected:
            - tool: loadData
            - tool: validate
            - tool: transform
            - tool: export
```

## CLI Options for Traces

```bash
# Write trace files to disk
agentv eval evals/test.yaml --dump-traces

# Include full trace in result output
agentv eval evals/test.yaml --include-trace
```

## Best Practices

1. **Choose the right mode** - Use `any_order` for flexibility, `exact` for strict validation
2. **Start with any_order** - Then tighten to `in_order` or `exact` as needed
3. **Combine with other evaluators** - Use tool trajectory for execution, LLM judge for output quality
4. **Test with --dump-traces** - Inspect actual traces to understand agent behavior
5. **Use code evaluators for custom validation** - Write custom tool validation scripts with access to trace data
