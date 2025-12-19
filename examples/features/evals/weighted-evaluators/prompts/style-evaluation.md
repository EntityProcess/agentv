# Style Evaluation

Evaluate the writing style and presentation of the response.

## Task
Assess the style and presentation of the candidate response based on:
- Writing clarity and readability
- Appropriate tone and formality
- Sentence structure and flow
- Use of examples and analogies

## Input
- Question: {{ question }}
- Reference Answer: {{ reference_answer }}
- Candidate Answer: {{ candidate_answer }}

## Output Format
Return a JSON object with:
- `score`: 0.0 (poor style) to 1.0 (excellent style)
- `reasoning`: Brief explanation of the style assessment

## Example
```json
{
  "score": 0.9,
  "reasoning": "Response uses clear, accessible language with good flow and helpful examples"
}
```
