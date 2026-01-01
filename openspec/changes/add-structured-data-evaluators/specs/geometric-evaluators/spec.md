# Spec: Geometric Evaluators

## Purpose
Provides universal primitives for spatial and geometric comparisons, including IoU (Intersection over Union) for bounding box evaluation and distance metrics for coordinate comparison, commonly used in computer vision, document layout analysis, and object detection tasks.

## ADDED Requirements

### Requirement: IoU Score Evaluator MUST support XYXY format

The system SHALL provide an `iou_score` evaluator that calculates Intersection over Union for bounding boxes in XYXY format (x1, y1, x2, y2).

#### Scenario: Perfect overlap returns IoU of 1.0
- **GIVEN** extracted bbox `[10, 10, 50, 50]` (XYXY format)
- **AND** expected bbox `[10, 10, 50, 50]`
- **AND** evaluator configured with:
  ```yaml
  evaluators:
    - type: iou_score
      bbox_path: detected_box
      expected_bbox_path: ground_truth_box
      format: xyxy
  ```
- **WHEN** IoU is calculated
- **THEN** score = 1.0 (perfect match)
- **AND** verdict = "pass"

#### Scenario: Partial overlap returns proportional IoU
- **GIVEN** extracted bbox `[10, 10, 30, 30]` (area = 400)
- **AND** expected bbox `[20, 20, 40, 40]` (area = 400)
- **AND** intersection area = 100 (overlap region [20,20,30,30])
- **WHEN** IoU is calculated
- **THEN** IoU = intersection / union = 100 / (400 + 400 - 100) = 100 / 700 ≈ 0.143
- **AND** score = 0.143

#### Scenario: No overlap returns IoU of 0.0
- **GIVEN** extracted bbox `[10, 10, 20, 20]`
- **AND** expected bbox `[50, 50, 60, 60]`
- **WHEN** IoU is calculated
- **THEN** score = 0.0 (no intersection)
- **AND** verdict = "fail"

### Requirement: IoU Score Evaluator MUST support XYWH format

The system SHALL support bounding boxes in XYWH format (x, y, width, height) with automatic conversion.

#### Scenario: XYWH format conversion and IoU calculation
- **GIVEN** extracted bbox `[10, 10, 40, 40]` (XYWH: x=10, y=10, w=40, h=40)
- **AND** expected bbox `[10, 10, 40, 40]` (XYWH)
- **AND** evaluator configured with `format: xywh`
- **WHEN** IoU is calculated
- **THEN** boxes are converted to XYXY internally: [10, 10, 50, 50]
- **AND** score = 1.0

#### Scenario: Partial overlap with XYWH format
- **GIVEN** extracted bbox `[10, 10, 20, 20]` (XYWH)
- **AND** expected bbox `[15, 15, 20, 20]` (XYWH)
- **WHEN** IoU is calculated
- **THEN** converted to XYXY: [10, 10, 30, 30] and [15, 15, 35, 35]
- **AND** IoU is computed based on intersection/union

### Requirement: IoU Score Evaluator MUST support polygon format

The system SHALL support arbitrary polygons defined by vertex coordinates with polygon intersection calculation.

#### Scenario: Polygon defined by 4 vertices
- **GIVEN** extracted polygon `[[10,10], [50,10], [50,50], [10,50]]`
- **AND** expected polygon `[[10,10], [50,10], [50,50], [10,50]]`
- **AND** evaluator configured with `format: polygon`
- **WHEN** IoU is calculated
- **THEN** polygon intersection area is computed
- **AND** polygon union area is computed
- **AND** score = intersection / union

#### Scenario: Rotated polygon vs axis-aligned box
- **GIVEN** extracted polygon representing rotated rectangle
- **AND** expected polygon representing axis-aligned rectangle
- **WHEN** IoU is calculated
- **THEN** generic polygon intersection algorithm is used
- **AND** score reflects geometric overlap

### Requirement: IoU Score Evaluator MUST support batch evaluation

The system SHALL evaluate multiple bounding boxes and return aggregate scores.

#### Scenario: Array of bounding boxes with matching
- **GIVEN** extracted data `{ detected_boxes: [[10,10,50,50], [60,60,100,100]] }`
- **AND** expected data `{ ground_truth_boxes: [[10,10,50,50], [60,60,100,100]] }`
- **AND** evaluator configured with array paths
- **WHEN** batch evaluation executes
- **THEN** IoU is computed for each pair: [1.0, 1.0]
- **AND** aggregate score is mean IoU: 1.0

#### Scenario: One-to-one matching with Hungarian algorithm
- **GIVEN** 3 detected boxes and 3 ground truth boxes
- **AND** no predefined correspondence
- **WHEN** batch evaluation executes
- **THEN** optimal matching is computed (maximize total IoU)
- **AND** per-box IoU scores are calculated
- **AND** mean IoU is returned as aggregate score

