# Example: Evaluating Agentic Retrieval with Traces

This example demonstrates how to evaluate an AI agent that performs multi-step research using semantic search tools.

## Scenario

An AI assistant receives a question, performs multiple search iterations to gather information, and synthesizes a comprehensive answer. We want to validate:
1. **Process:** The agent performs at least 3 search queries
2. **Content:** The final answer covers required topics

## Agent Trace Output

The agent runner produces a trace file (`trace.json`) capturing the investigation process:

```json
{
  "steps": [
    {
      "stepNumber": 1,
      "text": "Let me search for information about branch deactivation.",
      "toolCalls": [
        {
          "id": "call_abc123",
          "name": "semanticSearch",
          "input": {
            "query": "how to deactivate a branch in the system"
          },
          "output": {
            "results": [
              {
                "id": "doc_001",
                "title": "Branch Management Guide",
                "excerpt": "To deactivate a branch, navigate to Settings > Branches..."
              }
            ]
          }
        }
      ]
    },
    {
      "stepNumber": 2,
      "text": "I found general guidance. Let me search for more specific navigation steps.",
      "toolCalls": [
        {
          "id": "call_def456",
          "name": "semanticSearch",
          "input": {
            "query": "branch settings navigation path"
          },
          "output": {
            "results": [
              {
                "id": "doc_002",
                "title": "System Navigation Reference",
                "excerpt": "Access branch settings via Admin Console > Organization > Branches"
              }
            ]
          }
        }
      ]
    },
    {
      "stepNumber": 3,
      "text": "Let me verify the deactivation permissions and requirements.",
      "toolCalls": [
        {
          "id": "call_ghi789",
          "name": "semanticSearch",
          "input": {
            "query": "branch deactivation permissions requirements"
          },
          "output": {
            "results": [
              {
                "id": "doc_003",
                "title": "Branch Security Policies",
                "excerpt": "Only organization admins can deactivate branches. All pending transactions must be resolved first."
              }
            ]
          }
        }
      ]
    }
  ]
}
```

## AgentV Evaluation File

### Pattern 1: High-Level Constraints (Recommended for most cases)

```yaml
description: Agentic retrieval evaluation - validates multi-step research behavior
target: research-assistant

evalcases:
  - id: branch-deactivation-001
    input_messages:
      - role: user
        content: "How do I deactivate a branch?"
    
    # Validate process via trace
    evaluators:
      - type: tool_trajectory
        mode: any_order
        minimums:
          semanticSearch: 3
    
    # Validate content
    expected_messages:
      - role: tool
        content: |
          Documents should explain:
          - How to navigate to branch settings
          - The deactivation process
          - Required permissions
```

### Pattern 2: Precise Flow (For golden path testing)

```yaml
evalcases:
  - id: branch-deactivation-002
    input_messages:
      - role: user
        content: "How do I deactivate a branch?"
    
    # Specify exact conversation flow
    expected_messages:
      - role: assistant
        content: "Let me search for information about branch deactivation."
        tool_calls:
          - tool: semanticSearch
            args:
              query: "how to deactivate a branch"
      
      - role: tool
        name: semanticSearch
        content: "..." # Don't need exact match
      
      - role: assistant
        content: "I found general guidance. Let me search for more specific navigation steps."
        tool_calls:
          - tool: semanticSearch
            args:
              query: "branch settings navigation"
      
      - role: tool
        name: semanticSearch
        content: "..."
      
      - role: assistant
        content: "Let me verify the permissions required."
        tool_calls:
          - tool: semanticSearch
      
      - role: tool
        name: semanticSearch
        content: "..."
      
      - role: assistant
        content: |
          To deactivate a branch:
          1. Navigate to Admin Console > Organization > Branches
          2. Ensure you have organization admin permissions
          3. Resolve any pending transactions
          4. Click Deactivate
```

### Pattern 3: Both Together (Belt and Suspenders)

```yaml
evalcases:
  - id: branch-deactivation-003
    input_messages:
      - role: user
        content: "How do I deactivate a branch?"
    
    # Specify expected flow
    expected_messages:
      - role: assistant
        tool_calls:
          - tool: semanticSearch
      - role: tool
        name: semanticSearch
      - role: assistant
        tool_calls:
          - tool: semanticSearch
      - role: tool
        name: semanticSearch
      - role: assistant
        tool_calls:
          - tool: semanticSearch
      - role: tool
        name: semanticSearch
      - role: assistant
        content: "To deactivate a branch..."
    
    # PLUS add safety net
    evaluators:
      - type: tool_trajectory
        minimums:
          semanticSearch: 3
```

## Provider Integration

The provider converts the investigation trace to AgentV's normalized `TraceEvent[]` format:

```typescript
function convertToAgentVTrace(steps: InvestigationStep[]): TraceEvent[] {
  const events: TraceEvent[] = [];
  
  for (const step of steps) {
    // Add reasoning step
    if (step.text) {
      events.push({
        type: "model_step",
        timestamp: new Date().toISOString(),
        text: step.text,
        metadata: { stepNumber: step.stepNumber }
      });
    }
    
    // Add tool calls and results
    for (const call of step.toolCalls) {
      events.push({
        type: "tool_call",
        timestamp: new Date().toISOString(),
        id: call.id,
        name: call.name,
        input: call.input
      });
      
      if (call.output) {
        events.push({
          type: "tool_result",
          timestamp: new Date().toISOString(),
          id: call.id,
          output: call.output
        });
      }
    }
  }
  
  return events;
}
```

## Evaluation Results

AgentV produces:

```json
{
  "id": "branch-deactivation-001",
  "status": "pass",
  "scores": {
    "tool_trajectory": 1.0
  },
  "trace_summary": {
    "eventCount": 9,
    "toolNames": ["semanticSearch"],
    "toolCallsByName": {
      "semanticSearch": 3
    },
    "errorCount": 0
  },
  "attempts": [
    {
      "candidate_answer": "To deactivate a branch...",
      "trace_summary": { /* ... */ }
    }
  ]
}
```

## Key Takeaways

1. **Providers emit structured traces** - Simple JSON format with steps and tool calls
2. **AgentV normalizes to TraceEvent[]** - Provider-agnostic format for evaluation
3. **Two complementary approaches:**
   - `tool_trajectory` evaluator for flexible constraints
   - `expected_messages` for precise flow validation
4. **Trace summary always persisted** - Lightweight by default, full trace optional
