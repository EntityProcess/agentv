# Visual Reasoning LLM Judge
# Evaluates logical reasoning applied to visual information

You are evaluating an AI assistant's ability to apply logical reasoning to visual information, such as solving puzzles, analyzing diagrams, or making inferences from visual data.

## Evaluation Criteria

### 1. Logical Correctness (40%)
- Is the reasoning logically sound?
- Are conclusions properly supported by visual evidence?
- Are logical steps clearly connected?

### 2. Visual Understanding (30%)
- Does the response demonstrate accurate visual perception?
- Are visual elements correctly interpreted?
- Is spatial/structural understanding correct?

### 3. Problem-Solving Quality (20%)
- Is the problem correctly understood?
- Is the solution approach appropriate?
- Are alternative solutions considered (when relevant)?

### 4. Explanation Quality (10%)
- Is the reasoning process clearly explained?
- Are assumptions stated explicitly?
- Is the explanation easy to follow?

## Input Data

**User's Question**: {{input}}

**AI Response**: {{output}}

**Expected Response**: {{expected_output}}

**Image Reference**: {{image_reference}}

## Evaluation Task

Assess the quality of reasoning applied to the visual problem.

## Output Format

```json
{
  "score": 0.88,
  "passed": true,
  "details": {
    "logical_correctness": 0.9,
    "visual_understanding": 0.85,
    "problem_solving_quality": 0.9,
    "explanation_quality": 0.85
  },
  "reasoning": "Strong logical analysis with correct visual interpretation. Solution is sound and well-explained. Could have considered one alternative approach.",
  "correctness": {
    "visual_perception": "Accurate",
    "logical_chain": "Valid",
    "conclusion": "Correct",
    "assumptions": "Reasonable and stated"
  },
  "strengths": [
    "Clear step-by-step reasoning",
    "Accurate visual analysis",
    "Correct conclusion",
    "Good explanation"
  ],
  "weaknesses": [
    "Didn't mention alternative solution",
    "Could be more explicit about one assumption"
  ],
  "alternative_solutions": [
    "Could have suggested Bd3 as alternative to Nf3"
  ]
}
```

## Reasoning Task Types

### Spatial Reasoning
- Puzzles, mazes, pathfinding
- Evaluate: Path correctness, spatial understanding, optimization

### Logical Inference
- Chess, game states, strategy
- Evaluate: Rule understanding, tactical analysis, strategic thinking

### Pattern Recognition
- Sequences, analogies, relationships
- Evaluate: Pattern identification, extrapolation, justification

### Quantitative Analysis
- Charts, graphs, measurements
- Evaluate: Data extraction accuracy, calculation correctness, insight quality

### Diagram Understanding
- Architecture, flowcharts, schematics
- Evaluate: Component identification, relationship understanding, system comprehension

## Scoring Guidelines

**0.9-1.0: Excellent**
- Flawless reasoning
- Complete visual understanding
- Optimal or near-optimal solution
- Clear, thorough explanation

**0.7-0.89: Good**
- Sound reasoning with minor gaps
- Accurate visual interpretation
- Correct solution (may not be optimal)
- Adequate explanation

**0.5-0.69: Acceptable**
- Some logical issues
- Mostly correct visual understanding
- Solution has issues but shows understanding
- Explanation could be clearer

**0.3-0.49: Poor**
- Significant logical errors
- Misinterpretation of visual elements
- Incorrect solution
- Unclear reasoning

**0.0-0.29: Failed**
- Fundamentally flawed reasoning
- Serious misunderstanding of visual information
- Completely incorrect solution

## Special Considerations

- **Multiple valid solutions**: Accept any logically sound approach
- **Partial solutions**: Give partial credit for correct reasoning even if conclusion is off
- **Computational errors**: Distinguish between logical errors and arithmetic mistakes
- **Ambiguous images**: Be lenient if image quality affects interpretation
