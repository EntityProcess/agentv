# Benchmark Tooling

Utilities for multi-model benchmarking workflows with AgentV.

## N-Way Multi-Model Comparison (built-in)

`agentv compare` natively supports combined JSONL files with a `target` field, enabling N-way matrix comparison without splitting files.

### Quick Start

```bash
# Try it now — fixture included, no API keys needed
agentv compare examples/features/benchmark-tooling/fixtures/combined-results.jsonl
```

Output:

```
Score Matrix

  Test ID          gemini-3-flash-preview  gpt-4.1  gpt-5-mini
  ───────────────  ──────────────────────  ───────  ──────────
  code-generation                    0.70     0.80        0.75
  greeting                           0.90     0.85        0.95
  summarization                      0.85     0.90        0.80

Pairwise Summary:
  gemini-3-flash-preview → gpt-4.1:     1 win, 0 losses, 2 ties  (Δ +0.033)
  gemini-3-flash-preview → gpt-5-mini:  0 wins, 0 losses, 3 ties  (Δ +0.017)
  gpt-4.1 → gpt-5-mini:                 0 wins, 0 losses, 3 ties  (Δ -0.017)
```

### Usage

```bash
# N-way matrix (all targets)
agentv compare .agentv/results/raw/eval_<timestamp>/index.jsonl

# With baseline regression check (exits 1 if any target regresses)
agentv compare .agentv/results/raw/eval_<timestamp>/index.jsonl --baseline gpt-4.1

# Pairwise from combined file
agentv compare .agentv/results/raw/eval_<timestamp>/index.jsonl --baseline gpt-4.1 --candidate gpt-5-mini

# Filter to specific targets
agentv compare .agentv/results/raw/eval_<timestamp>/index.jsonl --targets gpt-4.1 --targets gpt-5-mini

# JSON output
agentv compare .agentv/results/raw/eval_<timestamp>/index.jsonl --json
```

### Pairwise Mode

Extract a head-to-head comparison between two specific targets:

```bash
agentv compare .agentv/results/raw/eval_<timestamp>/index.jsonl --baseline gpt-4.1 --candidate gpt-5-mini
```

```
Comparing: gpt-4.1 → gpt-5-mini

  Test ID          Baseline  Candidate     Delta  Result
  ───────────────  ────────  ─────────  ────────  ────────
  greeting             0.85       0.95     +0.10  = tie
  code-generation      0.80       0.75     -0.05  = tie
  summarization        0.90       0.80     -0.10  = tie

Summary: 0 wins, 0 losses, 3 ties | Mean Δ: -0.017 | Status: regressed
```

### Exit Codes

| Mode | Exit Code |
|---|---|
| Two-file pairwise (`a.jsonl b.jsonl`) | Exit 1 on regression |
| Combined with `--baseline` | Exit 1 if any target regresses vs baseline |
| Combined without `--baseline` | Exit 0 (informational) |

### Combined JSONL Format

Each line includes a `target` field to identify which model produced the result:

```json
{"test_id": "greeting", "score": 0.90, "target": "gemini-3-flash-preview", "input": "...", "answer": "..."}
```

### Key Files

- `evals/benchmark.eval.yaml` - Example eval config with 3 tests
- `fixtures/combined-results.jsonl` - Sample combined output (9 records: 3 tests x 3 targets)

## split-by-target

Splits a combined results JSONL file into one file per `target`, enabling pairwise comparison with `agentv compare`. This is an alternative to the built-in N-way comparison above, useful when you need separate files per target for other tools.

### Usage

```bash
# Split into the same directory as the input file
bun examples/features/benchmark-tooling/scripts/split-by-target.ts results.jsonl

# Split into a specific output directory
bun examples/features/benchmark-tooling/scripts/split-by-target.ts results.jsonl ./split-output
```

Given a combined `results.jsonl` containing records for targets `gpt-4.1` and `claude-sonnet-4`:

```
results.gpt-4.1.jsonl          (records where target == "gpt-4.1")
results.claude-sonnet-4.jsonl  (records where target == "claude-sonnet-4")
```

