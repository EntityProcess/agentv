# Structured Data + Metrics Evaluators

This reference covers the built-in evaluators used for grading structured outputs and gating on execution metrics:

- `field_accuracy`
- `latency`
- `cost`

## Ground Truth (`expected_messages`)

Put the expected structured output in the evalcase `expected_messages` (typically as the last `assistant` message with `content` as an object). Evaluators read expected values from there.

```yaml
evalcases:
  - id: invoice-001
    expected_messages:
      - role: assistant
        content:
          invoice_number: "INV-2025-001234"
          net_total: 1889
```

## `field_accuracy`

Use `field_accuracy` to compare fields in the candidate JSON against the ground-truth object in `expected_messages`.

```yaml
execution:
  evaluators:
    - name: invoice_fields
      type: field_accuracy
      aggregation: weighted_average
      fields:
        - path: invoice_number
          match: exact
          required: true
          weight: 2.0
        - path: invoice_date
          match: date
          formats: ["DD-MMM-YYYY", "YYYY-MM-DD"]
        - path: net_total
          match: numeric_tolerance
          tolerance: 1.0
```

### Match types

- `exact`: strict equality
- `date`: compares dates after parsing; optionally provide `formats`
- `numeric_tolerance`: numeric compare within `tolerance` (set `relative: true` for relative tolerance)

For fuzzy string matching, use a `code_judge` evaluator (e.g. Levenshtein) instead of adding a fuzzy mode to `field_accuracy`.

### Aggregation

- `weighted_average` (default): weighted mean of field scores
- `all_or_nothing`: score 1.0 only if all graded fields pass

## `latency` and `cost`

These evaluators gate on execution metrics reported by the provider (via `traceSummary`).

```yaml
execution:
  evaluators:
    - name: performance
      type: latency
      threshold: 2000
    - name: budget
      type: cost
      budget: 0.10
```

## Common pattern: combine correctness + gates

Use a `composite` evaluator if you want a single “release gate” score/verdict from multiple checks:

```yaml
execution:
  evaluators:
    - name: release_gate
      type: composite
      evaluators:
        - name: correctness
          type: field_accuracy
          fields:
            - path: invoice_number
              match: exact
        - name: latency
          type: latency
          threshold: 2000
        - name: cost
          type: cost
          budget: 0.10
      aggregator:
        type: weighted_average
        weights:
          correctness: 0.8
          latency: 0.1
          cost: 0.1
```
