# Proposal: Add Structured Data Evaluators

**Change ID:** `add-structured-data-evaluators`
**Status:** Implemented
**Author:** AI Agent
**Created:** 2026-01-02
**Implemented:** 2026-01-02

## Problem Statement

AgentV currently supports LLM-based evaluation (`llm_judge`), code-based evaluation (`code_judge`), rubric-based evaluation, and tool trajectory evaluation. However, it lacks built-in primitives for common structured data comparison tasks that appear across multiple domains:

1. **Field-level accuracy validation** - Comparing extracted structured fields (e.g., invoice amounts, dates, names) against ground truth with configurable matching strategies
2. **Fuzzy matching** - Handling OCR errors, formatting variations, and numeric tolerances common in document processing
3. **Date format normalization** - Comparing dates across different formats (ISO, localized, etc.)

These capabilities are universal primitives applicable to many use cases:
- **Document extraction**: PDFs, invoices, forms, receipts
- **Data quality**: Structured output validation, schema compliance
- **Trade data**: Financial amounts with tolerance, date format normalization

Currently, users must implement these comparisons in custom `code_judge` scripts, leading to:
- Code duplication across projects
- Inconsistent scoring methodologies
- Higher barrier to entry for common evaluation patterns

**Note on Geometric Evaluators**: While IoU (Intersection over Union) and coordinate distance metrics are valuable for computer vision tasks, they involve complex algorithms (polygon intersection, Hungarian matching) that conflict with AgentV's "lightweight core" principle. These are better served by `code_judge` scripts or external plugins. See [Out of Scope](#out-of-scope) for details.

## Industry Research Context

This proposal synthesizes evaluation patterns from leading frameworks:

- **Azure AI Document Intelligence (Form Recognizer)**: Provides IoU metrics for bounding box validation, confidence scoring for field extraction, table structure validation with row/column/span properties
- **Google ADK-Python**: Implements confusion matrix evaluation, rubric-based scoring, entity recognition metrics
- **LangWatch**: Dataset splitting (train/test/validation), structured evaluation results with `score`, `passed`, `status`, `details` properties, evaluation wizard patterns
- **Mastra**: Content similarity scorers, prompt alignment scoring, structured data extraction utilities

These frameworks converge on treating field comparison, date normalization, and numeric tolerance as **universal primitives**. Fuzzy matching and geometric metrics vary by use case and are better served via plugins.

## Proposed Solution

Add one new evaluator type to AgentV core that provides universal primitives for structured data comparison:

### Structured Data Evaluator (`field_accuracy`)

Compares extracted structured data against expected values with configurable matching strategies.

**YAML Configuration:**
```yaml
evaluators:
  - name: invoice_field_check
    type: field_accuracy
    fields:
      - path: invoice.total_amount
        match: numeric_tolerance
        tolerance: 0.01
        required: true
        weight: 1.0
      - path: invoice.invoice_date
        match: date
        formats: ["DD-MMM-YYYY", "YYYY-MM-DD", "MM/DD/YYYY"]
        required: true
        weight: 0.5
    aggregation: weighted_average

  # Fuzzy matching via code_judge with config pass-through
  - name: vendor_fuzzy
    type: code_judge
    script: ./multi_field_fuzzy.ts
    fields:
      - path: invoice.vendor_name
        threshold: 0.85
    algorithm: levenshtein
```

**Match Types (field_accuracy):**
- `exact`: Strict equality (default)
- `numeric_tolerance`: Absolute or relative tolerance for numbers
- `date`: Date comparison with format normalization (handles "15-JAN-2025" vs "2025-01-15")

**Fuzzy Matching (via code_judge with config pass-through):**
- Unrecognized YAML properties are passed to script via `config` in stdin
- Example scripts provided: `multi_field_fuzzy.ts`, `fuzzy_match.ts`, `supplier_name_fuzzy.ts`

