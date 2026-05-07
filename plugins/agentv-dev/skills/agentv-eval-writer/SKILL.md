---
name: agentv-eval-writer
description: >-
  Write, edit, review, and validate AgentV EVAL.yaml / .eval.yaml evaluation files.
  Use when asked to create new eval files, update or fix existing ones, add or remove test cases,
  configure graders (`llm-grader`, `code-grader`, `rubrics`), review whether an eval is correct or complete,
  convert between EVAL.yaml and evals.json using `agentv convert`, or generate eval test cases
  from chat transcripts (markdown conversation or JSON messages).
  Do NOT use for creating SKILL.md files, writing skill definitions, or running evals —
  running and benchmarking belongs to agentv-bench.
---

The full skill content is bundled with the AgentV CLI and always version-matched to it.
Load it now:

```bash
agentv skills get agentv-eval-writer
```

Then follow the instructions in the loaded skill.
