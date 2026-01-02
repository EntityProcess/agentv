# Design: Structured Data Evaluators

**Change ID:** `add-structured-data-evaluators`

## Overview

This document explains the architectural decisions and implementation patterns for adding field accuracy and geometric evaluators to AgentV. These evaluators follow the same patterns as existing evaluators (`LlmJudgeEvaluator`, `ToolTrajectoryEvaluator`) but introduce new computational primitives for structured data comparison.

## Core Design Decisions

### 1. Evaluator Registration Pattern

**Decision**: Follow the existing factory pattern used in `orchestrator.ts`.

**Rationale**: Consistency with current architecture minimizes changes and maintains predictable behavior.

**Implementation**:
```typescript
// packages/core/src/evaluation/evaluators.ts

export class FieldAccuracyEvaluator implements Evaluator {
  readonly kind = 'field_accuracy';
  
  constructor(private readonly config: FieldAccuracyEvaluatorConfig) {}
  
  evaluate(context: EvaluationContext): EvaluationScore {
    // Implementation
  }
}

export class IoUScoreEvaluator implements Evaluator {
  readonly kind = 'iou_score';
  
  constructor(private readonly config: IoUScoreEvaluatorConfig) {}
  
  evaluate(context: EvaluationContext): EvaluationScore {
    // Implementation
  }
}
```

**Registration** in orchestrator:
```typescript
// Based on evaluator config type, instantiate appropriate evaluator
if (config.type === 'field_accuracy') {
  return new FieldAccuracyEvaluator(config);
}
if (config.type === 'iou_score') {
  return new IoUScoreEvaluator(config);
}
```

### 2. Field Path Resolution Strategy

**Decision**: Use **lodash `get`** for nested field access with dot notation.

**Rationale**:
- Battle-tested implementation handling edge cases
- Supports array indexing (`items[0].amount`)
- Minimal dependency (already common in TypeScript projects)
- Returns `undefined` for invalid paths (no exceptions)

**Alternative Considered**: Custom implementation
- **Rejected**: Would require extensive testing for edge cases, array handling, and performance optimization

**Example**:
```typescript
import { get } from 'lodash';

function resolveFieldPath(data: JsonObject, path: string): JsonValue | undefined {
  return get(data, path);
}

// Usage
const data = { invoice: { vendor: { name: "Acme" } } };
const value = resolveFieldPath(data, 'invoice.vendor.name'); // "Acme"
```

### 3. Fuzzy Matching via code_judge with Config Pass-Through

**Decision**: Provide fuzzy matching as `code_judge` examples rather than built-in evaluator.