#### Scenario: Mismatched array lengths
- **GIVEN** 2 detected boxes but 3 ground truth boxes
- **WHEN** batch evaluation executes
- **THEN** matching is performed for available pairs
- **AND** unmatched ground truth boxes contribute 0.0 to recall
- **AND** precision/recall metrics are computed

### Requirement: IoU Score Evaluator MUST support threshold-based verdicts

The system SHALL allow configurable IoU thresholds to determine pass/fail verdicts.

#### Scenario: Pass with IoU above threshold
- **GIVEN** calculated IoU = 0.75
- **AND** evaluator configured with `threshold: 0.7`
- **WHEN** verdict is determined
- **THEN** verdict = "pass" (0.75 > 0.7)
- **AND** score = 0.75 (continuous value preserved)

#### Scenario: Fail with IoU below threshold
- **GIVEN** calculated IoU = 0.65
- **AND** evaluator configured with `threshold: 0.7`
- **WHEN** verdict is determined
- **THEN** verdict = "fail" (0.65 < 0.7)
- **AND** score = 0.65

#### Scenario: No threshold uses graded scoring only
- **GIVEN** calculated IoU = 0.55
- **AND** evaluator configured without threshold
- **WHEN** verdict is determined
- **THEN** score = 0.55
- **AND** verdict = "partial" (based on score range)

### Requirement: Coordinate Distance Evaluator MUST support Euclidean distance

The system SHALL calculate Euclidean distance between extracted and expected coordinates.

#### Scenario: 2D coordinate distance calculation
- **GIVEN** extracted point `[10, 20]`
- **AND** expected point `[13, 24]`
- **AND** evaluator configured with:
  ```yaml
  evaluators:
    - type: coordinate_distance
      point_path: extracted_center
      expected_point_path: reference_center
      metric: euclidean
      threshold: 10.0
  ```
- **WHEN** distance is calculated
- **THEN** distance = sqrt((13-10)² + (24-20)²) = sqrt(9 + 16) = 5.0
- **AND** score = 1.0 (within threshold)

#### Scenario: 3D coordinate distance
- **GIVEN** extracted point `[10, 20, 30]`
- **AND** expected point `[13, 24, 32]`
- **WHEN** Euclidean distance is calculated
- **THEN** distance = sqrt((13-10)² + (24-20)² + (32-30)²) = sqrt(9 + 16 + 4) ≈ 5.385

#### Scenario: Distance exceeds threshold
- **GIVEN** extracted point `[10, 10]`
- **AND** expected point `[50, 50]`
- **AND** threshold: 10.0
- **WHEN** distance is calculated
- **THEN** distance = sqrt((50-10)² + (50-10)²) ≈ 56.57
- **AND** score = 0.0 (exceeds threshold)
- **AND** verdict = "fail"

### Requirement: Coordinate Distance Evaluator MUST support Manhattan distance

The system SHALL calculate Manhattan (L1) distance as an alternative metric.

#### Scenario: Manhattan distance calculation
- **GIVEN** extracted point `[10, 20]`
- **AND** expected point `[13, 24]`
- **AND** evaluator configured with `metric: manhattan`
- **WHEN** distance is calculated
- **THEN** distance = |13-10| + |24-20| = 3 + 4 = 7

#### Scenario: Manhattan vs Euclidean comparison
- **GIVEN** same points `[10, 20]` and `[13, 24]`
- **WHEN** both metrics are calculated
- **THEN** Euclidean = 5.0
- **AND** Manhattan = 7.0
- **AND** Manhattan distance is always >= Euclidean

### Requirement: Coordinate Distance Evaluator MUST support Cosine distance

The system SHALL calculate cosine distance for angular similarity between coordinate vectors.

#### Scenario: Cosine distance for direction similarity
- **GIVEN** extracted vector `[1, 0]`
- **AND** expected vector `[0.707, 0.707]` (45° rotation)
- **AND** evaluator configured with `metric: cosine`
- **WHEN** distance is calculated
- **THEN** cosine_similarity = dot(v1, v2) / (||v1|| * ||v2||)
- **AND** cosine_distance = 1 - cosine_similarity
- **AND** score reflects angular alignment

#### Scenario: Identical direction vectors
- **GIVEN** extracted vector `[3, 4]`
- **AND** expected vector `[6, 8]` (same direction, different magnitude)
- **WHEN** cosine distance is calculated
- **THEN** cosine_similarity = 1.0 (identical direction)
- **AND** cosine_distance = 0.0
- **AND** score = 1.0

### Requirement: Coordinate Distance Evaluator MUST support batch evaluation

The system SHALL evaluate multiple coordinate pairs and return aggregate metrics.

#### Scenario: Array of coordinate pairs
- **GIVEN** extracted points `[[10,10], [20,20], [30,30]]`
- **AND** expected points `[[11,11], [21,19], [29,32]]`
- **AND** evaluator configured with threshold: 5.0
- **WHEN** batch evaluation executes
- **THEN** distance computed for each pair: [1.41, 2.24, 3.16]
- **AND** all within threshold
- **AND** aggregate score = mean(scores) = 1.0

