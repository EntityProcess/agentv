# Accuracy Rubric

Evaluate the factual accuracy of the response.

## Task

Assess whether the candidate response is factually correct and aligns with the reference answer.

## Input

- Question: {{ input_text }}
- Reference Answer: {{ expected_output_text }}
- Answer: {{ output_text }}

## Scoring

- **1.0**: Fully accurate — all facts match the reference and no incorrect claims
- **0.7–0.9**: Mostly accurate — minor omissions or imprecise phrasing but no errors
- **0.4–0.6**: Partially accurate — some correct content mixed with errors or key omissions
- **0.1–0.3**: Mostly inaccurate — significant factual errors or missing critical information
- **0.0**: Completely wrong or irrelevant

## Output Format

Return a JSON object:

```json
{
  "score": 0.85,
  "reasoning": "Brief explanation of accuracy assessment"
}
```
