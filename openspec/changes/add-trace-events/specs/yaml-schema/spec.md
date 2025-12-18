# Spec Delta: yaml-schema (Trace Evaluators)

## ADDED Requirements

### Requirement: Tool Calls in Expected Messages MUST be supported

The YAML schema SHALL support `tool_calls` within assistant messages in `expected_messages` to specify expected tool-use conversation structure.

#### Scenario: Assistant message with tool calls
- **GIVEN** a YAML eval case with assistant messages containing `tool_calls`:
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
- **WHEN** the YAML is parsed
- **THEN** the eval case SHALL preserve the `tool_calls` structure within assistant messages
- **AND** the structure SHALL be available to evaluators.

#### Scenario: Tool calls without args
- **GIVEN** a YAML eval case with tool calls that omit the `args` field:
```yaml
expected_messages:
  - role: assistant
    tool_calls:
      - tool: knowledgeSearch
```
- **WHEN** the YAML is parsed
- **THEN** the tool call SHALL be accepted without requiring `args`.

### Requirement: Trace-Based Evaluators MUST be supported

The YAML schema SHALL support configuring trace-based evaluators that can score tool-using agent behavior without custom code.

#### Scenario: Configure tool_trajectory evaluator with minimums
- **GIVEN** a YAML eval case with a `tool_trajectory` evaluator specifying per-tool minimums:
```yaml
evaluators:
  - name: minimum_search_calls
    type: tool_trajectory
    mode: any_order
    minimums:
      knowledgeSearch: 3
```
- **WHEN** the YAML is parsed
- **THEN** the eval case SHALL include a `tool_trajectory` evaluator configuration
- **AND** the configuration SHALL include the per-tool minimum call counts.

#### Scenario: Configure tool_trajectory evaluator with expected sequence
- **GIVEN** a YAML eval case with a `tool_trajectory` evaluator specifying an expected tool sequence:
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
- **WHEN** the YAML is parsed
- **THEN** the eval case SHALL include a `tool_trajectory` evaluator configuration
- **AND** the configuration SHALL preserve the expected tool list.

#### Scenario: Reject invalid tool_trajectory mode
- **GIVEN** a YAML eval case with an invalid `mode` value:
```yaml
evaluators:
  - type: tool_trajectory
    mode: sometimes
    expected: [{ tool: knowledgeSearch }]
```
- **WHEN** the YAML is parsed
- **THEN** schema validation SHALL fail
- **AND** the error message SHALL mention the supported modes (`any_order`, `in_order`, `exact`).
