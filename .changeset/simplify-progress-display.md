---
"agentv": patch
"@agentv/core": patch
---

Simplify eval progress display and reduce verbose output

- Replace ANSI cursor-based interactive display with simple line-based output
- Show running/completed/failed status by default, pending only with --verbose
- CLI provider verbose logs now require --verbose flag
- Remove CLI_EVALS_DIR from verbose logs

