# Quality Evaluation

Evaluate the overall quality of the response.

## Task
Assess the quality of the candidate response based on:
- Accuracy and correctness
- Completeness of information
- Clarity and coherence
- Relevance to the question

## Input
- Question: {{ question }}
- Reference Answer: {{ reference_answer }}
- Candidate Answer: {{ candidate_answer }}

## Output Format
Return a JSON object with:
- `score`: 0.0 (poor quality) to 1.0 (excellent quality)
- `reasoning`: Brief explanation of the quality assessment

## Example
```json
{
  "score": 0.85,
  "reasoning": "Response is accurate and well-explained, but could include more detail on practical applications"
}
```
