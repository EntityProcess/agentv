#!/usr/bin/env python3
"""
Confusion Matrix Calculator for Export Risk Classification

Post-processes AgentV evaluation results to compute:
- Confusion matrix (predicted vs actual)
- Per-class precision, recall, F1 scores
- Overall (macro-averaged) metrics

Usage:
    uv run compute_confusion_matrix.py <results.jsonl> [output.json]

Input: AgentV JSONL results file
Output: JSON file with confusion matrix and classification metrics
"""

import json
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any


CLASSES = ["Low", "Medium", "High"]


def parse_classification_from_result(result: dict[str, Any]) -> tuple[str | None, str | None]:
    """
    Extract AI prediction and expected (ground truth) classification from result.

    Parses the hits/misses fields produced by validate_risk_output.py:
    - Hit: "Correct: AI=High, Expected=High"
    - Miss: "Mismatch: AI=Low, Expected=High"
    """
    ai_class = None
    expected_class = None

    # Pattern for classification comparison
    comparison_pattern = re.compile(r"AI=(\w+),?\s*Expected=(\w+)")

    # Check misses first (misclassifications)
    for miss in result.get("misses", []):
        match = comparison_pattern.search(miss)
        if match:
            ai_class = match.group(1)
            expected_class = match.group(2)
            return ai_class, expected_class

    # Check hits (correct classifications)
    for hit in result.get("hits", []):
        match = comparison_pattern.search(hit)
        if match:
            ai_class = match.group(1)
            expected_class = match.group(2)
            return ai_class, expected_class

    # Fallback: try to extract just the AI classification
    for hit in result.get("hits", []):
        if hit.startswith("riskLevel="):
            ai_class = hit.split("=")[1]
            break

    return ai_class, expected_class


def build_confusion_matrix(results: list[dict[str, Any]]) -> dict[str, dict[str, int]]:
    """Build confusion matrix from evaluation results."""
    matrix: dict[str, dict[str, int]] = {
        expected: {predicted: 0 for predicted in CLASSES}
        for expected in CLASSES
    }

    for result in results:
        ai_class, expected_class = parse_classification_from_result(result)

        if ai_class and expected_class:
            if expected_class in CLASSES and ai_class in CLASSES:
                matrix[expected_class][ai_class] += 1

    return matrix


def compute_class_metrics(
    matrix: dict[str, dict[str, int]],
    target_class: str
) -> dict[str, float]:
    """Compute precision, recall, F1 for a single class."""
    # True positives: predicted target_class when actual was target_class
    tp = matrix[target_class][target_class]

    # False positives: predicted target_class when actual was different
    fp = sum(
        matrix[actual][target_class]
        for actual in CLASSES
        if actual != target_class
    )

    # False negatives: predicted different when actual was target_class
    fn = sum(
        matrix[target_class][predicted]
        for predicted in CLASSES
        if predicted != target_class
    )

    # Calculate metrics
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f1 = (
        2 * precision * recall / (precision + recall)
        if (precision + recall) > 0
        else 0.0
    )

    return {
        "truePositives": tp,
        "falsePositives": fp,
        "falseNegatives": fn,
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4)
    }


def compute_overall_metrics(
    per_class_metrics: dict[str, dict[str, float]]
) -> dict[str, float]:
    """Compute macro-averaged overall metrics."""
    # Only include classes that have samples (support > 0)
    active_classes = [
        cls for cls, metrics in per_class_metrics.items()
        if (metrics["truePositives"] + metrics["falseNegatives"]) > 0
    ]

    if not active_classes:
        return {"precision": 0.0, "recall": 0.0, "f1": 0.0}

    macro_precision = sum(
        per_class_metrics[cls]["precision"] for cls in active_classes
    ) / len(active_classes)

    macro_recall = sum(
        per_class_metrics[cls]["recall"] for cls in active_classes
    ) / len(active_classes)

    macro_f1 = sum(
        per_class_metrics[cls]["f1"] for cls in active_classes
    ) / len(active_classes)

    return {
        "precision": round(macro_precision, 4),
        "recall": round(macro_recall, 4),
        "f1": round(macro_f1, 4)
    }


def compute_accuracy(matrix: dict[str, dict[str, int]]) -> float:
    """Compute overall accuracy."""
    correct = sum(matrix[cls][cls] for cls in CLASSES)
    total = sum(
        matrix[expected][predicted]
        for expected in CLASSES
        for predicted in CLASSES
    )
    return round(correct / total, 4) if total > 0 else 0.0


