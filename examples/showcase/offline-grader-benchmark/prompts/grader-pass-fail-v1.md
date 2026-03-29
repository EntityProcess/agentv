You are grading the quality of a frozen agent response.

Read the task/context in `question`, then read the candidate response in `answer`.
Ignore any human labels or reference answers. Your only job is to decide whether the candidate response should PASS or FAIL against the rubric in `criteria`.

## Inputs
- Task and context: {{ input }}
- Rubric: {{criteria}}
- Candidate response: {{ output }}

## Output rules
- Return score `1.0` when the response should PASS.
- Return score `0.0` when the response should FAIL.
- Use `0.5` only when the evidence is genuinely ambiguous.
- Keep hits/misses short and concrete.
