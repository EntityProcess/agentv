# Structured Data Evaluation Examples

This directory contains example evaluation files demonstrating AgentV's structured data evaluators for document extraction and data quality assessment.

> **⚠️ Important**: These examples use the proposed `field_accuracy` evaluator from OpenSpec proposal [`add-structured-data-evaluators`](../../../openspec/changes/add-structured-data-evaluators/). They will not run until that proposal is implemented. Use these as reference for functional testing during implementation.

## Examples

### Invoice Extraction (`invoice-extraction.yaml`)

**Use Case:** Commercial invoice extractor that parses structured trade data from shipping documents.

**Architecture:**
- **Input**: HTML mock files in `fixtures/` (simulating OCR-extracted content from PDFs)
- **Extractor**: `mock_extractor.ts` - TypeScript CLI that parses HTML and outputs JSON
- **Evaluator**: `field_accuracy` - Validates extracted fields against expected values
- **Test Cases**: 5 scenarios covering perfect extraction, fuzzy matching, tolerance, missing fields, and arrays

**AgentV Goals Alignment:**
- ✅ **Declarative Definitions**: YAML-based configuration with clear expected outcomes
- ✅ **Structured Evaluation**: Demonstrates deterministic field comparison (primitive for rubric-based patterns)
- ⚠️ **Multi-Objective Scoring**: Currently demonstrates correctness only; includes placeholders for latency/cost/safety
- ✅ **Optimization Ready**: Weighted fields enable future hyperparameter tuning of extraction algorithms

**Evaluators Used:**
- `field_accuracy` - Validates extracted fields against ground truth
  - Exact matching for invoice numbers, dates, currency codes
  - Numeric tolerance for amounts (±$1 to handle rounding)
  - Fuzzy matching for company names (handles spacing like "CMA - CGM" vs "CMA CGM")
  - Nested field paths for line item arrays

**Test Scenarios:**

1. **invoice-001**: Perfect extraction - Extractor normalizes data to match expected (rounds decimals, cleans spacing)
2. **invoice-002**: **Fuzzy matching test** - Extractor outputs "Acme - Shipping" (with hyphen/spaces), expected is "Acme Shipping". Tests Levenshtein similarity > 0.85
3. **invoice-003**: **Numeric tolerance test** - Extractor outputs 1889.5, expected is 1889. Tests ±$1 tolerance accepts 0.5 difference
4. **invoice-004**: **Missing required field** - Extractor fails to find invoice_number (absent in HTML), tests required field scoring penalty
5. **invoice-005**: Array validation - First 2 line items with path `line_items[0].description`

**How the Mock Extractor Works:**
The `mock_extractor.ts` intentionally produces realistic variations to test the evaluator:
- **invoice-001**: Normalizes data (rounds 1889.00 → 1889, cleans "Acme - Shipping" → "Acme Shipping")
- **invoice-002**: Preserves OCR-like formatting ("Acme - Shipping" kept as-is from HTML)
- **invoice-003**: Keeps decimal precision (1889.50 → 1889.5) to test tolerance
- **invoice-004**: Returns undefined for missing fields (HTML has no invoice_number)

**Directory Structure:**
```
structured-data/
├── invoice-extraction.yaml    # Eval dataset with 5 test cases
├── mock_extractor.ts          # Mock CLI that extracts data from HTML
├── fixtures/                  # Test input files
│   ├── invoice-001.html       # Complete invoice (8 line items)
│   ├── invoice-002.html       # Supplier name spacing test
│   ├── invoice-003.html       # Rounding tolerance test
│   ├── invoice-004.html       # Missing required fields
│   ├── invoice-005.html       # Partial extraction (2 line items)
│   └── README.md
└── README.md
```

**Running the Example:**
```bash
# Note: Requires field_accuracy evaluator to be implemented
cd examples/features/structured-data
agentv eval invoice-extraction.yaml

# Manual test of extractor
bun run mock_extractor.ts ./fixtures/invoice-001.html
```

## Running Evaluations

