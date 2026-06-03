# @agentv/phoenix-adapter

Converts AgentV eval YAML suites into Phoenix datasets and can run Phoenix experiments while keeping AgentV eval files as the source of truth.

This package is repo-local and private while Phoenix experiment parity is still being completed. For observing real AgentV eval runs in Phoenix, use the core OTel preset instead:

```bash
agentv eval evals/my-eval.yaml --export-otel --otel-backend phoenix
```

Current adapter support is intentionally small: deterministic `contains`, `regex`, `equals`, and `is-json` assertions run through a Phoenix CODE evaluator. LLM, code, trace, composite, metric, and custom evaluator families are reported as unsupported instead of being silently mapped.

```bash
bun --filter @agentv/phoenix-adapter phoenix:assert-smoke
bun --filter @agentv/phoenix-adapter phoenix:dry-run
```

See `docs/support-matrix.md` for evaluator coverage and `docs/e2e-verification.md` for smoke-test notes.
