# Compare Command Example

This example demonstrates the `agentv compare` command for comparing evaluation results between two runs.

## Use Case

Compare model performance across different configurations:
- Baseline vs. candidate prompts
- Different model versions (e.g., GPT-4.1 vs. GPT-5)
- Before/after optimization runs

## Sample Files

- `baseline-results.jsonl` - Results from baseline configuration (GPT-4.1)
- `candidate-results.jsonl` - Results from candidate configuration (GPT-5)

## Usage

### Basic Comparison

```bash
agentv compare baseline-results.jsonl candidate-results.jsonl
```

Output:
```
Comparing: baseline-results.jsonl → candidate-results.jsonl

  Eval ID          Baseline  Candidate     Delta  Result
  ───────────────  ────────  ─────────  ────────  ────────
  code-review-001      0.72       0.88     +0.16  ✓ win
  code-review-002      0.85       0.82     -0.03  = tie
  code-review-003      0.68       0.75     +0.07  = tie
  code-gen-001         0.90       0.92     +0.02  = tie
  code-gen-002         0.75       0.80     +0.05  = tie

Summary: 1 win, 0 losses, 4 ties | Mean Δ: +0.054 | Status: improved
```

### With Custom Threshold

Use a stricter threshold (0.05) for win/loss classification:

```bash
agentv compare baseline-results.jsonl candidate-results.jsonl --threshold 0.05
```

### JSON Output

For machine-readable output (CI pipelines, scripts):

```bash
agentv compare baseline-results.jsonl candidate-results.jsonl --json
```

Output uses snake_case for Python ecosystem compatibility:

```json
{
  "matched": [
    {"eval_id": "code-review-001", "score1": 0.72, "score2": 0.88, "delta": 0.16, "outcome": "win"}
  ],
  "unmatched": {"file1": 0, "file2": 0},
  "summary": {
    "total": 10,
    "matched": 5,
    "wins": 1,
    "losses": 0,
    "ties": 4,
    "mean_delta": 0.054
  }
}
```

## Exit Codes

- `0` - Candidate is equal or better (meanDelta >= 0)
- `1` - Baseline is better (regression detected)

## CI Integration

Use exit codes for automated quality gates:

```bash
# Fail CI if candidate regresses
agentv compare baseline.jsonl candidate.jsonl || echo "Regression detected!"
```
