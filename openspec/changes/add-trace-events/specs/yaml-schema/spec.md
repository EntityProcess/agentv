# Spec Delta: yaml-schema (Trace Evaluators)

## ADDED Requirements

### Requirement: Tool Calls in Expected Messages MUST be supported

The YAML schema SHALL support `tool_calls` within assistant messages in `expected_messages` to specify expected tool-use conversation structure.

#### Scenario: Assistant message with tool calls
Given:
```yaml
expected_messages:
  - role: user
    content: "Research branch deactivation"
  - role: assistant
    tool_calls:
      - tool: knowledgeSearch
        args:
          query: "branch deactivation process"
    content: "Let me search for that information..."
  - role: tool
    tool_call_id: call_1
    name: knowledgeSearch
    content: "Found documentation..."
  - role: assistant
    content: "Based on the search results..."
```
When parsed
Then the eval case should preserve the tool_calls structure within assistant messages.

#### Scenario: Tool calls without args
Given:
```yaml
expected_messages:
  - role: assistant
    tool_calls:
      - tool: knowledgeSearch
```
When parsed
Then the tool call is accepted without requiring args.

### Requirement: Trace-Based Evaluators MUST be supported

The YAML schema SHALL support configuring trace-based evaluators that can score tool-using agent behavior without custom code.

#### Scenario: Configure tool_trajectory evaluator with minimums
Given:
```yaml
evaluators:
  - name: minimum_search_calls
    type: tool_trajectory
    mode: any_order
    minimums:
      knowledgeSearch: 3
```
When parsed
Then the eval case should include a `tool_trajectory` evaluator configuration with per-tool minimum call counts.

#### Scenario: Configure tool_trajectory evaluator with expected sequence
Given:
```yaml
evaluators:
  - name: expected_search_pattern
    type: tool_trajectory
    mode: in_order
    expected:
      - tool: knowledgeSearch
      - tool: knowledgeSearch
      - tool: knowledgeSearch
```
When parsed
Then the eval case should include a `tool_trajectory` evaluator configuration with the expected tool list.

#### Scenario: Reject invalid tool_trajectory mode
Given:
```yaml
evaluators:
  - type: tool_trajectory
    mode: sometimes
    expected: [{ tool: knowledgeSearch }]
```
When parsed
Then schema validation should fail with an actionable error mentioning supported modes.
