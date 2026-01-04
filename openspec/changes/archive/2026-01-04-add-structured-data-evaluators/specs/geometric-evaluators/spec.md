# Spec: Geometric Evaluators (Plugin Approach)

## Purpose

This document describes geometric evaluation capabilities (IoU for bounding boxes, coordinate distance metrics) that are **recommended for implementation as `code_judge` plugins** rather than built-in evaluators.

## Rationale for Plugin Approach

After reviewing AgentV's design principles, geometric evaluators are better suited as plugins because:

1. **Algorithm Complexity**: IoU for polygons requires Sutherland-Hodgman clipping. Optimal bbox matching requires Hungarian algorithm (O(n³)). These add significant code complexity.

2. **Limited Universality**: Most AgentV users evaluate text/structured data. Bounding box evaluation is domain-specific to computer vision and document layout analysis.

3. **Dependency Concerns**: Robust polygon operations benefit from libraries like `shapely` (Python) or `turf` (JS), adding dependencies.

4. **Easy Plugin Path**: A simple `code_judge` script can compute IoU in ~30 lines, giving users full control over matching logic.

## Recommended Implementation: `code_judge` Scripts

### Basic IoU Evaluator (Python)

```python
#!/usr/bin/env python3
"""
IoU (Intersection over Union) evaluator for bounding boxes.
Expects XYXY format: [x1, y1, x2, y2]

Usage in dataset.yaml:
  evaluators:
    - name: bbox_iou
      type: code_judge
      path: ./evaluators/iou_evaluator.py
"""
import json
import sys

def compute_iou(box1: list, box2: list) -> float:
    """Compute IoU for two XYXY bounding boxes."""
    # Intersection coordinates
    x1 = max(box1[0], box2[0])
    y1 = max(box1[1], box2[1])
    x2 = min(box1[2], box2[2])
    y2 = min(box1[3], box2[3])

    # Intersection area
    inter_width = max(0, x2 - x1)
    inter_height = max(0, y2 - y1)
    inter_area = inter_width * inter_height

    # Union area
    box1_area = (box1[2] - box1[0]) * (box1[3] - box1[1])
    box2_area = (box2[2] - box2[0]) * (box2[3] - box2[1])
    union_area = box1_area + box2_area - inter_area

    return inter_area / union_area if union_area > 0 else 0.0


def main():
    data = json.load(sys.stdin)

    # Extract bboxes from candidate and reference
    # Adjust paths based on your data structure
    candidate = data.get("candidate_answer", {})
    reference = data.get("reference_answer", {})

    extracted_bbox = candidate.get("bbox") or candidate.get("bounding_box")
    expected_bbox = reference.get("bbox") or reference.get("bounding_box")

    if not extracted_bbox or not expected_bbox:
        print(json.dumps({
            "score": 0.0,
            "hits": [],
            "misses": ["Missing bounding box data"],
            "reasoning": "Could not find bbox in candidate or reference"
        }))
        return

    iou = compute_iou(extracted_bbox, expected_bbox)
    threshold = 0.5  # Configurable threshold

    result = {
        "score": iou,
        "hits": [f"IoU: {iou:.3f}"] if iou >= threshold else [],
        "misses": [] if iou >= threshold else [f"IoU below threshold: {iou:.3f} < {threshold}"],
        "reasoning": f"Bounding box IoU = {iou:.3f}"
    }

    print(json.dumps(result))


if __name__ == "__main__":
    main()
```

### Batch IoU with Matching (Python)

For evaluating multiple bounding boxes with optimal matching:

```python
#!/usr/bin/env python3
"""
Batch IoU evaluator with greedy matching.
For true optimal matching, use scipy.optimize.linear_sum_assignment (Hungarian algorithm).
"""
import json
import sys
from typing import List, Tuple


def compute_iou(box1: list, box2: list) -> float:
    x1 = max(box1[0], box2[0])
    y1 = max(box1[1], box2[1])
    x2 = min(box1[2], box2[2])
    y2 = min(box1[3], box2[3])

    inter_area = max(0, x2 - x1) * max(0, y2 - y1)
    box1_area = (box1[2] - box1[0]) * (box1[3] - box1[1])
    box2_area = (box2[2] - box2[0]) * (box2[3] - box2[1])
    union_area = box1_area + box2_area - inter_area

    return inter_area / union_area if union_area > 0 else 0.0


def greedy_match(detected: List[list], ground_truth: List[list], threshold: float = 0.5) -> Tuple[int, int, float]:
    """
    Greedy matching: for each ground truth, find best unmatched detection.
    Returns (true_positives, false_negatives, mean_iou_of_matches)
    """
    matched_detections = set()
    matches = []

    for gt_box in ground_truth:
        best_iou = 0.0
        best_idx = -1

        for idx, det_box in enumerate(detected):
            if idx in matched_detections:
                continue
            iou = compute_iou(gt_box, det_box)
            if iou > best_iou:
                best_iou = iou
                best_idx = idx

        if best_iou >= threshold and best_idx >= 0:
            matched_detections.add(best_idx)
            matches.append(best_iou)

    tp = len(matches)
    fn = len(ground_truth) - tp
    fp = len(detected) - tp
    mean_iou = sum(matches) / len(matches) if matches else 0.0

    return tp, fp, fn, mean_iou


def main():
    data = json.load(sys.stdin)

    candidate = data.get("candidate_answer", {})
    reference = data.get("reference_answer", {})

    detected = candidate.get("boxes", [])
    ground_truth = reference.get("boxes", [])
    threshold = 0.5

    tp, fp, fn, mean_iou = greedy_match(detected, ground_truth, threshold)

    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0

    hits = []
    misses = []

    if tp > 0:
        hits.append(f"Matched {tp} boxes (mean IoU: {mean_iou:.3f})")
    if fp > 0:
        misses.append(f"{fp} false positive detections")
    if fn > 0:
        misses.append(f"{fn} missed ground truth boxes")

    print(json.dumps({
        "score": f1,
        "hits": hits,
        "misses": misses,
        "reasoning": f"Precision: {precision:.2f}, Recall: {recall:.2f}, F1: {f1:.2f}"
    }))


if __name__ == "__main__":
    main()
```

