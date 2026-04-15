# NLP Metrics Examples

Demonstrates how to implement common NLP evaluation metrics as AgentV `code_grader` graders — no external dependencies required.

## Graders

| File | Metric | Use Case |
|------|--------|----------|
| `graders/rouge.ts` | ROUGE-1 / ROUGE-2 | Summarisation — measures n-gram recall and F1 |
| `graders/bleu.ts` | BLEU | Translation — measures n-gram precision with brevity penalty |
| `graders/similarity.ts` | Cosine + Jaccard | Paraphrasing — token-overlap similarity |
| `graders/levenshtein.ts` | Levenshtein distance | Extraction — character-level edit distance |

Each grader is a standalone TypeScript file that uses `defineCodeGrader` from `@agentv/eval`. Scores are normalised to the 0–1 range expected by AgentV.

## Running

```bash
# From the repository root
bun agentv eval examples/features/nlp-metrics/evals/dataset.eval.yaml
```

Run a single test:

```bash
bun agentv eval examples/features/nlp-metrics/evals/dataset.eval.yaml --test-id summarisation-rouge
```

### Inspect Grading Criteria

Use `--grading-brief` to see what assertions a test will be evaluated against:

```bash
bun agentv eval prompt eval --grading-brief \
  examples/features/nlp-metrics/evals/dataset.eval.yaml \
  --test-id summarisation-rouge
```

## How It Works

Each grader receives the candidate answer and reference text via the `defineCodeGrader` handler, computes the relevant metric from scratch, and returns a `CodeGraderResult` with:

- **score** — normalised 0–1 value
- **hits / misses** — threshold checks for quick pass/fail
- **details** — raw metric values for downstream analysis

## Combining Metrics

The `multi-metric-evaluation` test in `dataset.eval.yaml` shows how to attach multiple graders to a single test case. AgentV runs each grader independently and reports all scores.
