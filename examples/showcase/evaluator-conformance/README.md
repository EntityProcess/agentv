# Evaluator Conformance Harness

A showcase demonstrating how to verify that an evaluator is **compatible** (produces valid output) and **consistent** (produces stable scores across repeated runs).

## Problem

LLM-based and heuristic evaluators can be non-deterministic. Before trusting an evaluator in CI, you need to know:

1. **Compatibility** — Does the evaluator always return valid `{ score, hits, misses }` output?
2. **Consistency** — Does it produce stable verdicts on unambiguous inputs?

## How It Works

The harness runs an evaluator N times against a labeled fixture dataset:

| Label | Expectation |
|-----------|---------------------------------------------|
| `pass` | Must always score exactly `1.0` |
| `fail` | Must always score exactly `0.0` |
| `ambiguous`| Score may vary but must stay within `score_bounds` |

It then computes per-fixture metrics:

- **Flip rate** — fraction of runs where the verdict (pass/borderline/fail) differs from the first run
- **Mean / Variance** — statistical summary of scores across runs
- **Bound violations** — scores outside the expected range for ambiguous fixtures

## Quick Start

```bash
cd examples/showcase/evaluator-conformance
bun install
bun run conformance-check.ts
```

## CLI Flags

| Flag | Default | Description |
|---------------------|-----------------|----------------------------------------------|
| `--fixture <path>` | `fixtures.yaml` | Path to fixture dataset |
| `--runs <N>` | `5` | Number of runs per fixture |
| `--max-flip-rate <X>`| `0` | Max allowed flip-rate for unambiguous cases |
| `--output <path>` | — | Write structured JSON results to file |

## Example Output

```
  Evaluator Conformance Harness
  evaluator:  bun run evaluators/keyword-judge.ts
  fixtures:   9
  runs/each:  5
  max-flip:   0

  ✓  [PASS     ] clear-pass-exact-match       mean=1.00  var=0.0000  flip=0.00
  ✓  [PASS     ] clear-pass-contains-answer    mean=1.00  var=0.0000  flip=0.00
  ✓  [PASS     ] clear-pass-multi-keyword      mean=1.00  var=0.0000  flip=0.00
  ✓  [FAIL     ] clear-fail-wrong-answer       mean=0.00  var=0.0000  flip=0.00
  ✓  [FAIL     ] clear-fail-irrelevant         mean=0.00  var=0.0000  flip=0.00
  ✓  [FAIL     ] clear-fail-empty              mean=0.00  var=0.0000  flip=0.00
  ✓  [AMBIGUOUS] ambiguous-partial-overlap      mean=0.33  var=0.0000  flip=0.00
  ✓  [AMBIGUOUS] ambiguous-verbose-correct      mean=1.00  var=0.0000  flip=0.00
  ✓  [AMBIGUOUS] ambiguous-near-miss            mean=0.00  var=0.0000  flip=0.00

  ── Summary ──
  Compatible:  ✓
  Consistent:  ✓
  Passed:      9/9
  Failed:      0/9
```

## CI Integration

Use the exit code for gating:

```bash
bun run conformance-check.ts --runs 10 --max-flip-rate 0 --output results.json
```

Exit code `0` = all fixtures pass. Exit code `1` = at least one failure.

The `--output` flag writes a structured JSON report for programmatic consumption:

```json
{
  "evaluator": ["bun", "run", "evaluators/keyword-judge.ts"],
  "total_fixtures": 9,
  "total_runs": 45,
  "compatible": true,
  "consistent": true,
  "fixtures": [
    {
      "id": "clear-pass-exact-match",
      "label": "pass",
      "runs": 5,
      "scores": [1, 1, 1, 1, 1],
      "mean": 1,
      "variance": 0,
      "flip_rate": 0,
      "compatible": true,
      "consistent": true,
      "errors": []
    }
  ]
}
```

## Adapting for Your Evaluator

1. Replace `evaluators/keyword-judge.ts` with your evaluator script
2. Update `fixtures.yaml` with domain-specific test cases
3. Set `score_bounds` on ambiguous fixtures based on acceptable variance
4. Adjust `--max-flip-rate` for LLM-based evaluators (e.g., `0.1` allows 10% flip rate)

## Files

| File | Purpose |
|--------------------------------|-----------------------------------------------|
| `conformance-check.ts` | Harness script — runs evaluator, validates |
| `fixtures.yaml` | Labeled fixture dataset |
| `evaluators/keyword-judge.ts` | Sample deterministic evaluator under test |
| `EVAL.yaml` | Standard AgentV eval using the same evaluator |
| `package.json` | Dependencies |
