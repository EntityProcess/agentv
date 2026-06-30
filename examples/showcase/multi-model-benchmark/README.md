# Multi-Model Benchmark Showcase

Demonstrates a complete **multi-model × multi-metric × variability** evaluation workflow end-to-end. Run the same eval once per target, score each run on weighted metrics, measure variability with repeated attempts, and compare completed runs.

## What This Shows

| Feature | How it's used |
|---------|---------------|
| **Per-target runs** | Run the same eval separately for `copilot`, `claude`, and `gemini-llm` |
| **Weighted graders** | Accuracy (3×), completeness (2×), clarity (1×) |
| **Repeat runs** | 2 attempts per test to surface non-determinism |
| **Compare workflow** | Side-by-side model comparison from result files |

## Files

```
multi-model-benchmark/
├── README.md                        # This file
├── evals/
│   └── benchmark.eval.yaml          # Eval definition, target binding, repeat controls, and metrics
└── prompts/
    ├── accuracy-rubric.md           # Factual correctness grader (weight 3.0)
    ├── completeness-rubric.md       # Coverage grader (weight 2.0)
    └── clarity-rubric.md            # Readability grader (weight 1.0)
```

## Prerequisites

1. Configure targets in `.agentv/targets.yaml` at the repository root. The example commands use `copilot`, `claude`, and `gemini-llm` — these must be defined with valid provider credentials.
2. Install dependencies: `bun install`

## Running the Evaluation

From the repository root:

```bash
# Run once per target. Use the same experiment label so Dashboard analytics
# can group the completed runs.
bun agentv eval examples/showcase/multi-model-benchmark/evals/benchmark.eval.yaml \
  --target copilot --experiment multi-model-benchmark
bun agentv eval examples/showcase/multi-model-benchmark/evals/benchmark.eval.yaml \
  --target claude --experiment multi-model-benchmark
bun agentv eval examples/showcase/multi-model-benchmark/evals/benchmark.eval.yaml \
  --target gemini-llm --experiment multi-model-benchmark
```

### Cost & Safety

The eval uses a **low-cost model by default**. For each target, 5 tests × 2 repeat attempts × 3 grader calls is roughly **30 LLM calls**. A `budget_usd: 2.00` cap is set in the eval file.

To run against a single target first:

```bash
# Test with one model before running the other targets
bun agentv eval examples/showcase/multi-model-benchmark/evals/benchmark.eval.yaml \
  --target copilot
```

## Comparing Models

Each eval produces a canonical run workspace with `target` in each `index.jsonl` record. Use `agentv compare` or Dashboard analytics to see completed runs side by side:

```bash
# Pairwise: compare two completed runs
agentv compare \
  .agentv/results/multi-model-benchmark/<copilot-timestamp>/index.jsonl \
  .agentv/results/multi-model-benchmark/<claude-timestamp>/index.jsonl

# N-way: combine completed runs, then compare the combined manifest
agentv results combine \
  .agentv/results/multi-model-benchmark/<copilot-timestamp> \
  .agentv/results/multi-model-benchmark/<claude-timestamp> \
  .agentv/results/multi-model-benchmark/<gemini-timestamp> \
  --output .agentv/results/multi-model-benchmark/combined
agentv compare .agentv/results/multi-model-benchmark/combined/index.jsonl

# Dashboard analytics also shows an experiment × target matrix over completed runs
agentv dashboard
```

### Aggregated Analytics Output

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

Each test runs twice through top-level repeat controls. The repeated-attempt
aggregation below treats a case as successful when any completed attempt
succeeds.

```yaml
repeat:
  count: 2
  strategy: pass_any
  early_exit: false
budget_usd: 2.00
```

This surfaces non-determinism — if a model passes on run 1 but fails on run 2,
that signals inconsistency worth investigating.

### 4. Compare

The `agentv compare` command reads completed run manifests (`index.jsonl`, with `target` per record) and shows pairwise summaries. Dashboard analytics aggregates completed runs into an experiment × target matrix. Each pair classifies per-test deltas:

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
│  (one target × repeats) │
└────────┬────────────────┘
         │
         ▼
  .agentv/results/default/<timestamp>/
           index.jsonl
         │
         ▼
┌─────────────────────────┐
│  agentv compare /        │
│  Dashboard analytics     │
│  (completed-run deltas) │
└─────────────────────────┘
```

## Customization

### Adding a model

Add a new target to `.agentv/targets.yaml`, then run the same eval with `--target <name>` and the same `--experiment` label.

```bash
bun agentv eval examples/showcase/multi-model-benchmark/evals/benchmark.eval.yaml \
  --target my_new_model --experiment multi-model-benchmark
```

### Adding a grader

Add a new grader prompt in `prompts/` and reference it in the eval's `assertions` block:

```yaml
assertions:
  - name: safety
    type: llm-grader
    prompt: ../prompts/safety-rubric.md
    weight: 4.0    # Highest priority
```

### Adjusting run count

Increase `repeat.count` for more variability data (at proportional cost):

```yaml
repeat:
  count: 5
  strategy: pass_any
  early_exit: false
budget_usd: 5.00
```

## See Also

- [`examples/features/weighted-graders/`](../../features/weighted-graders/) — per-grader weight patterns
- [`examples/features/trials/`](../../features/trials/) — experiment run-count configuration
- [`examples/features/compare/`](../../features/compare/) — baseline vs candidate comparison
