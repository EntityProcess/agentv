# Code Correctness Judge

## Task

Evaluate the generated code against the requirements. Score from 0.0 to 1.0 based on Functional Correctness (0.4), Code Quality (0.3), and Completeness (0.3).

## Context

### Original Question
${question}

### Expected Outcome
${outcome}

### Reference Answer
${referenceAnswer}

### Candidate Answer
${candidateAnswer}

## Constraints
- **0.9-1.0**: Excellent (Correct, efficient, best practices)
- **0.7-0.8**: Good (Correct, minor issues)
- **0.5-0.6**: Acceptable (Core solved, some issues)
- **0.3-0.4**: Poor (Partial solution, major bugs)
- **0.0-0.2**: Unacceptable (Incorrect, critical bugs)
- Be objective and consistent.
- List specific hits and misses (max 4 each).

## Output Format
```json
{
  "score": 0.85,
  "hits": ["Correct algorithm", "Good error handling"],
  "misses": ["Missing validation"],
  "reasoning": "Brief explanation..."
}
```
