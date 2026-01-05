# Batch CLI example (AML screening, CSV → JSONL)

This example demonstrates an **external batch runner** pattern for a (synthetic) AML screening use-case.

## How it works

1. **Ground truth**: `batch-cli-demo.yaml` contains eval cases with `input_messages` (structured object content) and `expected_messages` (e.g., `content.decision`).

2. **CSV conversion**: `batch-cli-runner.ts` imports functions from `build-csv-from-eval.ts` to convert `input_messages` into CSV format. The CSV contains only inputs (customer data, transaction details) - no expected decisions.

3. **Batch processing**: `batch-cli-runner.ts` reads the CSV and applies synthetic AML screening rules, writing **actual responses** as JSONL to a temporary file. Each JSONL record includes `output_messages` with `tool_calls` for trace extraction.

4. **Evaluation**: AgentV compares the actual JSONL output against the ground truth in `batch-cli-demo.yaml` using evaluators like `code_judge` and `tool_trajectory`.

## Tool Trajectory via output_messages

The batch runner outputs JSONL records with `output_messages` containing `tool_calls`:

```json
{
  "id": "aml-001",
  "text": "{...}",
  "output_messages": [
    {
      "role": "assistant",
      "tool_calls": [
        {
          "tool": "aml_screening",
          "input": { "origin_country": "NZ", ... },
          "output": { "decision": "CLEAR", ... }
        }
      ]
    }
  ]
}
```

The `tool_trajectory` evaluator extracts tool calls directly from `output_messages[].tool_calls[]`. This is the primary format - no separate `trace` field is required.

## Files

- `batch-cli-demo.yaml` — Ground truth: eval cases with inputs and expected outputs
- `scripts/build-csv-from-eval.ts` — Utilities to convert YAML eval cases to CSV format (imported by batch-cli-runner.ts)
- `scripts/batch-cli-runner.ts` — Main batch runner: converts inputs to CSV, processes them, writes actual responses as JSONL
- `.agentv/targets.yaml` — Defines the `batch_cli` CLI target with provider batching enabled

## Run

From the repo root:

```bash
cd examples/features/evals/batch-cli

# Run AgentV against the batch CLI target
# NOTE: This requires the CLI provider to support batching + JSONL batch output.
bun agentv eval ./batch-cli-demo.yaml --target batch_cli
```