---
"@agentv/core": minor
"@agentv/eval": minor
"agentv": minor
---

Add target proxy visibility and control for code judges:

- Added `GET /info` endpoint to target proxy returning target name, max calls, call count, and available targets
- Added optional `target` parameter to invoke requests for per-call target override
- Added `getInfo()` method to `TargetClient` in `@agentv/eval` SDK
- Added `TargetInfo` type export from `@agentv/eval`

This enables code judges to query proxy configuration and use different targets for different purposes (e.g., cheap model for simple checks, expensive model for nuanced evaluation).
