---
name: agentv-trace-analyst
description: >-
  Analyze AgentV evaluation traces and result JSONL files using `agentv inspect` and `agentv compare` CLI commands.
  Use when asked to inspect AgentV eval results, find regressions between AgentV evaluation runs,
  identify failure patterns in AgentV trace data, analyze tool trajectories, or compute cost/latency/score statistics
  from AgentV result files.
  Do NOT use for benchmarking skill trigger accuracy, analyzing skill-creator eval performance,
  or measuring skill description quality — those tasks belong to the skill-creator skill.
---

The full skill content is bundled with the AgentV CLI and always version-matched to it.
Load it now:

```bash
agentv skills get agentv-trace-analyst
```

Then follow the instructions in the loaded skill.
