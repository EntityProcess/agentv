# Eval Assert Demo

Demonstrates code graders that can be run both as part of an eval suite and individually via `agentv eval assert`.

## Graders

| File | Purpose |
|------|---------|
| `.agentv/graders/keyword-check.ts` | Checks answer contains expected keywords (Paris, France) |
| `.agentv/graders/length-check.ts` | Validates answer word count is between 5 and 50 |

Both graders use `defineCodeGrader` from `@agentv/eval`.

## Running the Full Eval

```bash
# From the repository root
bun agentv eval examples/features/eval-assert-demo/evals/dataset.eval.yaml
```

## Running Assertions Individually

Run a single assertion without executing the full eval suite:

```bash
cd examples/features/eval-assert-demo

# Run keyword-check with inline args
bun agentv eval assert keyword-check \
  --agent-output "The capital of France is Paris." \
  --agent-input "What is the capital of France?"

# Run length-check
bun agentv eval assert length-check \
  --agent-output "The capital of France is Paris." \
  --agent-input "What is the capital of France?"

# Run from a JSON file
echo '{"output": "The capital of France is Paris.", "input": "What is the capital?"}' > result.json
bun agentv eval assert keyword-check --file result.json
```

Exit code is 0 if score >= 0.5 (pass), 1 otherwise (fail).

## Inspecting Grading Criteria

```bash
bun agentv eval prompt eval --grading-brief \
  examples/features/eval-assert-demo/evals/dataset.eval.yaml \
  --test-id capital-of-france
```

Output:
```
Input: "What is the capital of France? Answer in one concise sentence."
Expected: "The capital of France is Paris."
Criteria:
  - Output contains 'Paris'
  - [code-grader] keyword-check: Checks that the answer mentions Paris and France
  - [code-grader] length-check: Ensures answer is between 5 and 50 words
```

## How It Works

When running the eval, the transpiler emits natural-language instructions for each code grader:

```
Run `agentv eval assert keyword-check --agent-output <text> --agent-input <text>` and check the result.
This grader: Checks that the answer mentions Paris and France.
The command returns JSON: {"score": 0-1, "reasoning": "..."}.
A score >= 0.5 means pass (exit 0); below 0.5 means fail (exit 1).
```

This allows external grading agents to execute code graders directly without understanding their internal implementation.