### Filename Normalization

Target names are normalized for safe filenames:

| Target value | Output filename |
|---|---|
| `gpt-4.1` | `results.gpt-4.1.jsonl` |
| `Claude Sonnet 4` | `results.claude-sonnet-4.jsonl` |
| `azure/gpt-4o` | `results.azure-gpt-4o.jsonl` |

### Downstream Compare Workflow

After splitting, use `agentv compare` to perform pairwise model comparisons:

```bash
# 1. Run a matrix evaluation that produces a combined results file
bun agentv eval my-eval.yaml

# 2. Split results by target
bun examples/features/benchmark-tooling/scripts/split-by-target.ts results.jsonl ./by-target

# 3. Compare any two targets
bun agentv compare ./by-target/results.gpt-4.1.jsonl ./by-target/results.claude-sonnet-4.jsonl

# 4. JSON output for CI pipelines
bun agentv compare ./by-target/results.gpt-4.1.jsonl ./by-target/results.claude-sonnet-4.jsonl --json
```

The `compare` command matches records by `test_id`, calculates score deltas, and classifies each as win/loss/tie. It exits non-zero on regressions, making it suitable for CI gates.

## win-rate-summary

Computes aggregate win/loss/tie rates from `agentv compare --json` output, making comparison results decision-ready at a glance.

### Usage

```bash
# Save comparison output to a file
bun agentv compare baseline.jsonl candidate.jsonl --json > comparison.json

# Print a human-readable summary table
bun examples/features/benchmark-tooling/scripts/win-rate-summary.ts comparison.json

# Machine-readable JSON output
bun examples/features/benchmark-tooling/scripts/win-rate-summary.ts comparison.json --json

# Custom tie tolerance (default: 0.1)
bun examples/features/benchmark-tooling/scripts/win-rate-summary.ts comparison.json --tolerance 0.05
```

### Per-Metric Breakdown

Pass a directory of comparison JSON files to get per-metric win rates. Each file is treated as a separate metric, with the filename as the label:

```bash
# Run comparisons for different metrics
bun agentv compare base.jsonl cand.jsonl --json > comparisons/accuracy.json
bun agentv compare base-latency.jsonl cand-latency.jsonl --json > comparisons/latency.json

# Aggregate across all metrics
bun examples/features/benchmark-tooling/scripts/win-rate-summary.ts comparisons/
```

### Tie Policy

A result is classified as a **tie** when `|delta| < tolerance`.

| Tolerance | Effect |
|---|---|
| `0.1` (default) | Matches `agentv compare` default threshold |
| `0.05` | Stricter — only small deltas are ties |
| `0` | No ties unless delta is exactly 0 |

## significance-test

Performs a **paired bootstrap significance test** on two result JSONL files. Records are aligned by `test_id`; unmatched IDs are reported and skipped. This answers the question: *"Is the score difference between baseline and candidate statistically significant, or just sampling noise?"*

### Method

The test uses **paired bootstrap resampling**:

1. Align baseline and candidate records by `test_id` to form paired differences.
2. Resample the paired differences with replacement (default: 10,000 iterations).
3. Compute a confidence interval from the bootstrap distribution (percentile method).
4. Derive a two-sided p-value from the proportion of bootstrap means crossing zero.
5. Report Cohen's d effect size for practical significance.

### Usage

```bash
# Basic test
bun examples/features/benchmark-tooling/scripts/significance-test.ts baseline.jsonl candidate.jsonl

# Machine-readable JSON output
bun examples/features/benchmark-tooling/scripts/significance-test.ts baseline.jsonl candidate.jsonl --json

# Custom settings
bun examples/features/benchmark-tooling/scripts/significance-test.ts baseline.jsonl candidate.jsonl \
  --alpha 0.01 --iterations 50000 --metric accuracy --seed 42
```

### Options

