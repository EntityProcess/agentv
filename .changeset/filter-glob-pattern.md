---
"@agentv/core": minor
"agentv": minor
---

Rename `--eval-id` to `--filter` with glob pattern support

- `--filter` accepts glob patterns (e.g., `--filter "summary-*"`) to match multiple eval cases
- Exact matches still work (e.g., `--filter "my-eval-case"`)
- Uses micromatch for pattern matching
