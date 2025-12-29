# Batch CLI example (AML screening, CSV → JSONL)

This example demonstrates an **external batch runner** pattern for a (synthetic) AML screening use-case:

1. AgentV eval cases use `input_messages` with **structured (object) content** containing multiple fields.
2. Expected outputs live in `expected_messages` (schema-aligned), e.g. `content.decision`.
3. A helper script converts those `input_messages` into a CSV file (`AmlScreeningInput.csv`).
4. A batch CLI tool reads the CSV once and writes a JSONL file containing one record per eval case.
5. The batch runner outputs `output_messages` with `tool_calls` in the JSONL, enabling `tool_trajectory` evaluation directly from the message format.

Important: the CSV intentionally does **not** include the expected decision to avoid leaking answers to the provider.

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

- `batch-cli-demo.yaml` — Eval cases with multi-field `input_messages`
- `scripts/build-csv-from-eval.ts` — Converts eval YAML → `AmlScreeningInput.csv`
- `scripts/batch-cli-runner.ts` — Reads CSV → writes JSONL (also copies to `agentv-evalresult.jsonl`)
- `.agentv/targets.yaml` — Defines the `batch_cli` CLI target with provider batching enabled

## Run

From the repo root:

```bash
cd examples/features/evals/batch-cli

# Run AgentV against the batch CLI target
# NOTE: This requires the CLI provider to support batching + JSONL batch output.
bun agentv eval ./batch-cli-demo.yaml --target batch_cli
```

Optional (manual CSV build):

```bash
bun run ./scripts/build-csv-from-eval.ts --eval ./batch-cli-demo.yaml --out ./AmlScreeningInput.csv
```

After running:
- The batch runner will write a copy of the produced records to `agentv-evalresult.jsonl` in this directory.
