# Compare Command

Compare evaluation results between two runs to measure performance differences.

## Usage

```bash
agentv compare <baseline.jsonl> <candidate.jsonl> [--threshold <value>]
```

## Arguments

| Argument | Description |
|----------|-------------|
| `result1` | Path to baseline JSONL result file |
| `result2` | Path to candidate JSONL result file |
| `--threshold`, `-t` | Score delta threshold for win/loss classification (default: 0.1) |

## How It Works

1. **Load Results**: Reads both JSONL files containing evaluation results
2. **Match by eval_id**: Pairs results with matching `eval_id` fields
3. **Compute Deltas**: Calculates `delta = score2 - score1` for each pair
4. **Classify Outcomes**:
   - `win`: delta >= threshold (candidate better)
   - `loss`: delta <= -threshold (baseline better)
   - `tie`: |delta| < threshold (no significant difference)
5. **Output Summary**: JSON with matched results, unmatched counts, and statistics

## Output Format

```json
{
  "matched": [
    {
      "eval_id": "case-1",
      "score1": 0.7,
      "score2": 0.9,
      "delta": 0.2,
      "outcome": "win"
    }
  ],
  "unmatched": {
    "file1": 0,
    "file2": 0
  },
  "summary": {
    "total": 2,
    "matched": 1,
    "wins": 1,
    "losses": 0,
    "ties": 0,
    "meanDelta": 0.2
  }
}
```

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Candidate is equal or better (meanDelta >= 0) |
| `1` | Baseline is better (regression detected) |

## Workflow Examples

### Model Comparison

Compare different model versions:

```bash
# Run baseline evaluation
agentv eval evals/*.yaml --target gpt-4 --out baseline.jsonl

# Run candidate evaluation
agentv eval evals/*.yaml --target gpt-4o --out candidate.jsonl

# Compare results
agentv compare baseline.jsonl candidate.jsonl
```

### Prompt Optimization

Compare before/after prompt changes:

```bash
# Run with original prompt
agentv eval evals/*.yaml --out before.jsonl

# Modify prompt, then run again
agentv eval evals/*.yaml --out after.jsonl

# Compare with strict threshold
agentv compare before.jsonl after.jsonl --threshold 0.05
```

### CI Quality Gate

Fail CI if candidate regresses:

```bash
#!/bin/bash
agentv compare baseline.jsonl candidate.jsonl
if [ $? -eq 1 ]; then
  echo "Regression detected! Candidate performs worse than baseline."
  exit 1
fi
echo "Candidate is equal or better than baseline."
```

## Tips

- **Threshold Selection**: Default 0.1 means 10% difference required. Use stricter thresholds (0.05) for critical evaluations.
- **Unmatched Results**: Check `unmatched` counts to identify eval cases that only exist in one file.
- **Multiple Comparisons**: Compare against multiple baselines by running the command multiple times.
