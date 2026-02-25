# Benchmark Tooling

Utilities for multi-model benchmarking workflows with AgentV.

## split-by-target

Splits a combined results JSONL file into one file per `target`, enabling pairwise comparison with `agentv compare`.

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
