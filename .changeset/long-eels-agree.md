---
"@agentv/core": minor
---

Add per-evaluator weights for top-level aggregation

- Evaluators now support an optional `weight` field to control their influence on the final aggregate score. This enables expressing relative importance (e.g., safety > style) without requiring a composite evaluator.