**Scoring:**
- Per-field scores aggregated using `weighted_average` (default) or `all_or_nothing`
- Returns `hits` (fields that match), `misses` (fields that don't match)
- Supports nested field paths using dot notation (e.g., `invoice.line_items[0].amount`)

## Design Principles Alignment

✅ **Lightweight Core, Plugin Extensibility**: Field comparison, date normalization, and numeric tolerance are universal primitives applicable across document processing, data validation, and testing. Fuzzy matching and complex geometric operations (IoU, polygon intersection) are provided via `code_judge` plugins with config pass-through.

✅ **Built-ins for Primitives Only**: The `field_accuracy` evaluator is stateless, deterministic, has single responsibility, cannot be trivially composed from other primitives, and needed by majority of users doing structured output evaluation.

✅ **Align with Industry Standards**: Field-level accuracy with weighted scoring is used in Azure Form Recognizer, Google ADK, and document AI literature. Fuzzy matching via code_judge follows the plugin pattern used by LangWatch.

✅ **Non-Breaking Extensions**: All new evaluator types are optional. Existing `llm_judge`, `code_judge`, `rubric`, and `tool_trajectory` evaluators continue working unchanged.

## Capabilities Affected

This change introduces **one new capability** and updates one existing capability:

1. **`structured-data-evaluators` (NEW)** - Field accuracy with exact, numeric, and date matching; fuzzy via code_judge config pass-through
2. **`yaml-schema` (MODIFIED)** - Extends evaluator type union to include `field_accuracy`

## Out of Scope

The following remain external to AgentV core (implemented via plugins or `code_judge` scripts):

- ❌ **Geometric evaluators (IoU, coordinate distance)** - Complex algorithms (polygon intersection, Hungarian matching for optimal bbox assignment, precision/recall/F1 for detection) conflict with lightweight core principle. Provide as `code_judge` examples instead.
- ❌ **Semantic/embedding-based matching** - Requires external embedding models, adds significant dependencies
- ❌ PDF/image processing (parsing, OCR, layout detection)
- ❌ Azure SDK integrations (Form Recognizer API wrappers)
- ❌ Domain-specific validators (invoice schema, customs forms, medical records)
- ❌ JSON Schema validation (can be done with existing `code_judge`)
- ❌ Confidence score extraction from external APIs

### Why Geometric Evaluators Are Deferred

The original proposal included `iou_score` and `coordinate_distance` evaluators. After review, these are deferred because:

1. **Algorithm Complexity**: IoU for polygons requires Sutherland-Hodgman clipping or similar. Optimal bbox matching requires Hungarian algorithm (O(n³)).
2. **Limited Universality**: Most AgentV users evaluate text/structured data, not bounding boxes.
3. **Easy Plugin Path**: A 50-line Python `code_judge` script can compute IoU using shapely or numpy.

**Example `code_judge` for IoU** (recommended approach):
```python
#!/usr/bin/env python3
import json
import sys

def compute_iou(box1, box2):
    """Compute IoU for two XYXY boxes."""
    x1 = max(box1[0], box2[0])
    y1 = max(box1[1], box2[1])
    x2 = min(box1[2], box2[2])
    y2 = min(box1[3], box2[3])

    inter_area = max(0, x2 - x1) * max(0, y2 - y1)
    box1_area = (box1[2] - box1[0]) * (box1[3] - box1[1])
    box2_area = (box2[2] - box2[0]) * (box2[3] - box2[1])
    union_area = box1_area + box2_area - inter_area

    return inter_area / union_area if union_area > 0 else 0.0

data = json.load(sys.stdin)
extracted = data["candidate_answer"]["bbox"]
expected = data["reference_answer"]["bbox"]
iou = compute_iou(extracted, expected)

print(json.dumps({
    "score": iou,
    "hits": [f"IoU: {iou:.3f}"] if iou > 0.5 else [],
    "misses": [] if iou > 0.5 else [f"IoU too low: {iou:.3f}"],
    "reasoning": f"Bounding box IoU = {iou:.3f}"
}))
```

## Success Criteria

1. Users can evaluate structured data extraction (e.g., invoice parsing) without writing custom code
2. Fuzzy matching handles OCR errors and formatting variations
3. Date matching handles common format variations (ISO, localized, etc.)
4. All existing tests pass; new evaluator has >90% test coverage
5. Documentation includes examples for document extraction use cases
6. Performance: <10ms overhead per field comparison

## Dependencies

- None (self-contained change)

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| API surface expansion | Medium | Extensive validation, comprehensive tests, follow existing evaluator patterns |
| Performance overhead | Low | Benchmark-driven implementation, optimize hot paths |
| Feature creep requests | Medium | Document clear boundaries in README, refer to plugin system for domain-specific needs |
| Breaking changes in future | Low | Design extensible schema from start, version evaluator configs |

## Open Questions

1. **Numeric tolerance**: Should relative tolerance be percentage-based or ratio-based?
   - **Recommendation**: Support both with explicit config (`tolerance: 0.01, relative: true` for 1%)

2. **Field path syntax**: Use dot notation (`invoice.amount`) or JSONPath (`$.invoice.amount`)?
   - **Recommendation**: Start with dot notation (simpler), add JSONPath in future if needed

3. **Fuzzy matching approach**: Should fuzzy matching be built-in or via plugin?
   - **Resolution**: Via `code_judge` plugin with config pass-through (lightweight core principle); example scripts use 0.85 threshold

4. **Date format handling**: Which date formats should be supported out of the box?
   - **Recommendation**: Support common formats via simple pattern matching:
     - ISO: `YYYY-MM-DD`, `YYYY-MM-DDTHH:mm:ss`
     - US: `MM/DD/YYYY`, `MM-DD-YYYY`
     - EU: `DD/MM/YYYY`, `DD-MM-YYYY`
     - Localized: `DD-MMM-YYYY` (e.g., "15-JAN-2025")
   - Normalize all to epoch timestamp for comparison

5. **Array field comparison**: How should arrays be compared (ordered vs unordered)?
   - **Recommendation**: Support both via config (`array_match: ordered` or `array_match: any_order`)

## References

- [Azure AI Document Intelligence SDK](https://github.com/Azure/azure-sdk-for-python/tree/main/sdk/formrecognizer) - `DocumentTableCell`, `BoundingBox`, field extraction patterns
- [Google ADK-Python Evaluation](https://github.com/google/adk-python/tree/main/src/evaluation) - Confusion matrix, rubric evaluators
- [LangWatch Evaluation Wizard](https://github.com/langwatch/langwatch/tree/main/src/components/evaluations/wizard) - Structured results, dataset management
- [Mastra Scorers](https://github.com/mastra-ai/mastra/tree/main/packages/evals/src/scorers) - Content similarity, prompt alignment
- [IoU Metric (Wikipedia)](https://en.wikipedia.org/wiki/Jaccard_index) - Standard definition and usage
- COCO Dataset Evaluation Metrics - Industry standard for object detection

## Next Steps

1. Review and approve this proposal
2. Implement spec delta for `structured-data-evaluators` (including date match type)
3. Implement `FieldAccuracyEvaluator` in `packages/core/src/evaluation/evaluators.ts`
4. Add YAML schema extensions and validation for `field_accuracy` type
5. Write comprehensive tests (exact, numeric, date matching, code_judge config pass-through)
6. Add `code_judge` example for IoU in `examples/` (demonstrate plugin approach)
7. Update documentation with document extraction use case guide
