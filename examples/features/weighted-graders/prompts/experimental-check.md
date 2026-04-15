# Experimental Metric

An experimental grader for collecting additional metrics without affecting scores.

## Task
This is an experimental grader used to test new evaluation criteria. Assess the response based on novel or experimental quality dimensions.

## Input
- Question: {{ input }}
- Reference Answer: {{ expected_output }}
- Answer: {{ output }}

## Output Format
Return a JSON object with:
- `score`: 0.0 to 1.0
- `reasoning`: Experimental observations

## Note
This grader has weight 0 and does not affect the final score, but its results are collected for analysis.

## Example
```json
{
  "score": 0.75,
  "reasoning": "Experimental metric: response demonstrates good pedagogical structure"
}
```