def load_results(results_file: Path) -> list[dict[str, Any]]:
    """Load evaluation results from JSONL file."""
    results = []
    with open(results_file) as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    results.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    return results


def compute_metrics(results_file: Path) -> dict[str, Any]:
    """Main function to compute all metrics from results file."""
    results = load_results(results_file)

    if not results:
        return {
            "error": "No results found in file",
            "resultsFile": str(results_file)
        }

    # Build confusion matrix
    matrix = build_confusion_matrix(results)

    # Compute per-class metrics
    per_class_metrics = {
        cls: compute_class_metrics(matrix, cls)
        for cls in CLASSES
    }

    # Compute overall metrics
    overall_metrics = compute_overall_metrics(per_class_metrics)
    accuracy = compute_accuracy(matrix)

    # Count samples per class
    class_counts = {
        cls: sum(matrix[cls].values())
        for cls in CLASSES
    }

    return {
        "summary": {
            "totalSamples": sum(class_counts.values()),
            "samplesPerClass": class_counts,
            "accuracy": accuracy
        },
        "confusionMatrix": {
            "classes": CLASSES,
            "matrix": matrix,
            "description": "matrix[actual][predicted] = count"
        },
        "metricsPerClass": per_class_metrics,
        "overallMetrics": overall_metrics
    }


def print_summary(metrics: dict[str, Any]) -> None:
    """Print human-readable summary to stderr."""
    print("\n=== Export Risk Classification Metrics ===\n", file=sys.stderr)

    summary = metrics.get("summary", {})
    print(f"Total samples: {summary.get('totalSamples', 0)}", file=sys.stderr)
    print(f"Accuracy: {summary.get('accuracy', 0):.1%}", file=sys.stderr)

    print("\nConfusion Matrix (rows=actual, cols=predicted):", file=sys.stderr)
    print(f"{'':>10} | {'Low':>8} {'Medium':>8} {'High':>8}", file=sys.stderr)
    print("-" * 42, file=sys.stderr)

    matrix = metrics.get("confusionMatrix", {}).get("matrix", {})
    for actual in CLASSES:
        row = matrix.get(actual, {})
        print(
            f"{actual:>10} | {row.get('Low', 0):>8} {row.get('Medium', 0):>8} {row.get('High', 0):>8}",
            file=sys.stderr
        )

    print("\nPer-class Metrics:", file=sys.stderr)
    print(f"{'Class':>10} | {'Precision':>10} {'Recall':>10} {'F1':>10}", file=sys.stderr)
    print("-" * 46, file=sys.stderr)

    per_class = metrics.get("metricsPerClass", {})
    for cls in CLASSES:
        m = per_class.get(cls, {})
        print(
            f"{cls:>10} | {m.get('precision', 0):>10.1%} {m.get('recall', 0):>10.1%} {m.get('f1', 0):>10.1%}",
            file=sys.stderr
        )

    overall = metrics.get("overallMetrics", {})
    print("-" * 46, file=sys.stderr)
    print(
        f"{'Overall':>10} | {overall.get('precision', 0):>10.1%} {overall.get('recall', 0):>10.1%} {overall.get('f1', 0):>10.1%}",
        file=sys.stderr
    )
    print(file=sys.stderr)


def main():
    """Main entry point."""
    if len(sys.argv) < 2:
        print("Usage: uv run compute_confusion_matrix.py <results.jsonl> [output.json]", file=sys.stderr)
        print("\nComputes confusion matrix and classification metrics from AgentV results.", file=sys.stderr)
        sys.exit(1)

    results_file = Path(sys.argv[1])
    output_file = Path(sys.argv[2]) if len(sys.argv) > 2 else None

    if not results_file.exists():
        print(f"Error: Results file not found: {results_file}", file=sys.stderr)
        sys.exit(1)

    metrics = compute_metrics(results_file)

    # Print summary to stderr
    print_summary(metrics)

    # Output JSON
    output_json = json.dumps(metrics, indent=2)

    if output_file:
        output_file.write_text(output_json)
        print(f"Metrics written to: {output_file}", file=sys.stderr)
    else:
        print(output_json)


if __name__ == "__main__":
    main()
