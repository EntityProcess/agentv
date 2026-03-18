# Completeness Rubric

Evaluate whether the response covers all aspects of the question.

## Task

Assess whether the candidate response addresses every part of the question and includes all important details from the reference answer.

## Input

- Question: {{ input_text }}
- Reference Answer: {{ expected_output_text }}
- Answer: {{ output_text }}

## Scoring

- **1.0**: Fully complete — addresses every aspect, includes all key details
- **0.7–0.9**: Mostly complete — covers main points with minor omissions
- **0.4–0.6**: Partially complete — misses significant aspects of the question
- **0.1–0.3**: Mostly incomplete — addresses only a small portion of the question
- **0.0**: Does not address the question at all

## Output Format

Return a JSON object:

```json
{
  "score": 0.9,
  "reasoning": "Brief explanation of completeness assessment"
}
```
