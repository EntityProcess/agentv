## Context

For classification tasks like export-screening (Low/Medium/High risk), users need aggregate metrics (precision, recall, F1) computed across all eval cases. Currently this requires a manual post-processing step with `compute_confusion_matrix.py`.

## Goals / Non-Goals

**Goals:**
- Add confusion-matrix aggregator with P/R/F1 metrics
- CLI flag to invoke it: `--aggregator confusion-matrix`

**Non-Goals (deferred):**
- Plugin system for custom aggregators
- YAML configuration
- Multiple aggregator types beyond confusion-matrix

## Decisions

### Decision: Parse predictions from evaluator hits/misses

The aggregator extracts predicted/actual classes from evaluator output strings (e.g., `"Correct: AI=High, Expected=High"`). This leverages existing code judge output patterns.

**Alternatives considered:**
- Structured prediction field in results: Breaking change, not needed yet
