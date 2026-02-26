# Baseline vs Candidate Comparison

Demonstrates comparing evaluation results using the `agentv compare` command.

## What This Shows

- N-way matrix comparison from a combined JSONL file
- Two-file pairwise comparison (baseline vs candidate)
- Score delta calculation and win/loss classification
- Baseline regression detection via exit codes
- Human-readable and JSON output formats

## Running

```bash
# From repository root

# N-way matrix from a combined results file (see ../benchmark-tooling/ for fixture)
agentv compare examples/features/benchmark-tooling/fixtures/combined-results.jsonl

# Pairwise from combined file
agentv compare examples/features/benchmark-tooling/fixtures/combined-results.jsonl \
  --baseline gpt-4.1 --candidate gpt-5-mini

# CI regression gate: exit 1 if any target regresses vs baseline
agentv compare examples/features/benchmark-tooling/fixtures/combined-results.jsonl \
  --baseline gpt-4.1

# Two-file pairwise comparison (legacy)
agentv compare examples/features/compare/evals/baseline-results.jsonl \
  examples/features/compare/evals/candidate-results.jsonl

# With custom threshold for win/loss classification
agentv compare examples/features/compare/evals/baseline-results.jsonl \
  examples/features/compare/evals/candidate-results.jsonl --threshold 0.05

# JSON output for CI pipelines
agentv compare examples/features/compare/evals/baseline-results.jsonl \
  examples/features/compare/evals/candidate-results.jsonl --json
```

## Key Files

- `evals/baseline-results.jsonl` - Results from baseline configuration
- `evals/candidate-results.jsonl` - Results from candidate configuration
- `evals/README.md` - Detailed usage documentation
- `../benchmark-tooling/fixtures/combined-results.jsonl` - Combined multi-target fixture for N-way matrix
