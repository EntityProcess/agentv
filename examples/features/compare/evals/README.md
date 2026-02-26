# Compare Command Example

The `agentv compare` command supports three modes: N-way matrix from a combined JSONL, pairwise from a combined JSONL, and two-file pairwise.

## Use Case

Compare model performance across different configurations:
- N-way matrix comparison across 3+ models from a single combined results file
- Baseline regression gating in CI (exit 1 if any target regresses)
- Head-to-head pairwise between two specific targets
- Before/after optimization runs (two-file pairwise)

## Sample Files

- `baseline-results.jsonl` - Results from baseline configuration (GPT-4.1)
- `candidate-results.jsonl` - Results from candidate configuration (GPT-5)
- `../../benchmark-tooling/fixtures/combined-results.jsonl` - Combined multi-target results (3 tests x 3 targets)

## Usage

### N-Way Matrix (combined JSONL)

```bash
agentv compare combined-results.jsonl
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

### Baseline Regression Check

```bash
agentv compare combined-results.jsonl --baseline gpt-4.1
# Exits 1 if any target regresses vs gpt-4.1
```

### Pairwise from Combined JSONL

```bash
agentv compare combined-results.jsonl --baseline gpt-4.1 --candidate gpt-5-mini
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

### Two-File Pairwise (legacy)

```bash
agentv compare baseline-results.jsonl candidate-results.jsonl
```

Output:
```
Comparing: baseline-results.jsonl → candidate-results.jsonl

  Test ID          Baseline  Candidate     Delta  Result
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
agentv compare combined-results.jsonl --json
```

Output uses snake_case for Python ecosystem compatibility:

```json
{
  "matrix": [
    {"test_id": "code-generation", "scores": {"gemini-3-flash-preview": 0.7, "gpt-4.1": 0.8, "gpt-5-mini": 0.75}}
  ],
  "pairwise": [
    {"baseline": "gemini-3-flash-preview", "candidate": "gpt-4.1", "summary": {"wins": 1, "losses": 0, "ties": 2, "mean_delta": 0.033}}
  ],
  "targets": ["gemini-3-flash-preview", "gpt-4.1", "gpt-5-mini"]
}
```

## Exit Codes

| Mode | Exit Code |
|---|---|
| Two-file pairwise | Exit 1 on regression (meanDelta < 0) |
| Combined with `--baseline` | Exit 1 if any target regresses vs baseline |
| Combined without `--baseline` | Exit 0 (informational) |

## CI Integration

Use exit codes for automated quality gates:

```bash
# N-way: fail if any target regresses vs baseline
agentv compare results.jsonl --baseline gpt-4.1 || echo "Regression detected!"

# Two-file: fail if candidate regresses
agentv compare baseline.jsonl candidate.jsonl || echo "Regression detected!"
```
