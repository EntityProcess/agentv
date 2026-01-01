# Proposal: Add Structured Data Evaluators

**Change ID:** `add-structured-data-evaluators`  
**Status:** Draft  
**Author:** AI Agent  
**Created:** 2026-01-02

## Problem Statement

AgentV currently supports LLM-based evaluation (`llm_judge`), code-based evaluation (`code_judge`), rubric-based evaluation, and tool trajectory evaluation. However, it lacks built-in primitives for common structured data comparison tasks that appear across multiple domains:

1. **Field-level accuracy validation** - Comparing extracted structured fields (e.g., invoice amounts, dates, names) against ground truth with configurable matching strategies
2. **Schema validation** - Verifying that extracted data conforms to expected structure and required fields
3. **Geometric/spatial comparison** - Measuring accuracy of bounding boxes, coordinates, or spatial layouts using industry-standard metrics like IoU (Intersection over Union)
4. **Fuzzy matching** - Handling OCR errors, formatting variations, and numeric tolerances common in document processing

These capabilities are universal primitives applicable to many use cases:
- **Document extraction**: PDFs, invoices, forms, receipts
- **Object detection**: Bounding boxes, image segmentation, layout analysis
- **Data quality**: Structured output validation, schema compliance
- **Trade data**: Financial amounts with tolerance, date format normalization

Currently, users must implement these comparisons in custom `code_judge` scripts, leading to:
- Code duplication across projects
- Inconsistent scoring methodologies
- Higher barrier to entry for common evaluation patterns
- Lack of standardized metrics (precision, recall, F1)

## Industry Research Context

This proposal synthesizes evaluation patterns from leading frameworks:

- **Azure AI Document Intelligence (Form Recognizer)**: Provides IoU metrics for bounding box validation, confidence scoring for field extraction, table structure validation with row/column/span properties
- **Google ADK-Python**: Implements confusion matrix evaluation, rubric-based scoring, entity recognition metrics
- **LangWatch**: Dataset splitting (train/test/validation), structured evaluation results with `score`, `passed`, `status`, `details` properties, evaluation wizard patterns
- **Mastra**: Content similarity scorers, prompt alignment scoring, structured data extraction utilities

These frameworks converge on treating field comparison, fuzzy matching, and geometric metrics as **universal primitives** rather than domain-specific features.

## Proposed Solution

Add two new evaluator types to AgentV core that provide universal primitives for structured data comparison:

### 1. Structured Data Evaluator (`field_accuracy`)

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
        match: exact
        required: true
        weight: 0.5
      - path: invoice.vendor_name
        match: fuzzy
        threshold: 0.85
        algorithm: levenshtein
        weight: 0.8
    aggregation: weighted_average
```

**Match Types:**
- `exact`: Strict equality (default)
- `fuzzy`: String similarity using Levenshtein or Jaro-Winkler distance
- `numeric_tolerance`: Absolute or relative tolerance for numbers
- `semantic`: Embedding-based similarity (optional, future enhancement)

**Scoring:**
- Per-field scores aggregated using `weighted_average` (default) or `all_or_nothing`
- Returns `hits` (fields that match), `misses` (fields that don't match)
- Supports nested field paths using dot notation (e.g., `invoice.line_items[0].amount`)

### 2. Geometric Evaluator (`iou_score`, `coordinate_distance`)

Provides spatial comparison metrics for bounding boxes and coordinates.

**YAML Configuration:**
```yaml
evaluators:
  - name: bbox_accuracy
    type: iou_score
    bbox_path: detected_boxes
    expected_bbox_path: ground_truth_boxes
    threshold: 0.7
    format: xyxy  # or xywh, polygon
  
  - name: coordinate_precision
    type: coordinate_distance
    point_path: extracted_coordinates
    expected_point_path: reference_coordinates
    metric: euclidean  # or manhattan, cosine
    threshold: 10.0  # pixels or units
