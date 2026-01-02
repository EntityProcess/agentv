---
"@agentv/core": minor
"agentv": minor
---

Add `field_accuracy` evaluator for structured data comparison

This release introduces a new built-in evaluator type for comparing extracted structured data against expected values with configurable matching strategies.

## New Features

### Field Accuracy Evaluator (`field_accuracy`)

A declarative evaluator for validating structured data extraction results with per-field control:

```yaml
evaluators:
  - name: invoice_fields
    type: field_accuracy
    fields:
      - path: invoice.total
        match: numeric_tolerance
        tolerance: 0.01
        weight: 2.0
      - path: invoice.date
        match: date
        formats: ["DD-MMM-YYYY", "YYYY-MM-DD"]
      - path: vendor.name
        match: fuzzy
        threshold: 0.85
        algorithm: levenshtein
    aggregation: weighted_average
```

### Match Types

- **`exact`**: Strict equality comparison (default)
- **`fuzzy`**: String similarity with Levenshtein or Jaro-Winkler distance
- **`numeric_tolerance`**: Absolute or relative tolerance for numbers
- **`date`**: Date comparison with automatic format normalization

### Aggregation Strategies

- **`weighted_average`**: Weighted mean of field scores (default)
- **`all_or_nothing`**: Score 1.0 if all fields match, 0.0 otherwise

### Field Path Syntax

Supports dot notation with array indexing:
- `invoice.vendor.name`
- `line_items[0].amount`
- `data.items[2].nested.field`

## Use Cases

- **Document extraction**: Validate invoice, receipt, form extraction
- **Data quality**: Verify structured output accuracy
- **Trade data**: Match financial amounts with tolerance, normalize date formats

## Example Output

```json
{
  "score": 0.875,
  "verdict": "pass",
  "hits": ["invoice.total", "invoice.date", "vendor.name"],
  "misses": ["invoice.currency (value mismatch)"],
  "reasoning": "3/4 fields matched"
}
```
