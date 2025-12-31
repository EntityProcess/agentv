---
"@agentv/core": minor
"agentv": minor
---

Add Pi Coding Agent provider and default system prompts for agent evaluations

- New `pi-coding-agent` provider for the Pi Coding Agent CLI from pi-mono
- Support file attachments using Pi's native `@path` syntax
- Extract tool trajectory/traces from Pi's JSONL output
- Display log file paths in console during eval runs
- Add `log_format` option ('summary' or 'json') for log verbosity
- Add default system prompt for Pi and Codex providers instructing agents to include code in response using git diff format
- Add `system_prompt` config option to override default behavior via targets.yaml
