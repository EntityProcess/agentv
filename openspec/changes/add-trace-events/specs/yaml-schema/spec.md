# Spec Delta: yaml-schema (Trace Evaluators)

## ADDED Requirements

### Requirement: Trace-Based Evaluators MUST be supported

The YAML schema SHALL support configuring trace-based evaluators that can score tool-using agent behavior without custom code.

#### Scenario: Configure tool_trajectory evaluator
Given:
```yaml
evaluators:
  - name: expected_search_then_verify
    type: tool_trajectory
    mode: in_order
    minimums:
      knowledgeSearch: 3
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
