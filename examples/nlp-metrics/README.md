# NLP Metrics Examples

Demonstrates how to implement common NLP evaluation metrics as AgentV `code_judge` evaluators — no external dependencies required.

## Judges

| File | Metric | Use Case |
|------|--------|----------|
| `judges/rouge.ts` | ROUGE-1 / ROUGE-2 | Summarisation — measures n-gram recall and F1 |
| `judges/bleu.ts` | BLEU | Translation — measures n-gram precision with brevity penalty |
| `judges/similarity.ts` | Cosine + Jaccard | Paraphrasing — token-overlap similarity |
| `judges/levenshtein.ts` | Levenshtein distance | Extraction — character-level edit distance |

Each judge is a standalone TypeScript file that uses `defineCodeJudge` from `@agentv/eval`. Scores are normalised to the 0–1 range expected by AgentV.

## Running

```bash
# From the repository root
bun agentv run examples/nlp-metrics/evals/dataset.yaml
```

Run a single test:

```bash
bun agentv run examples/nlp-metrics/evals/dataset.yaml --test-id summarisation-rouge
```

## How It Works

Each judge receives the candidate answer and reference text via the `defineCodeJudge` handler, computes the relevant metric from scratch, and returns a `CodeJudgeResult` with:

- **score** — normalised 0–1 value
- **hits / misses** — threshold checks for quick pass/fail
- **details** — raw metric values for downstream analysis

## Combining Metrics

The `multi-metric-evaluation` test in `dataset.yaml` shows how to attach multiple evaluators to a single test case. AgentV runs each judge independently and reports all scores.
