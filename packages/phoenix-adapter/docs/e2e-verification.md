# E2E Verification

## Dry-Run Conversion

Dry-run mode discovers AgentV example evals, normalizes cases through `@agentv/core`, creates Phoenix dataset payloads in memory, and compares test IDs against AgentV baselines where present.

```bash
bun run phoenix:assert-smoke
bun run phoenix:dry-run
```

Current filtered smoke result against `examples/features/assert/evals/dataset.eval.yaml`:

- 1 suite discovered
- 4 tests normalized
- 1 suite passed structural parity
- 0 failed suites

Current full dry-run result against this AgentV checkout:

- 97 suites discovered
- 405 tests normalized
- 93 suites passed structural parity
- 4 suites failed baseline/loader parity

The failing suites are currently source/baseline or source-reference mismatches, not Phoenix conversion crashes:

- `examples/features/matrix-evaluation/evals/dataset.eval.yaml`: baseline has 5 rows, source has 3 tests.
- `examples/features/prompt-template-sdk/evals/dataset.eval.yaml`: AgentV core skips 2 tests because `../prompts/custom-grader.ts` cannot be resolved from the eval source.
- `examples/features/tool-trajectory-simple/evals/dataset.eval.yaml`: source has 11 tests, baseline has 7 rows.
- `examples/features/weighted-graders/evals/dataset.eval.yaml`: baseline IDs use `evaluator` naming while source IDs use `grader` naming.

## Live Phoenix Smoke

Live mode creates or updates a Phoenix dataset and records a Phoenix experiment. It currently uses the deterministic adapter path, so the best smoke target is `examples/features/assert/evals/dataset.eval.yaml`.

```bash
(cd packages/phoenix-adapter && bun src/cli.ts run \
  --agentv-root ../.. \
  --filter examples/features/assert/evals/dataset.eval.yaml \
  --out reports/live-assert-final.json \
  --namespace agentv-phoenix-e2e-final)
```

The source harness was verified locally against Phoenix at `http://localhost:6006`:

- 4 Phoenix task runs
- 4 Phoenix evaluator runs
- average evaluator score: 1.0
- experiment ID: `RXhwZXJpbWVudDo2`
