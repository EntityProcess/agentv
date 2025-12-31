---
"agentv": minor
---

Add compare command for evaluation result comparison

- New `agentv compare` command to compute differences between two JSONL result files
- Match results by eval_id and compute score deltas
- Classify outcomes as win/loss/tie based on configurable threshold
- Exit code indicates comparison result for CI integration
