---
name: agentv-governance
description: >-
  Author, edit, and lint `governance:` blocks in `*.eval.yaml` files.
  Use when creating or updating evaluation suites that carry AI-governance metadata
  (OWASP LLM Top 10, OWASP Agentic Top 10, MITRE ATLAS, EU AI Act, ISO 42001).
  Also use non-interactively (e.g., from a GitHub Action) to lint changed eval files
  and report violations against the rules in `references/lint-rules.md`.
  Do NOT use for running evals or benchmarking — that belongs to agentv-bench.
---

The full skill content is bundled with the AgentV CLI and always version-matched to it.
Load it now:

```bash
agentv skills get agentv-governance
```

Then follow the instructions in the loaded skill.
