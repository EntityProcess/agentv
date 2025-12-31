# Compare Command Example

This example demonstrates the `agentv compare` command for comparing evaluation results between two runs.

## Use Case

Compare model performance across different configurations:
- Baseline vs. candidate prompts
- Different model versions (e.g., GPT-4.1 vs. GPT-5)
- Before/after optimization runs

## Sample Files

- `baseline-results.jsonl` - Results from baseline configuration
- `candidate-results.jsonl` - Results from candidate configuration

## Usage

### Basic Comparison

```bash
agentv compare baseline-results.jsonl candidate-results.jsonl
```

### With Custom Threshold

Use a stricter threshold (0.05) for win/loss classification:

```bash
agentv compare baseline-results.jsonl candidate-results.jsonl --threshold 0.05
```

## Output Format

The command outputs structured JSON:

```json
{
  "matched": [
    {"eval_id": "case-1", "score1": 0.7, "score2": 0.9, "delta": 0.2, "outcome": "win"},
    {"eval_id": "case-2", "score1": 0.8, "score2": 0.75, "delta": -0.05, "outcome": "tie"}
  ],
  "unmatched": {"file1": 0, "file2": 0},
  "summary": {
    "total": 4,
    "matched": 2,
    "wins": 1,
    "losses": 0,
    "ties": 1,
    "meanDelta": 0.075
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