```

**Capabilities:**
- **IoU (Intersection over Union)**: Standard metric for bounding box overlap
- **Distance metrics**: Euclidean, Manhattan, or cosine distance for point/coordinate comparison
- **Format flexibility**: Supports multiple bounding box formats (xyxy, xywh, polygon vertices)
- **Batch evaluation**: Automatically handles arrays of boxes/points

## Design Principles Alignment

✅ **Lightweight Core, Plugin Extensibility**: These are universal primitives applicable to many domains, not domain-specific logic. Field comparison, fuzzy matching, and IoU are used across document processing, CV, data validation, and testing.

✅ **Built-ins for Primitives Only**: Each evaluator is stateless, deterministic, has single responsibility, cannot be trivially composed from other primitives, and needed by majority of users doing structured output evaluation.

✅ **Align with Industry Standards**: IoU is the standard metric in computer vision (COCO, PASCAL VOC). Levenshtein distance is the standard for fuzzy string matching. Field-level accuracy with precision/recall is used in Azure Form Recognizer, Google ADK, and document AI literature.

✅ **Non-Breaking Extensions**: All new evaluator types are optional. Existing `llm_judge`, `code_judge`, `rubric`, and `tool_trajectory` evaluators continue working unchanged.

## Capabilities Affected

This change introduces **two new capabilities** and updates one existing capability:

1. **`structured-data-evaluators` (NEW)** - Field accuracy and schema validation primitives
2. **`geometric-evaluators` (NEW)** - IoU and coordinate distance metrics
3. **`yaml-schema` (MODIFIED)** - Extends evaluator type union to include new types

## Out of Scope

The following remain external to AgentV core (implemented via plugins or `code_judge` scripts):

- ❌ PDF/image processing (parsing, OCR, layout detection)
- ❌ Azure SDK integrations (Form Recognizer API wrappers)
- ❌ Domain-specific validators (invoice schema, customs forms, medical records)
- ❌ SQL database schema validation
- ❌ Confidence score extraction from external APIs
- ❌ Dataset version management (Phase 1 only adds split support)

## Success Criteria

1. Users can evaluate structured data extraction (e.g., invoice parsing) without writing custom code
2. Bounding box evaluation uses industry-standard IoU metrics
3. Fuzzy matching handles OCR errors and formatting variations
4. All existing tests pass; new evaluators have >90% test coverage
5. Documentation includes examples for document extraction and object detection use cases
6. Performance: <10ms overhead per field comparison, <5ms per bbox IoU calculation

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

3. **Fuzzy threshold defaults**: What's reasonable default for fuzzy match threshold?
   - **Recommendation**: 0.85 (based on Azure Cognitive Search and Elasticsearch defaults)

4. **IoU threshold**: Binary pass/fail or graded scoring?
   - **Recommendation**: Graded scoring (IoU value as score) with optional threshold for pass/fail verdict

5. **Dataset split support**: Should this proposal include train/test/validation splits?
   - **Recommendation**: Defer to separate proposal focused on dataset management (keep this focused on evaluators)

## References

- [Azure AI Document Intelligence SDK](https://github.com/Azure/azure-sdk-for-python/tree/main/sdk/formrecognizer) - `DocumentTableCell`, `BoundingBox`, field extraction patterns
- [Google ADK-Python Evaluation](https://github.com/google/adk-python/tree/main/src/evaluation) - Confusion matrix, rubric evaluators
- [LangWatch Evaluation Wizard](https://github.com/langwatch/langwatch/tree/main/src/components/evaluations/wizard) - Structured results, dataset management
- [Mastra Scorers](https://github.com/mastra-ai/mastra/tree/main/packages/evals/src/scorers) - Content similarity, prompt alignment
- [IoU Metric (Wikipedia)](https://en.wikipedia.org/wiki/Jaccard_index) - Standard definition and usage
- COCO Dataset Evaluation Metrics - Industry standard for object detection

## Next Steps

1. Review and approve this proposal
2. Implement spec deltas for `structured-data-evaluators` and `geometric-evaluators`
3. Implement evaluators in `packages/core/src/evaluation/evaluators.ts`
4. Add YAML schema extensions and validation
5. Write comprehensive tests and examples
6. Update documentation with use case guides
