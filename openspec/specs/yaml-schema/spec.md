# yaml-schema Specification

## Purpose
TBD - created by archiving change implement-rubric-evaluator. Update Purpose after archive.
## Requirements
### Requirement: Expected Outcome Field MUST be supported
The YAML parser SHALL support `expected_outcome` as the primary field for defining the goal, while maintaining support for `outcome` as an alias.

#### Scenario: Parse expected_outcome
Given a YAML file with `expected_outcome: "Goal"`
When parsed
Then the `EvalCase` object should have `expected_outcome` set to "Goal".

#### Scenario: Parse outcome alias
Given a YAML file with `outcome: "Goal"`
When parsed
Then the `EvalCase` object should have `expected_outcome` set to "Goal".

### Requirement: Inline Rubrics MUST be parsed
The YAML parser SHALL support a `rubrics` list on the `EvalCase` and automatically configure a `RubricEvaluator`.

#### Scenario: Inline Rubrics Definition
Given a YAML file with:
```yaml
rubrics:
  - "Must be polite"
```
When parsed
Then the `EvalCase` should have an evaluator of type `rubric` configured with the provided rubric item.

### Requirement: Explicit Rubric Evaluator Configuration MUST be supported
The YAML parser SHALL support configuring the `RubricEvaluator` explicitly in the `evaluators` list, allowing for advanced options like model selection.

#### Scenario: Explicit Configuration
Given a YAML file with:
```yaml
evaluators:
  - type: rubric
    rubrics: ["Must be polite"]
    model: "gpt-4"
```
When parsed
Then the `EvalCase` should have a `RubricEvaluator` configured with the specified model and rubrics.

### Requirement: Verdict in Score MUST be included
The `EvaluationScore` type SHALL include an optional `verdict` field.

#### Scenario: Score Type
Given the `EvaluationScore` interface
When inspected
Then it should have a property `verdict?: 'pass' | 'fail' | 'borderline'`.

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
        input: { query: "branch deactivation process" }
        output: "Found documentation..."  # Optional
    content: "Let me search for that information..."
  - role: assistant
    content: "Based on the search results..."
```
- **WHEN** the YAML is parsed
- **THEN** the eval case SHALL preserve the `tool_calls` structure within assistant messages
- **AND** the structure SHALL be available to evaluators.
- **AND** `input` is used for tool arguments (not `args`)
- **AND** `input` accepts any JSON value in either YAML flow style (`{ key: "value" }`) or block style
- **AND** `output` is optional for expected tool results.

#### Scenario: Tool calls without input
- **GIVEN** a YAML eval case with tool calls that omit the `input` field:
```yaml
expected_messages:
  - role: assistant
    tool_calls:
      - tool: knowledgeSearch
