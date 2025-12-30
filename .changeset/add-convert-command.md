---
"agentv": minor
---

Add `agentv convert` command for JSONL to YAML conversion

Converts evaluation results from JSONL format to YAML, matching the output format of `--output-yaml`.

Usage:
```bash
agentv convert results.jsonl              # outputs results.yaml
agentv convert results.jsonl -o out.yaml  # explicit output path
```
