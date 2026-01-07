## 1. Proposal Hygiene

- [ ] 1.1 Run `openspec validate add-document-extraction-metrics --strict`

## 2. Minimal Core Change: Preserve `code_judge` details

- [ ] 2.1 Extend `@agentv/eval` `CodeJudgeResultSchema` to accept optional `details` (JSON) and keep existing fields unchanged
- [ ] 2.2 Update `CodeEvaluator` in core evaluation runtime to capture optional `details` from the code judge output and persist it on the evaluator result (e.g., `evaluator_results[*].details`)
- [ ] 2.3 Add/extend unit tests covering:
  - [ ] 2.3.1 `details` present: included in evaluation output JSONL
  - [ ] 2.3.2 `details` absent: output unchanged
  - [ ] 2.3.3 invalid `details` types are safely ignored or surfaced as evaluator failure (choose one behavior; document it)

## 3. Example: Document Extraction Metrics Judges

- [ ] 3.1 Add `code_judge` example for header-field confusion metrics (TP/TN/FP/FN + precision/recall/F1 per configured field path)
  - [ ] 3.1.1 Implement classification logic: TP (match + non-empty), TN (match + empty), FP+FN (mismatch + both non-empty), FP (empty expected + non-empty parsed), FN (non-empty expected + empty parsed)
  - [ ] 3.1.2 Use deep-equality for non-string types (numbers, dates)
  - [ ] 3.1.3 Compute macro-F1 as default `score`
- [ ] 3.2 Add `code_judge` example for line-item matching (greedy matching) and scoring for a set of line-item fields
  - [ ] 3.2.1 Implement configurable match fields (default: `["description"]`)
  - [ ] 3.2.2 Implement configurable similarity threshold (default: `0.8`)
  - [ ] 3.2.3 Use normalized Levenshtein distance for string similarity
  - [ ] 3.2.4 Handle duplicates via greedy 1:1 matching (descending similarity order)
  - [ ] 3.2.5 Unmatched expected items → FN; unmatched parsed items → FP
- [ ] 3.3 Ensure both judges emit compact, machine-readable `details` suitable for dataset aggregation

## 4. Example: Aggregated Reporting Script

- [ ] 4.1 Add a reporting script that reads:
  - [ ] 4.1.1 the dataset YAML (expected_messages)
  - [ ] 4.1.2 the evaluation JSONL output (candidate_answer + evaluator_results)
- [ ] 4.2 Print a per-attribute table across the whole dataset:
  - [ ] 4.2.1 TP/TN/FP/FN counts
  - [ ] 4.2.2 precision/recall/F1 (handle zero-denominators deterministically)
- [ ] 4.3 Document how to run the report in the example README

## 5. Demo Eval Cases

- [ ] 5.1 Add eval case demonstrating line-item reorder where index-based comparison would fail
  - [ ] 5.1.1 Add/adjust a fixture JSON where parsed line items are in a different order than expected
- [ ] 5.2 Add eval case demonstrating duplicate line items and greedy matching behavior
- [ ] 5.3 Add eval case demonstrating header field confusion metrics (TP/TN/FP/FN scenarios)
- [ ] 5.4 Update the example baseline JSONL for deterministic CI (if the repo uses baselines for examples)

## 6. Verification

- [ ] 6.1 Run `bun run build`
- [ ] 6.2 Run `bun run typecheck`
- [ ] 6.3 Run `bun run lint`
- [ ] 6.4 Run `bun test`
