# Document Extraction Example (`field_accuracy`)

This folder is a small, runnable showcase of using `field_accuracy` to grade structured outputs from a document extractor.

## Run

From repo root:

```bash
bun agentv eval examples/features/document-extraction/evals/dataset.yaml
```

This eval discovers the example target definition at `examples/features/document-extraction/.agentv/targets.yaml` automatically.

## What It Demonstrates

- `expected_messages` holds the ground-truth structured object (the expected extraction output).
- `field_accuracy` selects which fields to score (by JSON-path-like `path`) and how (`exact`, `date`, `numeric_tolerance`).
- OCR-ish string fuzziness is handled via `code_judge` scripts (see `multi_field_fuzzy.ts`).

## Where To Look

- Dataset: `examples/features/document-extraction/evals/dataset.yaml`
- Target (mock extractor): `examples/features/document-extraction/mock_extractor.ts`
- Fixtures: `examples/features/document-extraction/fixtures/`
- Fuzzy judges (plugins): `examples/features/document-extraction/multi_field_fuzzy.ts`, `examples/features/document-extraction/fuzzy_match.ts`

## Minimal YAML Patterns

Field accuracy:

```yaml
execution:
  evaluators:
    - name: invoice_field_accuracy
      type: field_accuracy
      fields:
        - path: invoice_number
          match: exact
        - path: invoice_date
          match: date
          formats: ["DD-MMM-YYYY", "YYYY-MM-DD"]
        - path: net_total
          match: numeric_tolerance
          tolerance: 1.0
```

Fuzzy matching via `code_judge` (config pass-through):

```yaml
execution:
  evaluators:
    - name: party_names_fuzzy
      type: code_judge
      script: ../multi_field_fuzzy.ts
      fields:
        - path: supplier.name
          threshold: 0.85
      algorithm: levenshtein
```
```json
{
  "invoice_number": "INV-2025-001234",
  "invoice_date": "15-JAN-2025",
  "currency": "USD",
  "net_total": 1889,
  "gross_total": 1889,
  "supplier": {
    "name": "Acme - Shipping"
  },
  "importer": {
    "name": "Global Trade Co"
  },
  "line_items": [
    {
      "description": "OCEAN FREIGHT",
      "quantity": 1,
      "unit_price": 1370,
      "line_total": 1370,
      "hs_code": "853720"
    }
  ]
}
```

## Creating Your Own Eval

1. **Define ground truth** - Create expected output JSON structure
2. **Configure evaluator** - Choose match types and weights for each field
3. **Set thresholds** - Adjust tolerance/similarity based on requirements
4. **Add test cases** - Include success, partial, and failure scenarios
5. **Run and iterate** - Adjust weights/thresholds based on results

### Example: Custom Document Type

```yaml
description: Receipt data extraction

execution:
  evaluators:
    - name: receipt_fields
      type: field_accuracy
      fields:
        - path: total
          match: numeric_tolerance
          tolerance: 0.01
          weight: 3.0
        - path: merchant
          match: exact
          weight: 1.0
        - path: date
          match: date
          weight: 1.0

evalcases:
  - id: receipt-001
    expected_messages:
      - role: assistant
        content:
          merchant: "Acme Store"
          date: "2026-01-02"
          total: 42.99
    input_messages:
      - role: user
        content:
          - type: file
            value: ./fixtures/receipt-001.pdf
          - type: text
            value: "Extract structured data from this receipt"
```

## Best Practices

### Field Accuracy Configuration
1. **Weight critical fields higher** - Total amounts, IDs, dates should have weight >1.0
2. **Use code_judge for fuzzy text matching** - Names and addresses with OCR variations benefit from `fuzzy_match.ts`
3. **Set realistic tolerances** - Base on observed accuracy (e.g., ±$1 for invoice totals)
4. **Mark optional fields** - `required: false` for non-critical data
5. **Test edge cases** - Include corrupted, partial, and malformed documents
6. **Start strict, relax gradually** - Begin with exact matching, add tolerance as needed

### Multi-Objective Evaluation
AgentV supports multi-objective scoring across different dimensions:
- **Correctness**: Field accuracy, rubric satisfaction
- **Latency**: Execution time threshold (`type: latency`, `threshold: 2000`)
- **Cost**: API cost budget (`type: cost`, `budget: 0.10`)

Use weighted aggregation across objectives for holistic evaluation.

### Choosing Evaluator Types
- **`field_accuracy`**: Best for structured extraction with known schema
- **`latency`**: Check execution duration against threshold (requires provider metrics)
- **`cost`**: Check execution cost against budget (requires provider metrics)
- **`rubric`**: Best for qualitative assessment with human-readable criteria
- **`code_judge`**: Best for complex validation logic or custom metrics
- **Combine multiple**: Use `field_accuracy` for structure + `rubric` for quality

## Performance Benchmarks

Field accuracy evaluation targets:
- **Per-field comparison**: <10ms
- **100 fields**: ~1 second total
- **Typical invoice (20 fields)**: ~200ms

## Troubleshooting

**Low scores despite correct extraction:**
- Check field path syntax (use dot notation: `invoice.vendor.name`)
- Verify data types match (string "100" ≠ number 100)
- For text with variations, use `fuzzy_match.ts` code_judge instead of exact match

**All fields score 0.0:**
- Confirm candidate output structure matches expected schema
- Check for null/undefined values in extracted data
- Verify evaluator type is `field_accuracy` (not `llm_judge`)

**Numeric tolerance not working:**
- Ensure `relative: false` for absolute tolerance
- Check tolerance value (0.01 = ±1 cent, not ±1%)
- Verify both values are numbers (not strings)

## Related Examples

- [Geometric Evaluators (code_judge)](../../../openspec/changes/add-structured-data-evaluators/specs/geometric-evaluators/spec.md) - IoU and coordinate distance as Python scripts
- `../showcase/export-screening/` - Complex multi-evaluator example
- `../showcase/psychotherapy/` - Multi-turn conversation evaluation
