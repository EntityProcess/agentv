# Change: Add document extraction metrics + line-item matching (example + minimal core passthrough)

## Why

The current `document-extraction` example can score field-level correctness, but it does not support:

- Aggregated per-attribute metrics across the dataset (precision/recall/F1 per attribute)
- Confusion-style scoring for header fields that distinguishes empty vs non-empty (TP/TN/FP/FN)
- Robust line-item evaluation that matches expected line items to parsed line items before scoring (instead of index/order-based comparison)

These capabilities are required to produce actionable evaluation reports similar to the existing internal summary format (per-attribute tables across the dataset) and to avoid misleading scores when line items are reordered.

## What Changes

- **ADDED (core, minimal)**: Preserve structured `details` emitted by `code_judge` scripts in `evaluator_results` and JSONL output (backward compatible).
- **ADDED (examples)**: New `code_judge` evaluators for document extraction:
  - Header attribute confusion metrics (TP/TN/FP/FN + derived precision/recall/F1)
  - Line-item matching + evaluation (match then score)
- **ADDED (examples)**: A small reporting script that reads AgentV JSONL output + dataset YAML to print aggregated per-attribute tables.
- **ADDED (examples)**: One new eval case in `examples/features/document-extraction/evals/dataset.yaml` demonstrating line-item reorder where matching-based evaluation is necessary.

## Non-Goals

- No new built-in evaluator kind (everything domain-specific remains a `code_judge` example).
- No new first-class `agentv report` CLI command (reporting is shipped as an example script initially).
- No attempt to implement optimal assignment (Hungarian) initially; start with deterministic greedy matching.

## Impact

- **Affected specs**: `evaluation` (extend code judge output contract passthrough)
- **Affected code (expected)**:
  - `packages/eval/` (extend `CodeJudgeResultSchema` to allow optional `details`)
  - `packages/core/src/evaluation/evaluators.ts` (capture/persist optional `details` from code judges)
  - `apps/cli/` JSONL output shape (implicit: extra fields appear in `evaluator_results[*].details`)
  - `examples/features/document-extraction/` (new judges + report script + dataset case)

## Risks

- Output size growth if `details` is large; examples will keep `details` bounded and focused (counts + small alignment summaries).
- Consumers that assume a fixed evaluator_results schema may need to ignore unknown fields (JSON is forward compatible; AgentV already emits additional metadata fields).
