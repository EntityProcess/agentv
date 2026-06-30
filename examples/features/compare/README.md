# Baseline vs Candidate Comparison

Demonstrates comparing completed run manifests using the `agentv compare` command.

## What This Shows

- Two-run pairwise comparison (baseline vs candidate)
- N-way matrix analysis from combined completed runs
- Score delta calculation and win/loss classification
- Baseline regression detection via exit codes
- Human-readable and JSON output formats

## Running

```bash
# From repository root

# Pairwise completed-run comparison
agentv compare .agentv/results/default/<baseline-timestamp>/index.jsonl \
  .agentv/results/default/<candidate-timestamp>/index.jsonl

# N-way matrix from completed runs
agentv results combine \
  .agentv/results/default/<baseline-timestamp> \
  .agentv/results/default/<candidate-timestamp> \
  .agentv/results/default/<third-target-timestamp> \
  --output .agentv/results/default/combined
agentv compare .agentv/results/default/combined/index.jsonl

# With custom threshold for win/loss classification
agentv compare .agentv/results/default/<baseline-timestamp>/index.jsonl \
  .agentv/results/default/<candidate-timestamp>/index.jsonl --threshold 0.05

# JSON output for CI pipelines
agentv compare .agentv/results/default/<baseline-timestamp>/index.jsonl \
  .agentv/results/default/<candidate-timestamp>/index.jsonl --json
```

## Key Files

- completed run workspaces under `.agentv/results/default/<timestamp>/`
- `evals/README.md` - Detailed usage documentation
