# @agentv/phoenix-adapter

Converts AgentV eval YAML suites into Phoenix datasets and can run Phoenix experiments while keeping AgentV eval files as the source of truth.

Current adapter support is intentionally small: deterministic `contains`, `regex`, `equals`, and `is-json` assertions run through a Phoenix CODE evaluator. LLM, code, trace, composite, metric, and custom evaluator families are reported as unsupported instead of being silently mapped.

```bash
bun --filter @agentv/phoenix-adapter phoenix:assert-smoke
bun --filter @agentv/phoenix-adapter phoenix:dry-run
```

See `docs/support-matrix.md` for evaluator coverage and `docs/e2e-verification.md` for smoke-test notes.
