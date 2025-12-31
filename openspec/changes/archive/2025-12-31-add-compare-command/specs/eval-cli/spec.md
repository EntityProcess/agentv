## ADDED Requirements

### Requirement: Result Comparison Command

The CLI SHALL provide a `compare` command to compute differences between two evaluation result files.

#### Scenario: Basic comparison

- **WHEN** the user runs `agentv compare <result1> <result2>`
- **THEN** the CLI loads both result files (JSONL format)
- **AND** matches results by `eval_id`
- **AND** computes score deltas (score2 - score1) for each matched case
- **AND** classifies outcomes as win/loss/tie based on threshold (default 0.1)
- **AND** outputs JSON with the following structure:

```json
{
  "matched": [
    {"eval_id": "case-1", "score1": 0.8, "score2": 0.9, "delta": 0.1, "outcome": "win"}
  ],
  "unmatched": {"file1": 2, "file2": 1},
  "summary": {"total": 50, "matched": 47, "wins": 12, "losses": 5, "ties": 30, "meanDelta": 0.034}
}
```

#### Scenario: Configurable threshold

- **WHEN** the user provides `--threshold <value>`
- **THEN** the CLI uses that value as the score delta required for win/loss classification
- **AND** values below threshold magnitude are classified as ties

#### Scenario: Exit code indicates comparison result

- **WHEN** file2 has equal or better mean score than file1
- **THEN** the CLI exits with code 0
- **WHEN** file1 has better mean score than file2
- **THEN** the CLI exits with code 1
