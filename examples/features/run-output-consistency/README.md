# Run Output Consistency Metric

Measures how consistent an agent's outputs are across repeated runs using pairwise cosine similarity.

## What It Measures

When an agent is run multiple times on the same input (runs), outputs may vary due to LLM non-determinism. This metric quantifies that variation:

- **Score 1.0** — all run outputs are identical/semantically equivalent
- **Score ~0.8+** — high consistency (minor wording differences)
- **Score ~0.5** — moderate consistency (different phrasing, same topic)
- **Score <0.5** — low consistency (substantially different outputs)

## How It Works

1. Receives an array of run outputs via `config.runOutputs`
2. Computes a vector representation for each output (embedding or token-overlap)
3. Calculates pairwise cosine similarity for all output pairs
4. Returns the average as the consistency score

### Similarity Methods

| Method | When Used | Accuracy |
|--------|-----------|----------|
| **Embedding** | Target client available, `fallback` not set | High — captures semantic similarity |
| **Token-overlap** | No target or `fallback: token` | Moderate — bag-of-words cosine |

## Edge Cases

| Condition | Score | Reasoning |
|-----------|-------|-----------|
| 0 runs | 0 | Cannot compute — reported as miss |
| 1 run | 1.0 | Perfect consistency by definition |
| 2+ runs | 0–1 | Average pairwise cosine similarity |
| Identical outputs | 1.0 | Maximum similarity |
| Empty strings | 0 | Zero vectors produce 0 similarity |

## Usage

### Eval YAML

```yaml
assertions:
  - name: run-consistency
    type: code-grader
    command: ["bun", "run", "../graders/run-consistency.ts"]
    config:
      runOutputs:
        - "Output from run 1"
        - "Output from run 2"
        - "Output from run 3"
```

### Config Options

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `runOutputs` | `string[]` | Yes | Array of outputs from repeated runs |
| `fallback` | `"token"` | No | Force token-overlap mode (skip embedding) |

### Running

```bash
# Run all tests (uses token-overlap fallback for demo)
bun agentv eval examples/features/run-output-consistency/evals/dataset.eval.yaml --dry-run

# Run a specific test
bun agentv eval examples/features/run-output-consistency/evals/dataset.eval.yaml --test-id high-consistency --dry-run
```

## Extending

### Custom Embedding Provider

Replace `getEmbeddings()` in `graders/run-consistency.ts` with your preferred embedding API. The grader expects vectors as `number[][]` — any embedding dimension works.

### Integration with Run Execution

In a production workflow, pipe actual run outputs into the `runOutputs` config array. Example with a wrapper script:

```typescript
import { execSync } from 'child_process';

// Run N runs and collect outputs
const outputs = Array.from({ length: 5 }, () =>
  execSync('bun agentv eval ... --json').toString()
);

// Pass to consistency grader via config
const config = { runOutputs: outputs };
```

### Threshold-Based Pass/Fail

Wrap the grader in an assertion that enforces a minimum consistency threshold:

```yaml
assertions:
  - name: run-consistency
    type: code-grader
    command: ["bun", "run", "../graders/run-consistency.ts"]
    config:
      runOutputs: [...]
```

Check `score >= 0.8` in the results to enforce high consistency.
