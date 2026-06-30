# Compare Command Example

The `agentv compare` command compares completed run manifests. Run the same eval once per target, then pass the finished run manifests to compare. For N-way matrix analysis, combine completed runs first and compare the combined manifest.

## Use Case

Compare model performance across different configurations:
- Baseline regression gating in CI (exit 1 if the candidate regresses)
- Head-to-head pairwise comparison between two completed runs
- N-way matrix comparison from combined completed runs
- Before/after optimization runs

## Sample Files

- completed run workspaces under `.agentv/results/default/<timestamp>/`

## Usage

### Pairwise Compare

```bash
agentv compare .agentv/results/default/<baseline-timestamp>/index.jsonl \
  .agentv/results/default/<candidate-timestamp>/index.jsonl
```

Output:
```
Comparing: .agentv/results/default/<baseline-timestamp>/index.jsonl → .agentv/results/default/<candidate-timestamp>/index.jsonl

  Test ID          Baseline  Candidate     Delta  Result
  ───────────────  ────────  ─────────  ────────  ────────
  code-review-001      0.72       0.88     +0.16  ✓ win
  code-review-002      0.85       0.82     -0.03  = tie
  code-review-003      0.68       0.75     +0.07  = tie
  code-gen-001         0.90       0.92     +0.02  = tie
  code-gen-002         0.75       0.80     +0.05  = tie

Summary: 1 win, 0 losses, 4 ties | Mean Δ: +0.054 | Status: improved
```

### N-Way Matrix From Completed Runs

```bash
agentv results combine \
  .agentv/results/default/<gpt-timestamp> \
  .agentv/results/default/<claude-timestamp> \
  .agentv/results/default/<gemini-timestamp> \
  --output .agentv/results/default/combined
agentv compare .agentv/results/default/combined/index.jsonl
```

Output:

```
Score Matrix

  Test ID          claude-sonnet-4  gemini-3-flash-preview  gpt-4.1
  ───────────────  ───────────────  ──────────────────────  ───────
  code-generation             0.86                    0.70     0.80
  greeting                    0.95                    0.90     0.85
  summarization               0.84                    0.80     0.90
```

### With Custom Threshold

Use a stricter threshold (0.05) for win/loss classification:

```bash
agentv compare .agentv/results/default/<baseline-timestamp>/index.jsonl \
  .agentv/results/default/<candidate-timestamp>/index.jsonl --threshold 0.05
```

### JSON Output

For machine-readable output (CI pipelines, scripts):

```bash
agentv compare .agentv/results/default/<baseline-timestamp>/index.jsonl \
  .agentv/results/default/<candidate-timestamp>/index.jsonl --json
```

Output uses snake_case for Python ecosystem compatibility:

```json
{
  "pairwise": [
    {"test_id": "code-generation", "baseline_score": 0.72, "candidate_score": 0.88, "delta": 0.16, "result": "win"}
  ]
}
```

## Exit Codes

| Mode | Exit Code |
|---|---|
| Two-file pairwise | Exit 1 on regression (meanDelta < 0) |
| Combined manifest with `--baseline` | Exit 1 if any target regresses vs baseline |
| Combined manifest without `--baseline` | Exit 0 (informational) |
| JSON output | Same pass/fail behavior as pairwise |

## CI Integration

Use exit codes for automated quality gates:

```bash
# Fail if candidate regresses
agentv compare .agentv/results/default/<baseline-timestamp>/index.jsonl .agentv/results/default/<candidate-timestamp>/index.jsonl || echo "Regression detected!"
```