| Flag | Default | Description |
|---|---|---|
| `--metric <name>` | `score` | Label for the metric being tested |
| `--iterations <n>` | `10000` | Number of bootstrap resampling iterations |
| `--alpha <n>` | `0.05` | Significance level (e.g., 0.05 = 95% confidence) |
| `--json` | — | Output machine-readable JSON only |
| `--seed <n>` | — | RNG seed for reproducible results |

### Interpreting Results

| Field | Meaning |
|---|---|
| `observed_mean_diff` | Average score difference (candidate − baseline) |
| `effect_size_cohens_d` | Standardized effect size (small ≈ 0.2, medium ≈ 0.5, large ≈ 0.8) |
| `p_value` | Probability of observing this difference under the null hypothesis |
| `ci_lower` / `ci_upper` | Confidence interval for the true mean difference |
| `significant` | `true` if p-value < α |
| `verdict` | Human-readable interpretation |

### Edge Cases

- **Unmatched test IDs**: Reported to stderr, skipped from analysis.
- **Too few pairs (< 5)**: Warning in verdict that result may be unreliable.
- **Identical scores**: p-value = 1, not significant (correct behavior).
- **< 2 pairs**: Cannot test; exits with code 1.

## benchmark-report

Generates a consolidated benchmark summary across models and metrics from result JSONL files. Produces per-target aggregates (mean, std dev, median, pass rate, 95% CI) and per-metric breakdowns when evaluator-level scores are present.

### Usage

```bash
# Summarize all result files in a directory
bun examples/features/benchmark-tooling/scripts/benchmark-report.ts ./by-target/

# Summarize specific files
bun examples/features/benchmark-tooling/scripts/benchmark-report.ts results.gpt-4.1.jsonl results.claude-sonnet-4.jsonl

# Machine-readable JSON output
bun examples/features/benchmark-tooling/scripts/benchmark-report.ts ./by-target/ --json

# Sort by score (descending) and set custom pass threshold
bun examples/features/benchmark-tooling/scripts/benchmark-report.ts ./by-target/ --sort score --pass-threshold 0.7
```

### Options

| Flag | Default | Description |
|---|---|---|
| `--json` | — | Output machine-readable JSON only |
| `--sort <field>` | `name` | Sort targets by: `name`, `score`, `pass_rate` |
| `--pass-threshold <n>` | `0.5` | Score threshold to count as pass |

### Output

**Per-Target Summary** includes for each model: record count, mean score, standard deviation, median, min, max, pass rate, and 95% confidence interval.

**Per-Target Metric Breakdown** appears when records contain evaluator-level `scores[]` arrays, showing mean and spread for each evaluator (e.g., accuracy, latency) per target.

**Machine-readable JSON** output (`--json`) returns a structured `BenchmarkReport` object with `summary`, `per_target`, `per_target_metrics`, and `overall` fields.

### End-to-End Workflow

```bash
# 1. Run multi-model evaluation
bun agentv eval my-eval.yaml

# 2. Split results by target
bun examples/features/benchmark-tooling/scripts/split-by-target.ts results.jsonl ./by-target

# 3. Compare two targets
bun agentv compare ./by-target/results.gpt-4.1.jsonl ./by-target/results.claude-sonnet-4.jsonl --json > comparison.json

# 4. Get win-rate summary
bun examples/features/benchmark-tooling/scripts/win-rate-summary.ts comparison.json

# 5. Statistical significance test
bun examples/features/benchmark-tooling/scripts/significance-test.ts \
  ./by-target/results.gpt-4.1.jsonl ./by-target/results.claude-sonnet-4.jsonl

# 6. Consolidated benchmark report
bun examples/features/benchmark-tooling/scripts/benchmark-report.ts ./by-target/

# 7. CI gate: use JSON output for programmatic checks
bun examples/features/benchmark-tooling/scripts/benchmark-report.ts ./by-target/ --json
bun examples/features/benchmark-tooling/scripts/win-rate-summary.ts comparison.json --json
bun examples/features/benchmark-tooling/scripts/significance-test.ts \
  ./by-target/results.gpt-4.1.jsonl ./by-target/results.claude-sonnet-4.jsonl --json
```
