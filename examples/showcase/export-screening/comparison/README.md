# Export Screening Model Comparison

This example demonstrates using `agentv compare` to track model performance over time and compare different configurations for the export risk classification task.

## Scenario

You're evaluating AI models for export control risk classification. This comparison workflow helps you:

1. **Track Regression**: Ensure new model versions don't regress on accuracy
2. **Compare Configurations**: Evaluate different prompts or model settings
3. **CI Integration**: Automate quality gates in your deployment pipeline

## Sample Files

- `baseline-gpt4.jsonl` - GPT-4 baseline results (reference performance)
- `candidate-gpt4o.jsonl` - GPT-4o candidate results (newer model)
- `candidate-optimized.jsonl` - Optimized prompt results

## Running Comparisons

### Basic Model Comparison

Compare GPT-4o against the GPT-4 baseline:

```bash
cd examples/showcase/export-screening/comparison
agentv compare baseline-gpt4.jsonl candidate-gpt4o.jsonl
```

Expected output shows wins/losses/ties and mean delta.

### Prompt Optimization Comparison

Compare optimized prompt against baseline:

```bash
agentv compare baseline-gpt4.jsonl candidate-optimized.jsonl --threshold 0.05
```

Using a stricter threshold (0.05) ensures only meaningful improvements count as wins.

### CI Quality Gate Script

```bash
#!/bin/bash
# quality-gate.sh - Run before deployment

BASELINE="comparison/baseline-gpt4.jsonl"
CANDIDATE=".agentv/results/latest.jsonl"

echo "Comparing candidate against baseline..."
agentv compare "$BASELINE" "$CANDIDATE"

if [ $? -eq 1 ]; then
  echo "FAILED: Candidate regresses on export screening accuracy"
  exit 1
fi

echo "PASSED: Candidate maintains or improves accuracy"
```

## Interpreting Results

### Output Fields

```json
{
  "matched": [...],          // Per-case comparison details
  "unmatched": {             // Cases only in one file
    "file1": 0,
    "file2": 0
  },
  "summary": {
    "total": 40,             // Total cases across both files
    "matched": 20,           // Cases compared (in both files)
    "wins": 8,               // Candidate better
    "losses": 2,             // Baseline better
    "ties": 10,              // No significant difference
    "meanDelta": 0.045       // Average score improvement
  }
}
```

### Decision Criteria

| meanDelta | wins > losses | Recommendation |
|-----------|---------------|----------------|
| > 0.05    | Yes           | Deploy candidate |
| 0 to 0.05 | Yes           | Consider deploying |
| < 0       | No            | Keep baseline |

## Advanced Workflows

### Multi-Stage Comparison

Compare across multiple baselines:

```bash
# Compare against production baseline
agentv compare prod-baseline.jsonl candidate.jsonl > prod-comparison.json

# Compare against staging baseline
agentv compare staging-baseline.jsonl candidate.jsonl > staging-comparison.json

# Analyze both
jq -s '.[0].summary.meanDelta, .[1].summary.meanDelta' \
  prod-comparison.json staging-comparison.json
```

### Per-Category Analysis

Filter results by eval_id prefix to analyze specific categories:

```bash
# Export results as JSON array
agentv compare baseline.jsonl candidate.jsonl | \
  jq '[.matched[] | select(.eval_id | startswith("exp-high"))]'
```

### Tracking Over Time

Maintain a baseline and update it when improvements are validated:

```bash
# After successful deployment
cp candidate.jsonl baseline.jsonl
git add baseline.jsonl
git commit -m "Update baseline after GPT-4o deployment"
```
