# Accuracy Check

Evaluate the factual accuracy of the response.

## Task
Verify that the candidate response contains accurate, factual information without errors or misconceptions.

## Input
- Question: {{ question }}
- Reference Answer: {{ reference_answer }}
- Candidate Answer: {{ candidate_answer }}

## Output Format
Return a JSON object with:
- `score`: 0.0 (inaccurate) to 1.0 (completely accurate)
- `reasoning`: Brief explanation noting any inaccuracies found

## Example
```json
{
  "score": 1.0,
  "reasoning": "All factual claims are accurate and align with established knowledge"
}
```
