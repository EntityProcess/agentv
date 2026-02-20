---
name: chat-to-eval
description: Convert chat conversations into AgentV evaluation YAML files. Use this skill when you have a chat transcript (markdown or JSON messages) and want to generate eval test cases from it.
---

# Chat-to-Eval Converter

Convert chat transcripts into AgentV evaluation YAML files by extracting test-worthy exchanges.

## Input Variables

- `transcript`: Chat transcript as markdown conversation or JSON message array
- `eval-path` (optional): Output path for the generated YAML file

## Workflow

### 1. Parse the Transcript

Accept input in either format:

**Markdown conversation:**
```
User: How do I reset my password?
Assistant: Go to Settings > Security > Reset Password...
```

**JSON messages:**
```json
[
  {"role": "user", "content": "How do I reset my password?"},
  {"role": "assistant", "content": "Go to Settings > Security > Reset Password..."}
]
```

Normalize both formats into `{role, content}` message pairs.

### 2. Identify Test-Worthy Exchanges

Extract exchanges that are good eval candidates. Prioritize:

- **Factual Q&A** — User asks a question, agent gives a verifiable answer
- **Task completion** — User requests an action, agent performs it
- **Multi-turn reasoning** — Exchanges where context from earlier turns matters
- **Edge cases** — Unusual inputs, error handling, boundary conditions
- **Domain expertise** — Responses requiring specialized knowledge

Skip:
- Greetings and small talk (unless testing social behavior)
- Acknowledgments without substance ("OK", "Got it")
- Repeated or redundant exchanges

### 3. Derive Criteria and Rubrics

For each selected exchange, infer evaluation criteria from the conversation context:

- What the user implicitly expected
- Quality signals in the assistant's response (accuracy, completeness, tone)
- Any corrections or follow-ups that reveal what "good" looks like

Generate rubrics that capture these quality dimensions.

### 4. Generate EVAL YAML

Produce a valid AgentV eval file using **`tests:`** (not `cases:`).

**Structure:**

```yaml
description: "<Summarize what this eval covers>"

tests:
  - id: <kebab-case-id>
    criteria: "<What the response should accomplish>"
    input: "<User message>"
    expected_output: "<Assistant response from transcript>"
    rubrics:
      - <Quality criterion 1>
      - <Quality criterion 2>
```

**Rules:**
- Use `tests:` as the top-level array key — never `cases:`
- Generate kebab-case `id` values derived from the exchange topic
- Write `criteria` as a concise statement of what a good response achieves
- Use `input` for single user messages; use `input` for multi-turn
- Set `expected_output` to the actual assistant response from the transcript
- Include 2–4 rubrics per test capturing distinct quality dimensions

### 5. Suggest Evaluators

Append a commented evaluator configuration based on the test content:

```yaml
# Suggested evaluators:
# execution:
#   evaluators:
#     - name: quality
#       type: llm_judge
#       prompt: ./prompts/quality.md
#     - name: accuracy
#       type: code_judge
#       script: ./scripts/check_accuracy.py
```

- Recommend `llm_judge` for subjective quality (tone, helpfulness, completeness)
- Recommend `code_judge` for deterministic checks (format, required fields, exact values)
- Recommend `field_accuracy` when expected output has structured fields

### 6. Write Output

- If `eval-path` is provided, write the YAML to that path
- Otherwise, output the YAML to the conversation for the user to copy

## Multi-Turn Conversations

For conversations with context dependencies across turns, use `input`:

```yaml
tests:
  - id: multi-turn-context
    criteria: "Agent remembers prior context"
    input:
      - role: user
        content: "My name is Alice"
      - role: assistant
        content: "Nice to meet you, Alice!"
      - role: user
        content: "What's my name?"
    expected_output: "Your name is Alice."
    rubrics:
      - Correctly recalls the user's name from earlier in the conversation
      - Response is natural and conversational
```

## Guidelines

- **Preserve original wording** in `expected_output` — use the actual transcript text
- **Be selective** — not every exchange makes a good test; aim for 5–15 tests per transcript
- **Diverse coverage** — pick exchanges that test different capabilities
- **Actionable rubrics** — each rubric should be independently evaluable (pass/fail)
- **Validate output** — the generated YAML must pass `agentv validate <file>`
