# Multi-Model Benchmark Showcase

Demonstrates a complete **multi-model × multi-metric × variability** evaluation workflow end-to-end. Run the same tests against multiple LLMs, score them on weighted metrics, measure variability with experiment repeat runs, and compare results.

## What This Shows

| Feature | How it's used |
|---------|---------------|
| **Targets matrix** | Every test runs against `copilot`, `claude`, and `gemini-llm` |
| **Weighted graders** | Accuracy (3×), completeness (2×), clarity (1×) |
| **Repeat runs** | 2 attempts per test to surface non-determinism |
| **Compare workflow** | Side-by-side model comparison from result files |

## Files

```
multi-model-benchmark/
├── README.md                        # This file
├── evals/
│   └── benchmark.eval.yaml          # Eval definition, targets, repeat policy, and metrics
└── prompts/
    ├── accuracy-rubric.md           # Factual correctness grader (weight 3.0)
    ├── completeness-rubric.md       # Coverage grader (weight 2.0)
    └── clarity-rubric.md            # Readability grader (weight 1.0)
```

## Prerequisites

1. Configure targets in `.agentv/targets.yaml` at the repository root. The eval references `copilot`, `claude`, and `gemini-llm` — these must be defined with valid provider credentials.
2. Install dependencies: `bun install`

## Running the Evaluation

From the repository root:

```bash
# Run the full matrix (all targets × all tests × 2 repeat attempts)
bun agentv eval examples/showcase/multi-model-benchmark/evals/benchmark.eval.yaml
```

### Cost & Safety

The eval uses a **low-cost model by default**. With 5 tests × 2 repeat attempts × 3 grader calls each, expect roughly **30 LLM calls** per target. A `budget_usd: 2.00` cap is set in the eval file.

To run against a single target first:

```bash
# Test with just one model before running the full matrix
bun agentv eval examples/showcase/multi-model-benchmark/evals/benchmark.eval.yaml \
  --target copilot
```

## Comparing Models

The eval produces a canonical run workspace with `target` in each `index.jsonl` record. Use `agentv compare` to see all models side by side:

```bash
# N-way matrix — see all models at once
agentv compare .agentv/results/multi-model-benchmark/<timestamp>/index.jsonl

# Designate a baseline for CI regression gating
agentv compare .agentv/results/multi-model-benchmark/<timestamp>/index.jsonl --baseline copilot

# Pairwise: compare two specific targets
agentv compare .agentv/results/multi-model-benchmark/<timestamp>/index.jsonl --baseline copilot --candidate claude

# JSON output for CI integration
agentv compare .agentv/results/multi-model-benchmark/<timestamp>/index.jsonl --json
```

### Expected Output

```
Score Matrix

  Test ID                copilot  claude  gemini-llm
  ─────────────────────  ───────  ──────  ───────────
  factual-geography         0.92    0.95         0.87
  factual-science           0.88    0.91         0.85
  analytical-comparison     0.78    0.85         0.80
  creative-explanation      0.82    0.80         0.83
  structured-list           0.90    0.88         0.86

Pairwise Summary:
  claude → copilot:       0 wins, 0 losses, 5 ties  (Δ -0.018)
  claude → gemini-llm:   0 wins, 0 losses, 5 ties  (Δ -0.044)
  copilot → gemini-llm:  0 wins, 0 losses, 5 ties  (Δ -0.026)
```

> **Note:** Actual scores will vary — LLM outputs are non-deterministic. The experiment repeat configuration helps surface this variability. Scores above are illustrative.

## How It Works

### 1. Target Selection

The eval file names one default target. Run the same eval with different
`--target` values to compare models:

```bash
agentv eval evals/benchmark.eval.yaml --target copilot
agentv eval evals/benchmark.eval.yaml --target claude
agentv eval evals/benchmark.eval.yaml --target gemini-llm
```

### 2. Weighted Graders

Three LLM graders score each response. Weights control their contribution to the aggregate score:

```yaml
assertions:
  - name: accuracy
    weight: 3.0      # Most important — factual correctness
  - name: completeness
    weight: 2.0      # Important — full coverage
  - name: clarity
    weight: 1.0      # Nice to have — readability
```

Weighted average formula: `(3×accuracy + 2×completeness + 1×clarity) / 6`

### 3. Repeat Runs

Each test runs twice through top-level run controls. The current repeated
attempt aggregation treats a case as successful when any attempt succeeds.

```yaml
runs: 2
budget_usd: 2.00
```

This surfaces non-determinism — if a model passes on run 1 but fails on run 2,
that signals inconsistency worth investigating.

### 4. Compare

The `agentv compare` command reads a canonical run manifest (`index.jsonl`, with `target` per record) and shows an N-way matrix with pairwise summaries. Each pair classifies per-test deltas:

- **Win**: candidate score exceeds baseline by threshold (default 0.10)
- **Loss**: baseline score exceeds candidate by threshold
- **Tie**: scores within threshold

With `--baseline`, exit code 1 signals regression (CI-friendly).

## Evaluation Flow

```
benchmark.eval.yaml
        │
        ▼
┌─────────────────────────┐
│  agentv eval             │
│  (per target × repeat)  │
└────────┬────────────────┘
         │
         ▼
  .agentv/results/default/<timestamp>/
           index.jsonl
         │
         ▼
┌─────────────────────────┐
│  agentv compare          │
│  (N-way matrix + deltas)│
└─────────────────────────┘
```

## Customization

### Adding a model

Add a new target to `.agentv/targets.yaml`, then reference it in the eval:

```yaml
target: my_new_model
```

### Adding an grader

Add a new grader prompt in `prompts/` and reference it in the eval's `assertions` block:

```yaml
assertions:
  - name: safety
    type: llm-grader
    prompt: ../prompts/safety-rubric.md
    weight: 4.0    # Highest priority
```

### Adjusting run count

Increase `runs` for more variability data (at proportional cost):

```yaml
runs: 5
budget_usd: 5.00
```

## See Also

- [`examples/features/weighted-graders/`](../../features/weighted-graders/) — per-grader weight patterns
- [`examples/features/trials/`](../../features/trials/) — experiment run-count configuration
- [`examples/features/compare/`](../../features/compare/) — baseline vs candidate comparison
