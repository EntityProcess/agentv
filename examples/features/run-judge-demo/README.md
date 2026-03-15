# Run-Judge Demo

Demonstrates code judges that can be run both as part of an eval suite and individually via `agentv eval run-judge`.

## Judges

| File | Purpose |
|------|---------|
| `.agentv/judges/keyword-check.ts` | Checks answer contains expected keywords (Paris, France) |
| `.agentv/judges/length-check.ts` | Validates answer word count is between 5 and 50 |

Both judges use `defineCodeJudge` from `@agentv/eval`.

## Running the Full Eval

```bash
# From the repository root
bun agentv eval examples/features/run-judge-demo/evals/dataset.eval.yaml
```

## Running Judges Individually

Run a single judge without executing the full eval suite:

```bash
cd examples/features/run-judge-demo

# Run keyword-check with inline args
bun agentv eval run-judge keyword-check \
  --agent-output "The capital of France is Paris." \
  --agent-input "What is the capital of France?"

# Run length-check
bun agentv eval run-judge length-check \
  --agent-output "The capital of France is Paris." \
  --agent-input "What is the capital of France?"

# Run from a JSON file
echo '{"output": "The capital of France is Paris.", "input": "What is the capital?"}' > result.json
bun agentv eval run-judge keyword-check --file result.json
```

Exit code is 0 if score >= 0.5 (pass), 1 otherwise (fail).

## Inspecting Grading Criteria

```bash
bun agentv eval prompt eval --grading-brief \
  examples/features/run-judge-demo/evals/dataset.eval.yaml \
  --test-id capital-of-france
```

Output:
```
Input: "What is the capital of France? Answer in one concise sentence."
Expected: "The capital of France is Paris."
Criteria:
  - Output contains 'Paris'
  - [code-judge] keyword-check: Checks that the answer mentions Paris and France
  - [code-judge] length-check: Ensures answer is between 5 and 50 words
```

## How It Works

When running the eval, the transpiler emits natural-language instructions for each code judge:

```
Run `agentv eval run-judge keyword-check --agent-output <text> --agent-input <text>` and check the result.
This judge: Checks that the answer mentions Paris and France.
The command returns JSON: {"score": 0-1, "reasoning": "..."}.
A score >= 0.5 means pass (exit 0); below 0.5 means fail (exit 1).
```

This allows external grading agents to execute code judges directly without understanding their internal implementation.