### Coordinate Distance Evaluator (Python)

```python
#!/usr/bin/env python3
"""
Coordinate distance evaluator supporting Euclidean, Manhattan, and Cosine metrics.
"""
import json
import math
import sys
from typing import List


def euclidean_distance(p1: List[float], p2: List[float]) -> float:
    return math.sqrt(sum((a - b) ** 2 for a, b in zip(p1, p2)))


def manhattan_distance(p1: List[float], p2: List[float]) -> float:
    return sum(abs(a - b) for a, b in zip(p1, p2))


def cosine_distance(p1: List[float], p2: List[float]) -> float:
    dot = sum(a * b for a, b in zip(p1, p2))
    mag1 = math.sqrt(sum(a ** 2 for a in p1))
    mag2 = math.sqrt(sum(b ** 2 for b in p2))
    if mag1 == 0 or mag2 == 0:
        return 1.0  # Maximum distance for zero vectors
    similarity = dot / (mag1 * mag2)
    return 1.0 - similarity


METRICS = {
    "euclidean": euclidean_distance,
    "manhattan": manhattan_distance,
    "cosine": cosine_distance,
}


def main():
    data = json.load(sys.stdin)

    candidate = data.get("candidate_answer", {})
    reference = data.get("reference_answer", {})

    extracted = candidate.get("coordinates") or candidate.get("point")
    expected = reference.get("coordinates") or reference.get("point")

    metric = "euclidean"  # Configurable
    threshold = 10.0      # Configurable

    if not extracted or not expected:
        print(json.dumps({
            "score": 0.0,
            "hits": [],
            "misses": ["Missing coordinate data"],
        }))
        return

    if len(extracted) != len(expected):
        print(json.dumps({
            "score": 0.0,
            "hits": [],
            "misses": [f"Dimension mismatch: {len(extracted)}D vs {len(expected)}D"],
        }))
        return

    distance_fn = METRICS.get(metric, euclidean_distance)
    distance = distance_fn(extracted, expected)

    # Convert distance to score (closer = higher score)
    if metric == "cosine":
        score = 1.0 - distance  # Cosine distance is already 0-1
    else:
        score = 1.0 if distance <= threshold else max(0.0, 1.0 - (distance - threshold) / threshold)

    passed = distance <= threshold if metric != "cosine" else distance <= 0.5

    print(json.dumps({
        "score": score,
        "hits": [f"{metric} distance: {distance:.3f}"] if passed else [],
        "misses": [] if passed else [f"Distance exceeds threshold: {distance:.3f} > {threshold}"],
        "reasoning": f"{metric.capitalize()} distance = {distance:.3f}"
    }))


if __name__ == "__main__":
    main()
```

## Usage in AgentV

### YAML Configuration

```yaml
description: Object detection evaluation with IoU

execution:
  target: vision_model
  evaluators:
    - name: bbox_accuracy
      type: code_judge
      path: ./evaluators/iou_evaluator.py

    - name: centroid_precision
      type: code_judge
      path: ./evaluators/coordinate_distance.py

evalcases:
  - id: detection-001
    expected_messages:
      - role: assistant
        content:
          boxes: [[10, 10, 50, 50], [100, 100, 150, 150]]
    input_messages:
      - role: user
        content:
          - type: file
            value: ./test-image.png
          - type: text
            value: "Detect objects in this image and return bounding boxes"
```

## Future Consideration: Built-in Evaluator

If user demand is high and patterns stabilize, geometric evaluators could be promoted to built-ins in a future release. Criteria for promotion:

1. **Usage Metrics**: >20% of AgentV users need bbox evaluation
2. **Stable API**: Plugin implementations have converged on standard interface
3. **Performance**: Built-in offers >10x performance improvement over scripts
4. **Complexity Budget**: Core maintainers accept the added code

Until then, the `code_judge` approach provides full flexibility with minimal AgentV core changes.

## Reference Algorithms

For implementers needing advanced features:

| Feature | Algorithm | Library |
|---------|-----------|---------|
| Polygon IoU | Sutherland-Hodgman clipping | `shapely` (Python), `turf` (JS) |
| Optimal matching | Hungarian algorithm | `scipy.optimize.linear_sum_assignment` |
| Rotated bbox IoU | Separating Axis Theorem | Custom implementation |
| mAP calculation | COCO-style evaluation | `pycocotools` |
