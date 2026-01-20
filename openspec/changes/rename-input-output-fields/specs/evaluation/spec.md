# evaluation Specification (Delta)

## MODIFIED Requirements

### Requirement: Code Judge Payload Schema

The system SHALL update the code judge payload to use new field names.

#### Scenario: Code judge payload structure
- **GIVEN** an eval case with:
  ```yaml
  input: "What is the risk level?"
  expected_output:
    riskLevel: High
  expected_outcome: "Correctly classify as high risk"
  ```
- **WHEN** a code judge evaluator is invoked
- **THEN** the stdin payload SHALL be:
  ```json
  {
    "question": "What is the risk level?",
    "expected_outcome": "Correctly classify as high risk",
    "expected_output": [{"role": "assistant", "content": {"riskLevel": "High"}}],
    "input": [{"role": "user", "content": "What is the risk level?"}],
    "actual_output": "...",
    "output_messages": [...],
    "reference_answer": null,
    "guideline_files": [...],
    "input_files": [...],
    "trace_summary": {...},
    "config": {...}
  }
  ```

#### Scenario: Code judge with full trace expected_output
- **GIVEN** an eval case with:
  ```yaml
  expected_output:
    - role: assistant
      tool_calls:
        - tool: Read
          input: { file_path: "config.json" }
    - role: assistant
      content: { status: "done" }
  ```
- **WHEN** a code judge evaluator is invoked
- **THEN** `expected_output` in the payload SHALL contain the full message array with tool calls

#### Scenario: Field name changes
- **GIVEN** a code judge evaluator
- **WHEN** the payload is constructed
- **THEN** the following field mappings SHALL apply:

| Old Field | New Field |
|-----------|-----------|
| `input_messages` | `input` |
| `expected_messages` | `expected_output` |
| `candidate_answer` | `actual_output` |

### Requirement: Code Judge SDK Types

The `@agentv/core` SDK SHALL export updated TypeScript types for code judge payloads.

#### Scenario: SDK type definitions
- **GIVEN** a TypeScript code judge imports from `@agentv/core`
- **WHEN** using `readCodeJudgePayload()`
- **THEN** the returned object SHALL have camelCase properties:
  - `input` (array of messages)
  - `expectedOutput` (array of messages)
  - `actualOutput` (string)
  - `expectedOutcome` (string)
  - `outputMessages` (array or null)
  - `traceSummary` (object or null)