#### Scenario: Mixed results in batch
- **GIVEN** 5 coordinate pairs with distances [2, 4, 8, 15, 3]
- **AND** threshold: 10.0
- **WHEN** batch evaluation executes
- **THEN** passes: 4, fails: 1
- **AND** aggregate score = 4/5 = 0.8

### Requirement: Geometric Evaluators MUST handle invalid inputs gracefully

The system SHALL validate input formats and handle errors without throwing exceptions.

#### Scenario: Invalid bbox coordinates
- **GIVEN** extracted bbox `[50, 50, 10, 10]` (x2 < x1, y2 < y1)
- **WHEN** IoU evaluator processes bbox
- **THEN** validation error is logged
- **AND** score = 0.0
- **AND** `misses` includes "Invalid bounding box format"

#### Scenario: Mismatched coordinate dimensions
- **GIVEN** extracted point `[10, 20]` (2D)
- **AND** expected point `[10, 20, 30]` (3D)
- **WHEN** distance evaluator processes coordinates
- **THEN** validation error is logged
- **AND** score = 0.0
- **AND** reasoning explains dimension mismatch

#### Scenario: Non-numeric coordinate values
- **GIVEN** extracted point `["10", "20"]` (strings instead of numbers)
- **WHEN** evaluator processes coordinates
- **THEN** type coercion is attempted
- **AND** if coercion fails, score = 0.0 with error message

### Requirement: Geometric Evaluators configuration MUST be validated

The system SHALL validate evaluator configuration at YAML parse time.

#### Scenario: Reject invalid bbox format
- **GIVEN** evaluator configured with `format: invalid_format`
- **WHEN** YAML parser loads config
- **THEN** validation fails with error "Invalid bbox format: invalid_format"
- **AND** suggests valid formats: xyxy, xywh, polygon

#### Scenario: Reject invalid distance metric
- **GIVEN** evaluator configured with `metric: invalid_metric`
- **WHEN** YAML parser loads config
- **THEN** validation fails with error "Invalid distance metric: invalid_metric"
- **AND** suggests valid metrics: euclidean, manhattan, cosine

#### Scenario: Require threshold for distance evaluator
- **GIVEN** coordinate_distance evaluator without `threshold`
- **WHEN** validation runs
- **THEN** warning is logged
- **AND** default threshold is applied (or evaluation proceeds with graded scoring only)

### Requirement: Geometric Evaluators MUST return structured results

The system SHALL return evaluation results with `score`, `verdict`, `hits`, `misses`, and geometric metadata.

#### Scenario: IoU result with metadata
- **GIVEN** IoU calculation completes with score 0.75
- **WHEN** result is returned
- **THEN** result includes:
  - `score: 0.75`
  - `verdict: "pass"` (if above threshold)
  - `hits: ["bbox matches above 0.7"]`
  - `misses: []`
  - `metadata: { iou: 0.75, intersection_area: 300, union_area: 400 }`

#### Scenario: Distance result with metadata
- **GIVEN** distance calculation with Euclidean distance 5.2
- **WHEN** result is returned
- **THEN** result includes:
  - `score: 1.0` (if within threshold) or graded score
  - `verdict: "pass"`
  - `metadata: { distance: 5.2, metric: "euclidean", threshold: 10.0 }`

### Requirement: Geometric Evaluators MUST support precision/recall metrics for detection tasks

The system SHALL compute precision, recall, and F1 score when evaluating object detection results.

#### Scenario: Perfect detection
- **GIVEN** 3 detected boxes, 3 ground truth boxes, all with IoU > threshold
- **WHEN** precision/recall is computed
- **THEN** precision = 3/3 = 1.0 (all detections correct)
- **AND** recall = 3/3 = 1.0 (all ground truths detected)
- **AND** F1 = 2 * (1.0 * 1.0) / (1.0 + 1.0) = 1.0

#### Scenario: False positives present
- **GIVEN** 5 detected boxes, 3 ground truth boxes, only 3 matched above threshold
- **WHEN** precision/recall is computed
- **THEN** precision = 3/5 = 0.6 (2 false positives)
- **AND** recall = 3/3 = 1.0 (all ground truths detected)
- **AND** F1 = 2 * (0.6 * 1.0) / (0.6 + 1.0) = 0.75

#### Scenario: False negatives present
- **GIVEN** 2 detected boxes, 5 ground truth boxes, only 2 matched
- **WHEN** precision/recall is computed
- **THEN** precision = 2/2 = 1.0 (no false positives)
- **AND** recall = 2/5 = 0.4 (3 missed detections)
- **AND** F1 = 2 * (1.0 * 0.4) / (1.0 + 0.4) ≈ 0.571
