---
"@agentv/core": minor
---

Add Claude Code CLI provider for agent evaluations

- New `claude-code` provider type for running evaluations with Claude Code CLI
- Supports model, system prompt, cwd, timeout, and custom args configuration
- Parses JSONL streaming output with tool calls and usage metrics
- Stream logging to `.agentv/logs/claude-code/` directory
- Detects nested Claude Code sessions with helpful error message
