# chat-to-eval

An AgentV skill that converts chat conversations into evaluation YAML files.

## What It Does

This skill takes a chat transcript — either as markdown conversation or JSON messages — and generates an AgentV-compatible eval file with test cases derived from the exchanges.

The LLM analyzes the conversation to:
1. Identify test-worthy exchanges (factual Q&A, task completion, edge cases)
2. Derive evaluation criteria from context
3. Generate valid YAML with `tests:`, rubrics, and suggested evaluators

## Usage

Provide a chat transcript and ask the agent to convert it:

```
Convert this conversation into an AgentV eval file:

User: What's the capital of France?
Assistant: The capital of France is Paris.

User: How do I reverse a list in Python?
Assistant: Use the `reverse()` method or slicing: `my_list[::-1]`
```

Or provide a JSON message array:

```json
[
  {"role": "user", "content": "What's the capital of France?"},
  {"role": "assistant", "content": "The capital of France is Paris."}
]
```

## Example Output

```yaml
description: "General knowledge and coding Q&A"

tests:
  - id: capital-of-france
    criteria: "Correctly identify the capital of France"
    input: "What's the capital of France?"
    expected_output: "The capital of France is Paris."
    rubrics:
      - States Paris as the capital
      - Response is concise and direct

  - id: python-reverse-list
    criteria: "Explain how to reverse a list in Python"
    input: "How do I reverse a list in Python?"
    expected_output: "Use the `reverse()` method or slicing: `my_list[::-1]`"
    rubrics:
      - Provides at least one valid method to reverse a list
      - Code syntax is correct
      - Explanation is clear and actionable

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

## When to Use

- You have a real conversation that demonstrates desired agent behavior
- You want to create regression tests from production interactions
- You're bootstrapping an eval suite from existing chat logs
- You need to convert Q&A pairs into structured test cases

## Related Skills

- **agentv-eval-builder** — Create eval files from scratch with full schema reference
- **agentv-eval-orchestrator** — Run evaluations without API keys
