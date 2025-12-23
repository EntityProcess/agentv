# Tool Trajectory Evaluator Guide

Tool trajectory evaluators validate that an agent used the expected tools during execution. They work with trace data returned by agent providers (codex, vscode, cli with trace support).

## Evaluator Types

AgentV provides two ways to validate tool usage:

1. **`tool_trajectory`** - Dedicated evaluator with configurable matching modes
2. **`expected_messages`** - Inline tool_calls in expected_messages for simpler cases

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

## Expected Tool Calls Evaluator

For simpler cases, specify tool_calls inline in `expected_messages`:

```yaml
evalcases:
  - id: research-task
    expected_outcome: Agent searches and retrieves documents

    input_messages:
      - role: user
        content: Research REST vs GraphQL differences

    expected_messages:
      - role: assistant
        content: I'll research this topic.
        tool_calls:
          - tool: knowledgeSearch
          - tool: knowledgeSearch
          - tool: documentRetrieve

    execution:
      evaluators:
        - name: tool-validator
          type: expected_tool_calls
```

### With Input Matching

Validate specific inputs were passed to tools:

```yaml
expected_messages:
  - role: assistant
    content: Checking metrics...
    tool_calls:
      - tool: getCpuMetrics
        input:
          server: prod-1
      - tool: getMemoryMetrics
        input:
          server: prod-1
```

## Scoring

### tool_trajectory Scoring

| Mode | Score Calculation |
|------|------------------|
| `any_order` | (tools meeting minimum) / (total tools with minimums) |
| `in_order` | (matched tools in sequence) / (expected tools count) |
| `exact` | (correctly positioned tools) / (expected tools count) |

### expected_tool_calls Scoring

Sequential matching: `(matched tool_calls) / (expected tool_calls)`

## Trace Data Requirements

Tool trajectory evaluators require trace data from the agent provider. Supported providers:

- **codex** - Returns trace via JSONL log events
- **vscode / vscode-insiders** - Returns trace from Copilot execution
- **cli** - Can return trace if agent outputs trace format

### Trace Event Structure

```json
{
  "type": "tool_call",
  "name": "knowledgeSearch",
  "input": { "query": "REST vs GraphQL" },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

## Complete Examples

### Research Agent Validation

```yaml
$schema: agentv-eval-v2
description: Validate research agent tool usage

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
    
    expected_messages:
      - role: assistant
        content: Processing data...
        tool_calls:
          - tool: loadData
          - tool: validate
          - tool: transform
          - tool: export
    
    execution:
      evaluators:
        - name: pipeline-check
          type: expected_tool_calls
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
5. **Use expected_tool_calls for simple cases** - It's more readable for basic tool validation
