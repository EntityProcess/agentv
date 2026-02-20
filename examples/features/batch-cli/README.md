# Batch CLI example (AML screening, CSV → JSONL)

This example demonstrates an **external batch runner** pattern for a (synthetic) AML screening use-case.

## How it works

1. **Ground truth**: `evals/dataset.yaml` contains tests with `input` (structured object content) and `expected_output` (e.g., `content.decision`).

2. **CSV conversion**: `batch-cli-runner.ts` imports functions from `build-csv-from-eval.ts` to convert `input` into CSV format. The CSV contains only inputs (customer data, transaction details) - no expected decisions.

3. **Batch processing**: `batch-cli-runner.ts` reads the CSV and applies synthetic AML screening rules, writing **actual responses** as JSONL to a temporary file. Each JSONL record includes `output_messages` with `tool_calls` for trace extraction.

4. **Evaluation**: AgentV compares the actual JSONL output against the ground truth in `evals/dataset.yaml` using evaluators like `code_judge` and `tool_trajectory`.

## Batch error handling (missing JSONL id)

This example intentionally includes a test (`aml-004-not-exist`) that is **not written into the CSV input** by `scripts/build-csv-from-eval.ts`.

That means the batch runner never emits a JSONL record for that `test_id`, and the CLI provider surfaces a provider-side error:

- `error: "Batch output missing id 'aml-004-not-exist'"`

AgentV then reports that test as failed (with `error` populated), while still evaluating the other items in the batch.

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

- `batch-cli-demo.yaml` — Ground truth: tests with inputs and expected outputs
- `scripts/build-csv-from-eval.ts` — Utilities to convert YAML tests to CSV format (imported by batch-cli-runner.ts)
- `scripts/batch-cli-runner.ts` — Main batch runner: converts inputs to CSV, processes them, writes actual responses as JSONL
- `.agentv/targets.yaml` — Defines the `batch_cli` CLI target with provider batching enabled

## Run

From the repo root:

```bash
cd examples/features/batch-cli

# Run AgentV against the batch CLI target
# NOTE: This requires the CLI provider to support batching + JSONL batch output.
bun agentv run ./evals/dataset.yaml --target batch_cli
```