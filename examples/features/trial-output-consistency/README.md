# Trial Output Consistency Metric

Measures how consistent an agent's outputs are across repeated trials using pairwise cosine similarity.

## What It Measures

When an agent is run multiple times on the same input (trials), outputs may vary due to LLM non-determinism. This metric quantifies that variation:

- **Score 1.0** — all trial outputs are identical/semantically equivalent
- **Score ~0.8+** — high consistency (minor wording differences)
- **Score ~0.5** — moderate consistency (different phrasing, same topic)
- **Score <0.5** — low consistency (substantially different outputs)

## How It Works

1. Receives an array of trial outputs via `config.trialOutputs`
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
| 0 trials | 0 | Cannot compute — reported as miss |
| 1 trial | 1.0 | Perfect consistency by definition |
| 2+ trials | 0–1 | Average pairwise cosine similarity |
| Identical outputs | 1.0 | Maximum similarity |
| Empty strings | 0 | Zero vectors produce 0 similarity |

## Usage

### Eval YAML

```yaml
assert:
  - name: trial-consistency
    type: code_judge
    command: ["bun", "run", "../judges/trial-consistency.ts"]
    config:
      trialOutputs:
        - "Output from trial 1"
        - "Output from trial 2"
        - "Output from trial 3"
```

### Config Options

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `trialOutputs` | `string[]` | Yes | Array of outputs from repeated trials |
| `fallback` | `"token"` | No | Force token-overlap mode (skip embedding) |

### Running

```bash
# Run all tests (uses token-overlap fallback for demo)
bun agentv eval examples/features/trial-output-consistency/evals/dataset.eval.yaml --dry-run

# Run a specific test
bun agentv eval examples/features/trial-output-consistency/evals/dataset.eval.yaml --test-id high-consistency --dry-run
```

## Extending

### Custom Embedding Provider

Replace `getEmbeddings()` in `judges/trial-consistency.ts` with your preferred embedding API. The judge expects vectors as `number[][]` — any embedding dimension works.

### Integration with Trial Execution

In a production workflow, pipe actual trial outputs into the `trialOutputs` config array. Example with a wrapper script:

```typescript
import { execSync } from 'child_process';

// Run N trials and collect outputs
const outputs = Array.from({ length: 5 }, () =>
  execSync('bun agentv eval ... --json').toString()
);

// Pass to consistency judge via config
const config = { trialOutputs: outputs };
```

### Threshold-Based Pass/Fail

Wrap the judge in an assertion that enforces a minimum consistency threshold:

```yaml
assert:
  - name: trial-consistency
    type: code_judge
    command: ["bun", "run", "../judges/trial-consistency.ts"]
    config:
      trialOutputs: [...]
```

Check `score >= 0.8` in the results to enforce high consistency.
