# @agentv/phoenix-adapter

Internal Phoenix boundary fixtures for AgentV. This package is not the supported
product path for completed AgentV run artifacts.

After the 2026-06-20 product decision, AgentV does not export or project
completed runs, traces, transcripts, datasets, experiments, or indexes into
Phoenix. AgentV-owned local/Git-backed artifacts and Dashboard remain the
zero-infra inspection path. Phoenix is optional read-only correlation for
external traces that were emitted independently and are referenced through safe
`external_trace` metadata.

The deterministic YAML-to-Phoenix dataset code in this package is retained as an
internal legacy fixture only. Do not promote it as a public integration path, and
do not make Dashboard or the zero-infra local path depend on it.

The package also exports `phoenixOtelBackend`, a backend resolver for AgentV's
local `.agentv/otel-backends/phoenix.mjs` hook. It resolves Phoenix collector
endpoint, auth headers, and `PHOENIX_PROJECT_NAME` resource routing outside
`@agentv/core`. This remains outside core and must not be required by Dashboard.

```bash
bun --filter @agentv/phoenix-adapter phoenix:assert-smoke
bun --filter @agentv/phoenix-adapter phoenix:dry-run
```

See `docs/support-matrix.md` for evaluator coverage and `docs/e2e-verification.md` for smoke-test notes.
