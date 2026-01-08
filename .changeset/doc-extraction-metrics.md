---
"@agentv/core": patch
"@agentv/eval": patch
---

Add document extraction metrics support with details passthrough

- Added optional `details` field to code judge output for structured metrics (TP/TN/FP/FN counts, alignments)
- Core evaluation now captures and persists `details` from code judges to JSONL output
- Added example judges for header field confusion metrics and line item matching with greedy alignment
- Macro-F1 calculation treats undefined F1 as 0 when errors occurred (sklearn best practice)
