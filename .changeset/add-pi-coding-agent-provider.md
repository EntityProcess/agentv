---
"@agentv/core": minor
"agentv": minor
---

Add Pi Coding Agent provider for autonomous coding evaluations

- New `pi-coding-agent` provider for the Pi Coding Agent CLI from pi-mono
- Support file attachments using Pi's native `@path` syntax
- Extract tool trajectory/traces from Pi's JSONL output
- Display log file paths in console during eval runs
- Add `log_format` option ('summary' or 'json') for log verbosity
