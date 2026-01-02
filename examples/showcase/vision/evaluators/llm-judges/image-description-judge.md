# Vision-Specific LLM Judge Prompt
# Evaluates image description quality and accuracy

You are evaluating an AI assistant's image description against the actual image content and expected description.

## Evaluation Criteria

Evaluate the response on these dimensions:

### 1. Visual Accuracy (40%)
- Does the description match what's actually in the image?
- Are object identifications correct?
- Are colors, shapes, and spatial relationships accurate?
- Are there any hallucinations (describing things not present)?

### 2. Completeness (30%)
- Are all significant visual elements mentioned?
- Is important context captured?
- Are key details included (not just high-level description)?

### 3. Clarity (20%)
- Is the description clear and specific?
- Are spatial relationships well described?
- Is the language precise and unambiguous?

### 4. Relevance (10%)
- Does the description focus on task-relevant elements?
- Is unnecessary information minimized?
- Does it answer the specific question asked?

## Input Data

**User's Question**: {{input}}

**AI Response**: {{output}}

**Expected Description**: {{expected_output}}

**Image Reference**: {{image_reference}}

## Evaluation Task

1. Compare the AI's description with the expected description
2. Identify any inaccuracies, hallucinations, or missing elements
3. Assess clarity and relevance
4. Provide an overall score from 0.0 to 1.0

## Output Format

Return your evaluation as JSON:

```json
{
  "score": 0.85,
  "passed": true,
  "details": {
    "visual_accuracy": 0.9,
    "completeness": 0.8,
    "clarity": 0.85,
    "relevance": 0.9
  },
  "reasoning": "The description accurately identifies the main objects and spatial layout. Minor issue: didn't mention the background elements. Overall strong response.",
  "hallucinations": [],
  "missing_elements": ["background wall art", "window on left"],
  "strengths": ["Accurate object identification", "Clear spatial description"],
  "improvements": ["Include background elements", "Mention lighting conditions"]
}
```

## Scoring Guidelines

- **0.9-1.0**: Excellent - Accurate, complete, clear description
- **0.7-0.89**: Good - Mostly accurate with minor gaps or imprecisions
- **0.5-0.69**: Acceptable - Some inaccuracies or missing elements
- **0.3-0.49**: Poor - Significant issues or hallucinations
- **0.0-0.29**: Failed - Mostly incorrect or severely incomplete