**Rationale**:
- Follows AgentV's "lightweight core" principle
- Fuzzy matching requirements vary widely (algorithms, normalization, thresholds per field)
- Industry research shows varied approaches (Google ADK uses LLM-as-Judge, Mastra uses Dice's via npm)
- Config pass-through enables reusable scripts without hardcoding

**Implementation**: Any unrecognized YAML properties on `code_judge` are passed to the script via `config` in stdin:

```yaml
evaluators:
  - name: party_names_fuzzy
    type: code_judge
    script: ./multi_field_fuzzy.ts
    # These become config.fields and config.algorithm in stdin
    fields:
      - path: supplier.name
        threshold: 0.85
      - path: importer.name
        threshold: 0.90
    algorithm: levenshtein
```

**Stdin Payload**:
```json
{
  "candidate_answer": "...",
  "reference_answer": "...",
  "config": {
    "fields": [
      { "path": "supplier.name", "threshold": 0.85 },
      { "path": "importer.name", "threshold": 0.90 }
    ],
    "algorithm": "levenshtein"
  }
}
```

**Example Scripts Provided**:
- `multi_field_fuzzy.ts` - Configurable multi-field fuzzy matcher (Levenshtein + Jaro-Winkler)
- `fuzzy_match.ts` - Generic single-value fuzzy matcher
- (Removed) `supplier_name_fuzzy.ts` - superseded by configurable `multi_field_fuzzy.ts`

### 4. Numeric Tolerance Comparison

**Decision**: Support both **absolute** and **relative** tolerance with explicit configuration.

**Rationale**:
- Absolute tolerance: Fixed threshold (e.g., ±$0.01 for currency)
- Relative tolerance: Percentage-based (e.g., ±2% for large amounts)
- Users must explicitly choose via `relative: true/false` flag

**Implementation**:
```typescript
interface NumericToleranceConfig {
  tolerance: number;
  relative: boolean;
}

function compareNumericTolerance(
  actual: number,
  expected: number,
  config: NumericToleranceConfig
): boolean {
  if (config.relative) {
    // Relative: |actual - expected| / |expected| <= tolerance
    const diff = Math.abs(actual - expected);
    const relativeDiff = expected === 0 ? diff : diff / Math.abs(expected);
    return relativeDiff <= config.tolerance;
  } else {
    // Absolute: |actual - expected| <= tolerance
    return Math.abs(actual - expected) <= config.tolerance;
  }
}
```

**Edge Cases**:
- Division by zero when `expected === 0` in relative mode → treat as absolute
- `Infinity` or `NaN` values → always fail with clear error message
- `null` or `undefined` → treated as missing value, not 0

### 5. Aggregation Strategies

**Decision**: Implement **weighted_average** (default) and **all_or_nothing** aggregation.

**Rationale**:
- Weighted average: Reflects real-world importance of fields
- All-or-nothing: Strict requirement when any failure is critical
- Mirrors existing patterns in `CompositeEvaluator` (composite evaluators already use weights)

**Implementation**:
```typescript
function aggregateFieldScores(
  fieldScores: Array<{ score: number; weight: number }>,
  method: 'weighted_average' | 'all_or_nothing'
): number {
  if (method === 'all_or_nothing') {
    return fieldScores.every(f => f.score === 1.0) ? 1.0 : 0.0;
  }
  
  // weighted_average (default)
  const totalWeight = fieldScores.reduce((sum, f) => sum + f.weight, 0);
  if (totalWeight === 0) return 0;
  
  const weightedSum = fieldScores.reduce((sum, f) => sum + f.score * f.weight, 0);
  return weightedSum / totalWeight;
}
```

### 6. IoU Calculation Strategy

**Decision**: Implement format-specific calculators with internal conversion to canonical form.

**Rationale**:
- Canonical form (XYXY) simplifies intersection/union calculation
- Conversion is cheap (4 arithmetic operations)
- Supports extensibility (new formats can be added via converters)

**Architecture**:
```typescript
interface BoundingBox {
  format: 'xyxy' | 'xywh' | 'polygon';
  coordinates: number[] | number[][];
}

function toXYXY(bbox: BoundingBox): [number, number, number, number] {
  if (bbox.format === 'xyxy') {
    return bbox.coordinates as [number, number, number, number];
  }
  if (bbox.format === 'xywh') {
    const [x, y, w, h] = bbox.coordinates as number[];
    return [x, y, x + w, y + h];
  }
  // Polygon: compute bounding rectangle
  const coords = bbox.coordinates as number[][];
  const xs = coords.map(p => p[0]);
  const ys = coords.map(p => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function calculateIoU(bbox1: BoundingBox, bbox2: BoundingBox): number {
  const [x1_1, y1_1, x2_1, y2_1] = toXYXY(bbox1);
  const [x1_2, y1_2, x2_2, y2_2] = toXYXY(bbox2);
  
  // Intersection
  const xA = Math.max(x1_1, x1_2);
  const yA = Math.max(y1_1, y1_2);
  const xB = Math.min(x2_1, x2_2);
  const yB = Math.min(y2_1, y2_2);
  
  const intersectionArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
  
  // Areas
  const area1 = (x2_1 - x1_1) * (y2_1 - y1_1);
  const area2 = (x2_2 - x1_2) * (y2_2 - y1_2);
  
  const unionArea = area1 + area2 - intersectionArea;
  
  return unionArea === 0 ? 0 : intersectionArea / unionArea;
}
```

**Polygon IoU**: For true polygon support (beyond bounding rectangles), use **Sutherland-Hodgman algorithm** or external geometry library only if requested. Start with bounding-box approximation for simplicity.

### 7. Distance Metrics Implementation

**Decision**: Implement Euclidean, Manhattan, and Cosine distance as separate functions with shared signature.

**Rationale**:
- Each metric has different use cases:
  - **Euclidean**: General spatial proximity
  - **Manhattan**: Grid-based movement, city-block distance
  - **Cosine**: Directional similarity, invariant to magnitude
- Simple algorithms (~10 LOC each)
- No dependencies needed

**Implementation**:
```typescript
function euclideanDistance(p1: number[], p2: number[]): number {
  if (p1.length !== p2.length) throw new Error('Dimension mismatch');
  return Math.sqrt(p1.reduce((sum, v, i) => sum + (v - p2[i]) ** 2, 0));
}

function manhattanDistance(p1: number[], p2: number[]): number {
  if (p1.length !== p2.length) throw new Error('Dimension mismatch');
  return p1.reduce((sum, v, i) => sum + Math.abs(v - p2[i]), 0);
}

function cosineDistance(p1: number[], p2: number[]): number {
  if (p1.length !== p2.length) throw new Error('Dimension mismatch');
  const dot = p1.reduce((sum, v, i) => sum + v * p2[i], 0);
  const mag1 = Math.sqrt(p1.reduce((sum, v) => sum + v ** 2, 0));
  const mag2 = Math.sqrt(p2.reduce((sum, v) => sum + v ** 2, 0));
  if (mag1 === 0 || mag2 === 0) return 1.0; // Maximum distance
  return 1.0 - dot / (mag1 * mag2);
}
```

### 8. Batch Evaluation Strategy

**Decision**: For arrays, evaluate each pair and aggregate using **mean** by default.

**Rationale**:
- Simple, understandable metric
- Aligns with COCO dataset evaluation (mean Average Precision)
- Supports future extensions (weighted mean, median, etc.)

**Hungarian Algorithm**: For optimal bbox matching (when no correspondence is given), defer to Phase 2. Use simple index-based matching in Phase 1.

**Implementation**:
```typescript
function evaluateBatch(
  detectedItems: JsonValue[],
  expectedItems: JsonValue[],
  evaluateOne: (detected: JsonValue, expected: JsonValue) => number
): number {
  if (detectedItems.length !== expectedItems.length) {
    // Simple strategy: pair by index, penalize mismatches
    const maxLen = Math.max(detectedItems.length, expectedItems.length);
    let totalScore = 0;
    for (let i = 0; i < maxLen; i++) {
      if (i < detectedItems.length && i < expectedItems.length) {
        totalScore += evaluateOne(detectedItems[i], expectedItems[i]);
      }
      // Missing items contribute 0
    }
    return totalScore / maxLen;
  }
  
  // Equal lengths: straightforward pairing
  const scores = detectedItems.map((detected, i) => 
    evaluateOne(detected, expectedItems[i])
  );
  return scores.reduce((sum, s) => sum + s, 0) / scores.length;
}
```

### 9. Error Handling Philosophy

**Decision**: **Never throw exceptions** from evaluators; always return score 0.0 with descriptive error in `misses`.

**Rationale**:
- Evaluations should complete even with malformed data
- Users need visibility into what went wrong
- Consistent with existing evaluator behavior (see `LlmJudgeEvaluator`)

**Pattern**:
```typescript
try {
  const value = resolveFieldPath(data, field.path);
  if (value === undefined) {
    return {
      score: 0.0,
      verdict: 'fail',
      hits: [],
      misses: [`${field.path} (missing or invalid path)`],
      reasoning: 'Field not found in extracted data'
    };
  }
  // Continue evaluation...
} catch (error) {
  return {
    score: 0.0,
    verdict: 'fail',
    hits: [],
    misses: [`${field.path} (evaluation error: ${error.message})`],
    reasoning: 'Unexpected error during field evaluation'
  };
}
```

### 10. Performance Optimization Targets

**Decision**: Target **<10ms per field comparison**, **<5ms per IoU calculation**.

**Rationale**:
- Typical eval datasets have 10-100 test cases
- 10 fields per case → 100-1000 comparisons
- At 10ms/field: 1-10 seconds total overhead (acceptable)
- IoU is computationally cheap (few arithmetic operations)

**Optimization Strategies**:
- Avoid JSON serialization in hot paths
- Cache field path resolutions when possible
- Use typed arrays for coordinate calculations
- Profile with realistic datasets (100+ cases)

**Benchmark Suite**: Add microbenchmarks in `packages/core/test/benchmarks/` to track performance regression.

## Testing Strategy

### Unit Tests
- **Field accuracy**: All match types (exact, numeric_tolerance, date) with edge cases
- **Fuzzy matching via code_judge**: Example scripts with config pass-through
- **Numeric tolerance**: Absolute and relative modes, edge cases (null, infinity, NaN)
- **IoU calculation**: All formats (xyxy, xywh, polygon), perfect/partial/no overlap
- **Distance metrics**: All three metrics (Euclidean, Manhattan, Cosine), 2D/3D
- **Batch evaluation**: Various array lengths, empty arrays, mixed results

### Integration Tests
- **End-to-end eval runs**: Load YAML, execute evaluators, verify results structure
- **Error handling**: Malformed configs, invalid data, missing fields
- **Performance**: Benchmark targets (<10ms field, <5ms IoU)

### Test Data
- **Invoice extraction**: Real-world fields (amounts, dates, vendor names)
- **Document layout**: Bounding boxes from OCR/layout analysis
- **Coordinate datasets**: Object detection results (COCO-style)

## Migration Path for Existing Users

Users with custom `code_judge` scripts can migrate to built-in evaluators:

**Before** (code_judge script):
```typescript
// validate_fields.ts
const extracted = JSON.parse(process.argv[1]);
const expected = JSON.parse(process.argv[2]);

let score = 0;
if (extracted.invoice.number === expected.invoice.number) score += 0.5;
if (Math.abs(extracted.invoice.total - expected.invoice.total) < 0.01) score += 0.5;

console.log(JSON.stringify({ score }));
```

**After** (built-in evaluator):
```yaml
evaluators:
  - type: field_accuracy
    fields:
      - path: invoice.number
        match: exact
        weight: 0.5
      - path: invoice.total
        match: numeric_tolerance
        tolerance: 0.01
        weight: 0.5
    aggregation: weighted_average
```

**Benefits**:
- No external script management
- Declarative configuration
- Built-in validation and error messages
- Consistent scoring across projects

## Future Extensions

These are **explicitly deferred** to future proposals:

1. **Semantic similarity**: Embedding-based field comparison (requires LLM integration)
2. **Hungarian matching**: Optimal bbox assignment for detection tasks
3. **Precision/Recall/F1 as first-class metrics**: Currently computed in post-processing
4. **Dataset split management**: Train/test/validation workflow (separate proposal)
5. **Schema validation evaluator**: JSON Schema compliance checking
6. **Multi-field dependency validation**: Cross-field constraints (e.g., "if field A, then field B required")

## Open Questions & Resolutions

| Question | Resolution |
|----------|-----------|
| Should fuzzy matching be built-in? | **No** - provide as code_judge examples with config pass-through (lightweight core principle) |
| Use lodash or custom field resolver? | **lodash** - battle-tested, handles edge cases |
| Support JSONPath syntax? | **No** - dot notation sufficient for Phase 1, add later if needed |
| Polygon IoU algorithm? | **Bounding box approximation** for Phase 1, defer Sutherland-Hodgman |
| Hungarian matching for bbox arrays? | **Defer to Phase 2** - use index-based pairing initially |
| Include dataset splits in this change? | **No** - separate proposal focused on dataset management |

## Validation

- ✅ Aligns with existing evaluator patterns (`LlmJudgeEvaluator`, `ToolTrajectoryEvaluator`)
- ✅ No breaking changes to existing evaluators
- ✅ Follows AgentV's "lightweight core" principle (universal primitives only)
- ✅ Industry-standard metrics (IoU, Levenshtein, etc.)
- ✅ Comprehensive error handling without exceptions
- ✅ Performance targets defined and achievable
- ✅ Clear migration path for existing users
