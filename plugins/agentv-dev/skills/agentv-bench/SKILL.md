---
name: agentv-bench
description: >-
  Run AgentV evaluations and optimize agents through eval-driven iteration.
  Triggers: run evals, benchmark agents, optimize prompts/skills against evals, compare
  agent outputs across providers, analyze eval results, offline evaluation of recorded sessions,
  run autoresearch, optimize unattended, run overnight optimization loop.
  Not for: writing/editing eval YAML without running (use agentv-eval-writer),
  analyzing existing traces/JSONL without re-running (use agentv-trace-analyst).
---

The full skill content is bundled with the AgentV CLI and always version-matched to it.
Load it now:

```bash
agentv skills get agentv-bench
```

Then follow the instructions in the loaded skill.