```
- **WHEN** the YAML is parsed
- **THEN** the tool call SHALL be accepted without requiring `input`.

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

### Requirement: Per-evaluator weight MUST be supported

The YAML schema SHALL support an optional `weight` field on each entry in an eval case `evaluators` list.

- `weight` MUST be a finite number.
- `weight` MUST be greater than or equal to `0`.
- If omitted, `weight` defaults to `1.0`.

#### Scenario: Parse evaluator weight
- **GIVEN** a YAML eval case with:
  ```yaml
  evaluators:
    - name: safety
      type: llm_judge
      weight: 3
  ```
- **WHEN** the YAML is parsed
- **THEN** the evaluator configuration includes `weight: 3`

#### Scenario: Reject negative weight
- **GIVEN** a YAML eval case with:
  ```yaml
  evaluators:
    - name: safety
      type: llm_judge
      weight: -1
  ```
- **WHEN** the YAML is parsed
- **THEN** schema validation SHALL fail
- **AND** the error message SHALL mention that `weight` must be `>= 0`

#### Scenario: Reject non-numeric weight
- **GIVEN** a YAML eval case with:
  ```yaml
  evaluators:
    - name: safety
      type: llm_judge
      weight: high
  ```
- **WHEN** the YAML is parsed
- **THEN** schema validation SHALL fail

### Requirement: Code judge scripts MUST use argv arrays

The YAML schema SHALL accept `code_judge` evaluators with `script` defined as an array of argv tokens.

#### Scenario: Configure code_judge with argv script
- **GIVEN** a YAML eval case with:
  ```yaml
  evaluators:
    - name: my_code_check
      type: code_judge
      script: ["bun", "run", "validate_risk_output.ts"]
  ```
- **WHEN** the YAML is parsed
- **THEN** schema validation succeeds
- **AND** the evaluator configuration preserves the argv tokens.

#### Scenario: Convert string scripts for backward compatibility
- **GIVEN** a YAML eval case with:
  ```yaml
  evaluators:
    - name: my_code_check
      type: code_judge
      script: bun run validate_risk_output.ts
  ```
- **WHEN** the YAML is parsed
- **THEN** schema validation succeeds
- **AND** the system converts the string to a shell argv appropriate for the current platform.

### Requirement: Input alias with shorthand support

The YAML schema SHALL support `input` as an alias for `input_messages` with shorthand expansion.

#### Scenario: String shorthand for single user query
- **GIVEN** a YAML eval case with:
  ```yaml
  input: "What is 2+2?"
  ```
- **WHEN** the YAML is parsed
- **THEN** `input_messages` SHALL be set to:
  ```json
  [{"role": "user", "content": "What is 2+2?"}]
  ```

#### Scenario: Array input via alias
- **GIVEN** a YAML eval case with:
  ```yaml
  input:
    - role: system
      content: "You are a calculator"
    - role: user
      content: "What is 2+2?"
  ```
- **WHEN** the YAML is parsed
- **THEN** `input_messages` SHALL be set to the array

#### Scenario: Canonical name takes precedence
- **GIVEN** a YAML eval case with both:
  ```yaml
  input: "Alias query"
  input_messages:
    - role: user
      content: "Canonical query"
  ```
- **WHEN** the YAML is parsed
- **THEN** `input_messages` SHALL use the canonical value
- **AND** `input` alias SHALL be ignored

### Requirement: Expected output alias with shorthand support

The YAML schema SHALL support `expected_output` as an alias for `expected_messages` with shorthand expansion.

#### Scenario: String shorthand
- **GIVEN** a YAML eval case with:
  ```yaml
  expected_output: "The answer is 4"
  ```
- **WHEN** the YAML is parsed
- **THEN** `expected_messages` SHALL be set to:
  ```json
  [{"role": "assistant", "content": "The answer is 4"}]
  ```

#### Scenario: Object shorthand for structured output
- **GIVEN** a YAML eval case with:
  ```yaml
  expected_output:
    riskLevel: High
    reasoning: "Explanation"
  ```
- **WHEN** the YAML is parsed
- **THEN** `expected_messages` SHALL be set to:
  ```json
  [{"role": "assistant", "content": {"riskLevel": "High", "reasoning": "Explanation"}}]
  ```

#### Scenario: Array with tool calls via alias
- **GIVEN** a YAML eval case with:
  ```yaml
  expected_output:
    - role: assistant
      tool_calls:
        - tool: Read
          input: { file_path: "config.json" }
    - role: assistant
      content: { status: "done" }
  ```
- **WHEN** the YAML is parsed
- **THEN** `expected_messages` SHALL preserve the full message array with tool calls

#### Scenario: Canonical name takes precedence
- **GIVEN** a YAML eval case with both:
  ```yaml
  expected_output: { riskLevel: High }
  expected_messages:
    - role: assistant
      content: "Canonical answer"
  ```
- **WHEN** the YAML is parsed
- **THEN** `expected_messages` SHALL use the canonical value
- **AND** `expected_output` alias SHALL be ignored

