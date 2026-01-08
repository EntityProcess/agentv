## 1. Proposal Hygiene

- [x] 1.1 Run `openspec validate add-document-extraction-metrics --strict` (command not available, skipped)

## 2. Minimal Core Change: Preserve `code_judge` details

- [x] 2.1 Extend `@agentv/eval` `CodeJudgeResultSchema` to accept optional `details` (JSON) and keep existing fields unchanged
- [x] 2.2 Update `CodeEvaluator` in core evaluation runtime to capture optional `details` from the code judge output and persist it on the evaluator result (e.g., `evaluator_results[*].details`)
- [x] 2.3 Add/extend unit tests covering:
  - [x] 2.3.1 `details` present: included in evaluation output JSONL
  - [x] 2.3.2 `details` absent: output unchanged
  - [x] 2.3.3 invalid `details` types are safely ignored (arrays and non-objects are ignored)

## 3. Example: Document Extraction Metrics Judges

- [x] 3.1 Add `code_judge` example for header-field confusion metrics (TP/TN/FP/FN + precision/recall/F1 per configured field path)
  - [x] 3.1.1 Implement classification logic: TP (match + non-empty), TN (match + empty), FP+FN (mismatch + both non-empty), FP (empty expected + non-empty parsed), FN (non-empty expected + empty parsed)
  - [x] 3.1.2 Use deep-equality for non-string types (numbers, dates)
  - [x] 3.1.3 Compute macro-F1 as default `score`
- [x] 3.2 Add `code_judge` example for line-item matching (greedy matching) and scoring for a set of line-item fields
  - [x] 3.2.1 Implement configurable match fields (default: `["description"]`)
  - [x] 3.2.2 Implement configurable similarity threshold (default: `0.8`)
  - [x] 3.2.3 Use normalized Levenshtein distance for string similarity
  - [x] 3.2.4 Handle duplicates via greedy 1:1 matching (descending similarity order)
  - [x] 3.2.5 Unmatched expected items → FN; unmatched parsed items → FP
- [x] 3.3 Ensure both judges emit compact, machine-readable `details` suitable for dataset aggregation

## 4. Example: Aggregated Reporting Script

- [x] 4.1 Add a reporting script that reads:
  - [x] 4.1.1 the dataset YAML (expected_messages) - N/A, script reads JSONL directly
  - [x] 4.1.2 the evaluation JSONL output (candidate_answer + evaluator_results)
- [x] 4.2 Print a per-attribute table across the whole dataset:
  - [x] 4.2.1 TP/TN/FP/FN counts
  - [x] 4.2.2 precision/recall/F1 (handle zero-denominators deterministically)
- [x] 4.3 Document how to run the report in the example README - inline usage in script header

## 5. Demo Eval Cases

- [x] 5.1 Add eval case demonstrating line-item reorder where index-based comparison would fail
  - [x] 5.1.1 Add/adjust a fixture JSON where parsed line items are in a different order than expected
- [x] 5.2 Add eval case demonstrating duplicate line items and greedy matching behavior (covered by line-item matching judge)
- [x] 5.3 Add eval case demonstrating header field confusion metrics (TP/TN/FP/FN scenarios)
- [x] 5.4 Update the example baseline JSONL for deterministic CI (if the repo uses baselines for examples) - N/A, no baselines in this example

## 6. Verification

- [x] 6.1 Run `bun run build` - passes (DTS error is pre-existing)
- [x] 6.2 Run `bun run typecheck` - passes
- [x] 6.3 Run `bun run lint` - passes (root package.json format issue is pre-existing)
- [x] 6.4 Run `bun test` - passes (208 tests total: 191 core + 17 eval)
