# Document Extraction Example

This folder demonstrates two evaluation patterns for document extraction:

1. **`field_accuracy`** (built-in) - Per-evalcase scoring with pass/fail per field
2. **`code_judge`** (custom) - TP/TN/FP/FN metrics for cross-document aggregation

## When to Use Each Pattern

| Pattern | Use Case | Output |
|---------|----------|--------|
| `field_accuracy` | Simple pass/fail scoring per evalcase | Score (0-1) per evalcase |
| `code_judge` with `details.metrics` | Aggregate precision/recall across documents | TP/TN/FP/FN per field |

## Quick Start

From repo root:

```bash
# Pattern 1: Field accuracy (per-evalcase scoring)
bun agentv run examples/features/document-extraction/evals/dataset-field-accuracy.yaml

# Pattern 2: Confusion metrics (cross-document aggregation)
bun agentv run examples/features/document-extraction/evals/dataset-confusion-metrics.yaml

# Aggregate TP/TN/FP/FN into a table (only works with dataset-confusion-metrics.yaml)
bun run examples/features/document-extraction/scripts/aggregate_metrics.ts \
  .agentv/results/eval_<timestamp>.jsonl
```

## Pattern 1: Field Accuracy (`dataset-field-accuracy.yaml`)

Uses the built-in `field_accuracy` evaluator for per-evalcase scoring:

```yaml
evaluators:
  - name: invoice_field_accuracy
    type: field_accuracy
    fields:
      - path: invoice_number
        match: exact
        required: true
      - path: invoice_date
        match: date
      - path: net_total
        match: numeric_tolerance
        tolerance: 1.0
```

**Output**: A score (0-1) per evalcase based on weighted field matches.

**Best for**: Quick validation, CI/CD gates, simple pass/fail checks.

## Pattern 2: Confusion Metrics (`dataset-confusion-metrics.yaml`)

Uses a custom `code_judge` that emits `details.metrics` with TP/TN/FP/FN per field:

```yaml
evaluators:
  - name: header_confusion
    type: code_judge
    script: ["bun", "run", "../judges/header_confusion_metrics.ts"]
    fields:
      - path: invoice_number
      - path: currency
      - path: supplier.name
```

**Key requirement**: All cases must use the **same evaluator** with the **same fields** to enable cross-document aggregation.

**Output**: Aggregate metrics table with fractional precision/recall:

```
Processed 5 evaluation results from .agentv/results/eval_<timestamp>.jsonl

Field          | TP | TN | FP | FN | Precision | Recall | F1    | Count
---------------+----+----+----+----+-----------+--------+-------+------
currency       | 4  | 0  | 1  | 1  | 0.800     | 0.800  | 0.800 | 5
gross_total    | 3  | 0  | 1  | 2  | 0.750     | 0.600  | 0.667 | 5
importer.name  | 5  | 0  | 0  | 0  | 1.000     | 1.000  | 1.000 | 5
invoice_date   | 5  | 0  | 0  | 0  | 1.000     | 1.000  | 1.000 | 5
invoice_number | 4  | 0  | 0  | 1  | 1.000     | 0.800  | 0.889 | 5
supplier.name  | 1  | 0  | 4  | 4  | 0.200     | 0.200  | 0.200 | 5

Total: TP=22 TN=0 FP=6 FN=8
Micro-Precision: 0.786
Micro-Recall: 0.733
Micro-F1: 0.759
Macro-F1: 0.759
```

**Best for**: Measuring extraction accuracy across a document corpus, comparing model versions.

## Aggregate Metrics Script

The `aggregate_metrics.ts` script only works with evaluators that emit `details.metrics`:

```bash
bun run scripts/aggregate_metrics.ts results.jsonl [options]

Options:
  --evaluator <name>  Filter to a specific evaluator
  --format csv        Output as CSV instead of table
```

## Where To Look

- **Datasets**:
  - `evals/dataset-field-accuracy.yaml` - Field accuracy patterns
  - `evals/dataset-confusion-metrics.yaml` - TP/TN/FP/FN aggregation
- **Target**: `mock_extractor.ts`
- **Fixtures**: `fixtures/`
- **Judges**:
  - `judges/header_confusion_metrics.ts` - Emits TP/TN/FP/FN
  - `judges/fuzzy_match.ts`, `judges/multi_field_fuzzy.ts` - Fuzzy matching
  - `judges/line_item_matching.ts` - Array matching
- **Scripts**: `scripts/aggregate_metrics.ts`
