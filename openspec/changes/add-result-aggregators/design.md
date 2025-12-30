## Context

AgentV evaluates AI agents by running eval cases and scoring them individually. The current `calculateEvaluationSummary()` function computes basic statistics (mean, median, histogram) but this is hard-coded and not extensible.

For classification tasks like export-screening (Low/Medium/High risk), users need aggregate metrics:
- **Confusion matrix**: Predicted vs actual class distribution
- **Precision/Recall/F1**: Per-class and macro-averaged
- **Accuracy**: Overall correct predictions

These require parsing structured output from evaluator results (e.g., `hits: ["Correct: AI=High, Expected=High"]`) and aggregating across all cases.

## Goals / Non-Goals

**Goals:**
- Extensible plugin system for aggregate metrics computation
- Built-in aggregators for common use cases (basic-stats, confusion-matrix, pass-rate)
- Custom aggregators via TypeScript/JavaScript files
- Declarative configuration in eval YAML
- CLI flag for ad-hoc aggregator selection

**Non-Goals:**
- Real-time streaming aggregation (batch only)
- Aggregator-specific UI visualization
- Cross-eval-file aggregation (per-file only initially)

## Decisions

### Decision: Aggregators operate on `EvaluationResult[]`

Aggregators receive the complete array of evaluation results after all cases finish. This is simpler than streaming and matches the current summary computation pattern.

**Alternatives considered:**
- Streaming aggregation: More complex, premature optimization
- Per-case hooks: Doesn't fit aggregate metric semantics

### Decision: Built-in aggregators are functions, custom aggregators are files

Built-in aggregators (`basic-stats`, `confusion-matrix`, `pass-rate`) are registered in core. Custom aggregators are loaded from `.ts`/`.js` files that export a `ResultAggregator` interface.

**Alternatives considered:**
- All aggregators as files: Adds overhead for common cases
- Plugin package system: Over-engineered for current needs

### Decision: Confusion matrix aggregator parses evaluator hits/misses

The `confusion-matrix` aggregator extracts predicted/actual classes from evaluator output strings (e.g., `"Correct: AI=High, Expected=High"`). This leverages existing code judge output patterns without requiring schema changes.

**Alternatives considered:**
- Structured prediction field in results: Breaking change, not needed yet
- JSONPath configuration: Adds complexity, can add later if needed

## Risks / Trade-offs

- **Parsing evaluator output**: Fragile if output format changes. Mitigation: Document expected format, add validation.
- **Custom aggregator security**: Loading arbitrary JS files. Mitigation: Same trust model as code judges.

## Open Questions

1. Should aggregators be chainable (output of one feeds into another)?
   - **Recommendation**: No, keep simple. Each aggregator is independent.

2. Should aggregator results be included in JSONL output?
   - **Recommendation**: Yes, append as final line with `type: "aggregate"` marker.
