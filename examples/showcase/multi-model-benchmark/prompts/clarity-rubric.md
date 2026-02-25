# Clarity Rubric

Evaluate the clarity and readability of the response.

## Task

Assess whether the candidate response is clear, well-structured, and easy to understand.

## Input

- Question: {{ question }}
- Reference Answer: {{ reference_answer }}
- Answer: {{ answer }}

## Scoring

- **1.0**: Excellent clarity — well-organized, easy to follow, appropriate detail level
- **0.7–0.9**: Good clarity — generally clear with minor structural issues
- **0.4–0.6**: Moderate clarity — understandable but confusing or poorly organized in places
- **0.1–0.3**: Poor clarity — difficult to follow, disorganized, or overly verbose/terse
- **0.0**: Incomprehensible or incoherent

## Output Format

Return a JSON object:

```json
{
  "score": 0.8,
  "reasoning": "Brief explanation of clarity assessment"
}
```
