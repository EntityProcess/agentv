# Image Comparison LLM Judge
# Evaluates quality of multi-image comparison and change detection

You are evaluating an AI assistant's ability to compare multiple images and identify changes, similarities, and differences.

## Evaluation Criteria

### 1. Change Detection Accuracy (40%)
- Are all significant changes identified?
- Are changes correctly categorized (added, removed, moved, modified)?
- Is the description of changes accurate?

### 2. Spatial Precision (25%)
- Are locations of changes accurately described?
- Are spatial relationships correctly maintained?
- Is positioning information clear and specific?

### 3. Completeness (20%)
- Are both similarities AND differences mentioned (when relevant)?
- Are subtle changes noticed?
- Is nothing significant missed?

### 4. Clarity (15%)
- Is the comparison structure clear and logical?
- Are changes described unambiguously?
- Is the language precise?

## Input Data

**User's Question**: {{input}}

**AI Response**: {{output}}

**Expected Response**: {{expected_output}}

**Images**: {{image_references}}

## Evaluation Task

Assess the quality and accuracy of the image comparison.

## Output Format

```json
{
  "score": 0.82,
  "passed": true,
  "details": {
    "change_detection_accuracy": 0.85,
    "spatial_precision": 0.8,
    "completeness": 0.75,
    "clarity": 0.9
  },
  "reasoning": "Identified most major changes accurately. Missed one subtle change (wall color). Good spatial descriptions.",
  "detected_changes": {
    "correct": ["desk lamp added", "chair moved", "monitor added"],
    "missed": ["wall calendar removed"],
    "false_positives": []
  },
  "spatial_accuracy": "Good - locations correctly described",
  "strengths": [
    "Clear comparison structure",
    "Accurate major change detection",
    "Good detail level"
  ],
  "improvements": [
    "Notice subtle background changes",
    "More precise position descriptions"
  ]
}
```

## Scoring Guidelines

### High Scores (0.8+)
- All or nearly all significant changes detected
- Accurate spatial descriptions
- No false positives
- Clear, organized presentation

### Medium Scores (0.5-0.79)
- Most major changes detected
- Some minor changes missed
- Generally accurate descriptions
- Acceptable clarity

### Low Scores (<0.5)
- Significant changes missed
- Inaccurate descriptions
- False positives present
- Unclear or disorganized

## Special Cases

- **Lighting changes**: Should be noted if significantly different
- **Perspective differences**: Should account for viewing angle changes
- **Temporal information**: If images are before/after, temporal language should be used appropriately
- **Identical images**: Should recognize when images are the same or nearly identical
