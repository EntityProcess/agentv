---
"agentv": minor
---

Add human-readable table output to compare command

- Table format with colored deltas (green=win, red=loss, gray=tie) is now the default output
- Add `--format` option to choose between `table` (default) and `json`
- Add `--json` flag as shorthand for machine-readable output
- JSON output now uses snake_case for Python ecosystem compatibility
- Respects `NO_COLOR` env var and non-TTY detection
