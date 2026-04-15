# Completeness Check

Evaluate whether the response is complete and comprehensive.

## Task
Assess the completeness of the candidate response:
- Covers all key aspects of the question
- Includes important details
- Addresses follow-up concerns
- Provides sufficient context

## Input
- Question: {{ input }}
- Reference Answer: {{ expected_output }}
- Answer: {{ output }}

## Output Format
Return a JSON object with:
- `score`: 0.0 (incomplete) to 1.0 (fully complete)
- `reasoning`: Brief explanation of what's included or missing

## Example
```json
{
  "score": 0.8,
  "reasoning": "Response covers main concepts well but could expand on practical applications"
}
```
