---
name: agentv-eval-builder
description: Create and maintain AgentV YAML evaluation files for testing AI agent performance. Use this skill when creating new eval files, adding eval cases, or configuring custom evaluators (code validators or LLM judges) for agent testing workflows.
---

# AgentV Eval Builder

## Schema Reference
- Schema: `references/eval-schema.json` (JSON Schema for validation and tooling)
- Format: YAML with structured content arrays
- Examples: `references/example-evals.md`

## Structure Requirements
- Root level: `description` (optional), `execution` (optional), `evalcases` (required)
- Eval case fields: `id` (required), `expected_outcome` (required), `input_messages` (required), `expected_messages` (required)
- Optional fields: `conversation_id`, `note`, `execution`
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
      type: code
      script: uv run validate_output.py
      cwd: ../../evaluators/scripts
```

**Contract:**
- Input (stdin): JSON with `question`, `expected_outcome`, `reference_answer`, `candidate_answer`, `guideline_paths`, `input_files`, `input_messages`
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

### Evaluator Chaining
Evaluators run sequentially:

```yaml
execution:
  evaluators:
    - name: format_check      # Runs first
      type: code
      script: uv run validate_json.py
    - name: content_check     # Runs second
      type: llm_judge
```

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