**Expected Output:**
```json
{
  "evalCaseResults": [
    {
      "id": "invoice-001",
      "score": 1.0,
      "verdict": "pass",
      "evaluatorResults": [
        {
          "name": "invoice_field_accuracy",
          "type": "field_accuracy",
          "score": 1.0,
          "hits": [
            "invoice_number",
            "invoice_date",
            "supplier.name",
            "net_total"
          ],
          "misses": []
        }
      ]
    }
  ]
}
```

## Field Accuracy Evaluator Configuration

### Match Types

**Exact Match** - Strict equality
```yaml
- path: invoice.invoice_number
  match: exact
  required: true
  weight: 1.0
```

**Numeric Tolerance** - Allow rounding errors
```yaml
- path: invoice.total
  match: numeric_tolerance
  tolerance: 0.01  # ±$0.01
  relative: false  # Absolute tolerance
  required: true
  weight: 3.0
```

**Fuzzy Match** - Handle OCR/spacing variations
```yaml
- path: invoice.issuer.name
  match: fuzzy
  algorithm: levenshtein  # or jaro_winkler
  threshold: 0.85  # 0.0-1.0 similarity score
  required: true
  weight: 0.8
```

### Aggregation Strategies

**Weighted Average** (default) - Each field contributes proportionally
```yaml
aggregation: weighted_average
# Final score = sum(field_score * weight) / sum(weights)
```

**All or Nothing** - Any failure causes overall failure
```yaml
aggregation: all_or_nothing
# Final score = 1.0 if all fields match, else 0.0
```

## Sample Data Structure

The expected invoice extraction output follows this schema (based on mock extractor output):

```typescript
interface InvoiceExtraction {
  invoice_number: string;
  invoice_date: string;
  incoterm: string | null;
  currency: string;
  net_total: number;
  gross_total: number;
  
  supplier: {
    name: string;
    address: string;
  };
  
  importer: {
    name: string;
    address: string;
  };
  
  line_items: Array<{
    description: string;
    product_code: string | null;
    quantity: number;
    unit_price: number;
    line_total: number;
    unit_type: string;
    hs_code: string;
  }>;
}
```

**Example output from mock extractor:**
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
$schema: agentv-eval-v2
description: Receipt data extraction

execution:total
          match: numeric_tolerance
          tolerance: 0.01
          weight: 3.0
        - path: merchant
          match: fuzzy
          threshold: 0.80
          weight: 1.0
        - path: date
          match: exact
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
2. **Use fuzzy matching for text** - Names, addresses often have OCR variations
3. **Set realistic tolerances** - Base on observed accuracy (e.g., ±$1 for invoice totals)
4. **Mark optional fields** - `required: false` for non-critical data
5. **Test edge cases** - Include corrupted, partial, and malformed documents
6. **Start strict, relax gradually** - Begin with exact matching, add tolerance as needed

### Multi-Objective Evaluation
While the example focuses on correctness, AgentV's goals include multi-objective scoring:
- **Correctness**: Field accuracy, rubric satisfaction
- **Latency**: Extraction time per document (planned)
- **Cost**: Token usage, API costs (planned)
- **Safety**: PII handling, data sanitization (planned)

Use weighted aggregation across objectives for holistic evaluation.

### Choosing Evaluator Types
- **`field_accuracy`** (proposed): Best for structured extraction with known schema
- **`rubric`** (available now): Best for qualitative assessment with human-readable criteria
- **`code_judge`** (available now): Best for complex validation logic or custom metrics
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
- Review fuzzy threshold (0.85 may be too strict)

**All fields score 0.0:**
- Confirm candidate output structure matches expected schema
- Check for null/undefined values in extracted data
- Verify evaluator type is `field_accuracy` (not `llm_judge`)

**Numeric tolerance not working:**
- Ensure `relative: false` for absolute tolerance
- Check tolerance value (0.01 = ±1 cent, not ±1%)
- Verify both values are numbers (not strings)

## Related Examples

- `geometric-evaluators/` - Bounding box and coordinate validation
- `../showcase/export-screening/` - Complex multi-evaluator example
- `../showcase/psychotherapy/` - Multi-turn conversation evaluation
