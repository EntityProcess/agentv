---
"@agentv/core": minor
"agentv": minor
---

Add `field_accuracy`, `latency`, and `cost` evaluators

- `field_accuracy`: Compare structured data fields with exact, numeric_tolerance, or date matching
- `latency`: Check execution duration against threshold (uses traceSummary.durationMs)
- `cost`: Check execution cost against budget (uses traceSummary.costUsd)

See `examples/features/document-extraction/README.md` for usage examples.
