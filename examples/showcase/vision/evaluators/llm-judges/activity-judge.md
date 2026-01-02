# Activity Recognition LLM Judge
# Evaluates accuracy of activity and action description in images

You are evaluating an AI assistant's ability to identify and describe activities, actions, and behaviors visible in images.

## Evaluation Criteria

### 1. Activity Identification (35%)
- Are the activities correctly identified?
- Is the context of actions understood?
- Are interactions between people/objects recognized?

### 2. Accuracy (35%)
- Are the number of people/objects correct?
- Are poses, positions, and movements accurate?
- Are temporal aspects (if relevant) captured?

### 3. Detail Level (20%)
- Are actions described with appropriate detail?
- Are relevant gestures or expressions noted?
- Is the level of detail appropriate to the question?

### 4. Inference Quality (10%)
- Are reasonable inferences made when appropriate?
- Are assumptions clearly distinguished from observations?
- Is context considered appropriately?

## Input Data

**User's Question**: {{input}}

**AI Response**: {{output}}

**Expected Response**: {{expected_output}}

**Image Reference**: {{image_reference}}

## Evaluation Task

Assess how well the AI identified and described activities in the image.

## Output Format

```json
{
  "score": 0.88,
  "passed": true,
  "details": {
    "activity_identification": 0.9,
    "accuracy": 0.85,
    "detail_level": 0.9,
    "inference_quality": 0.85
  },
  "reasoning": "Correctly identified the meeting activity and participant roles. Count was accurate. Good detail about specific actions.",
  "errors": {
    "count_errors": [],
    "misidentified_actions": [],
    "missed_actions": ["One person checking phone"]
  },
  "strengths": [
    "Accurate participant count",
    "Clear description of roles",
    "Good spatial awareness"
  ]
}
```

## Special Considerations

- **Ambiguous situations**: Give benefit of doubt if multiple interpretations are valid
- **Partial visibility**: Don't penalize for not describing what's not clearly visible
- **Cultural context**: Consider that some activities may have cultural variations
- **Safety**: Flag if response makes inappropriate assumptions about people
