---
name: agentv-eval-builder
description: Create and maintain AgentV YAML evaluation files for testing AI agent performance. Use this skill when creating new eval files, adding eval cases, or configuring custom evaluators (code validators or LLM judges) for agent testing workflows.
---

# AgentV Eval Builder

## Schema Reference
- Schema: `references/eval-schema.json` (JSON Schema for validation and tooling)
- Format: YAML with structured content arrays
- Examples: `references/example-evals.md`

## Feature Reference
- Rubrics: `references/rubric-evaluator.md` - Structured criteria-based evaluation
- Composite Evaluators: `references/composite-evaluator.md` - Combine multiple evaluators
- Tool Trajectory: `references/tool-trajectory-evaluator.md` - Validate agent tool usage
- Custom Evaluators: `references/custom-evaluators.md` - Code and LLM judge templates

## Structure Requirements
- Root level: `description` (optional), `target` (optional), `execution` (optional), `evalcases` (required)
- Eval case fields: `id` (required), `expected_outcome` (required), `input_messages` (required)
- Optional fields: `expected_messages`, `conversation_id`, `rubrics`, `execution`
- `expected_messages` is optional - omit for outcome-only evaluation where the LLM judge evaluates based on `expected_outcome` criteria alone
- Message fields: `role` (required), `content` (required)
- Message roles: `system`, `user`, `assistant`, `tool`
- Content types: `text` (inline), `file` (relative or absolute path)
- Attachments (type: `file`) should default to the `user` role
- File paths: Relative (from eval file dir) or absolute with "/" prefix (from repo root)

## Custom Evaluators

Configure multiple evaluators per eval case via `execution.evaluators` array.

### Code Evaluators
Scripts that validate output programmatically:

```yaml
execution:
  evaluators:
    - name: json_format_validator
      type: code_judge
      script: uv run validate_output.py
      cwd: ../../evaluators/scripts
```

**Contract:**
- Input (stdin): JSON with `question`, `expected_outcome`, `reference_answer`, `candidate_answer`, `guideline_files` (file paths), `input_files` (file paths, excludes guidelines), `input_messages`
- Output (stdout): JSON with `score` (0.0-1.0), `hits`, `misses`, `reasoning`

**Template:** See `references/custom-evaluators.md` for Python code evaluator template

### LLM Judges
Language models evaluate response quality:

```yaml
execution:
  evaluators:
    - name: content_evaluator
      type: llm_judge
      prompt: /evaluators/prompts/correctness.md
      model: gpt-5-chat
```

### Tool Trajectory Evaluators
Validate agent tool usage patterns (requires trace data from provider):

```yaml
execution:
  evaluators:
    - name: research_check
      type: tool_trajectory
      mode: any_order       # Options: any_order, in_order, exact
      minimums:             # For any_order mode
        knowledgeSearch: 2
      expected:             # For in_order/exact modes
        - tool: knowledgeSearch
        - tool: documentRetrieve
```

See `references/tool-trajectory-evaluator.md` for modes and configuration.

### Expected Messages Evaluators
Validate tool calls and inputs inline with conversation flow:

```yaml
expected_messages:
  - role: assistant
    tool_calls:
      - tool: getMetrics
        input: { server: "prod-1" }

execution:
  evaluators:
    - name: input_check
      type: expected_messages
```

### Multiple Evaluators
Define multiple evaluators to run sequentially. The final score is a weighted average of all results.

```yaml
execution:
  evaluators:
    - name: format_check      # Runs first
      type: code_judge
      script: uv run validate_json.py
    - name: content_check     # Runs second
      type: llm_judge
```

### Rubric Evaluator
Inline rubrics for structured criteria-based evaluation:

```yaml
evalcases:
  - id: explanation-task
    expected_outcome: Clear explanation of quicksort
    input_messages:
      - role: user
        content: Explain quicksort
    rubrics:
      - Mentions divide-and-conquer approach
      - Explains the partition step
      - id: complexity
        description: States time complexity correctly
        weight: 2.0
        required: true
```

See `references/rubric-evaluator.md` for detailed rubric configuration.

### Composite Evaluator
Combine multiple evaluators with aggregation:

```yaml
execution:
  evaluators:
    - name: release_gate
      type: composite
      evaluators:
        - name: safety
          type: llm_judge
          prompt: ./prompts/safety.md
        - name: quality
          type: llm_judge
          prompt: ./prompts/quality.md
      aggregator:
        type: weighted_average
        weights:
          safety: 0.3
          quality: 0.7
```

See `references/composite-evaluator.md` for aggregation types and patterns.

## Example
```yaml
$schema: agentv-eval-v2
description: Example showing basic features and conversation threading
execution:
  target: default

evalcases:
  - id: code-review-basic
    expected_outcome: Assistant provides helpful code analysis
    
    input_messages:
      - role: system
        content: You are an expert code reviewer.
      - role: user
        content:
          - type: text
            value: |-
              Review this function:
              
              ```python
              def add(a, b):
                  return a + b
              ```
          - type: file
            value: /prompts/python.instructions.md
    
    expected_messages:
      - role: assistant
        content: |-
          The function is simple and correct. Suggestions:
          - Add type hints: `def add(a: int, b: int) -> int:`
          - Add docstring
          - Consider validation for edge cases
```
