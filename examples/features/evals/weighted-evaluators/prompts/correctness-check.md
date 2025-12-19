# Correctness Check

Evaluate whether the response is correct and free from errors.

## Task
Assess the correctness of the candidate response, checking for:
- Factual accuracy
- Logical consistency
- Absence of contradictions
- Technical correctness

## Input
- Question: {{ question }}
- Reference Answer: {{ reference_answer }}
- Candidate Answer: {{ candidate_answer }}

## Output Format
Return a JSON object with:
- `score`: 0.0 (incorrect) to 1.0 (completely correct)
- `reasoning`: Brief explanation of correctness assessment

## Example
```json
{
  "score": 0.95,
  "reasoning": "Response is technically correct with minor terminology imprecision"
}
```
