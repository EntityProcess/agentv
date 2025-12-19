# Clarity Check

Evaluate the clarity and understandability of the response.

## Task
Assess how clear and easy to understand the candidate response is:
- Uses clear, unambiguous language
- Well-organized structure
- Appropriate for the target audience
- Avoids unnecessary jargon

## Input
- Question: {{ question }}
- Reference Answer: {{ reference_answer }}
- Candidate Answer: {{ candidate_answer }}

## Output Format
Return a JSON object with:
- `score`: 0.0 (unclear) to 1.0 (perfectly clear)
- `reasoning`: Brief explanation of clarity assessment

## Example
```json
{
  "score": 0.9,
  "reasoning": "Response is very clear and well-structured with good use of analogies"
}
```
