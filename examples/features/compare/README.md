# Baseline vs Candidate Comparison

Demonstrates comparing canonical run manifests using the `agentv compare` command.

## What This Shows

- N-way matrix comparison from a run manifest with multiple targets
- Two-run pairwise comparison (baseline vs candidate)
- Score delta calculation and win/loss classification
- Baseline regression detection via exit codes
- Human-readable and JSON output formats

## Running

```bash
# From repository root

# N-way matrix from a canonical run manifest
agentv compare .agentv/results/runs/<timestamp>/index.jsonl

# Pairwise from the same combined run manifest
agentv compare .agentv/results/runs/<timestamp>/index.jsonl \
  --baseline gpt-4.1 --candidate gpt-5-mini

# CI regression gate: exit 1 if any target regresses vs baseline
agentv compare .agentv/results/runs/<timestamp>/index.jsonl \
  --baseline gpt-4.1

# Two-run pairwise comparison
agentv compare .agentv/results/runs/<baseline-timestamp>/index.jsonl \
  .agentv/results/runs/<candidate-timestamp>/index.jsonl

# With custom threshold for win/loss classification
agentv compare .agentv/results/runs/<baseline-timestamp>/index.jsonl \
  .agentv/results/runs/<candidate-timestamp>/index.jsonl --threshold 0.05

# JSON output for CI pipelines
agentv compare .agentv/results/runs/<baseline-timestamp>/index.jsonl \
  .agentv/results/runs/<candidate-timestamp>/index.jsonl --json
```

## Key Files

- canonical run workspaces under `.agentv/results/runs/<timestamp>/`
- `evals/README.md` - Detailed usage documentation
