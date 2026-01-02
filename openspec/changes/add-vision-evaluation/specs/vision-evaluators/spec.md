# vision-evaluators Specification

## Purpose
Provide specialized evaluators for assessing the quality and accuracy of AI agent responses to vision/image-based tasks. Includes both LLM-based judges for subjective assessment and code-based validators for objective metrics.

## ADDED Requirements

### Requirement: LLM Judge Prompts MUST support image context
LLM judge prompts SHALL be able to reference images from the evaluation input when assessing vision-based responses.

#### Scenario: Judge prompt includes image reference placeholder
Given an LLM judge prompt containing `{{image_reference}}`
When rendering the prompt for evaluation
Then the placeholder SHALL be replaced with a reference to the image(s) from the input.

#### Scenario: Judge model receives image context
Given an LLM judge evaluating a vision task
When the judge model is invoked
Then the judge model SHALL be a vision-capable model (e.g., GPT-4V, Claude 3.5 Sonnet).

---

### Requirement: Image Description Judge MUST evaluate visual analysis quality
An LLM judge SHALL assess the accuracy, completeness, and clarity of image descriptions.

#### Scenario: Evaluate description accuracy
Given an AI response describing an office image
When evaluated by the image-description-judge
Then the score SHALL reflect:
- Visual accuracy (40%): Are objects and details correct?
- Completeness (30%): Are all significant elements mentioned?
- Clarity (20%): Is the description clear and specific?
- Relevance (10%): Does it focus on task-relevant elements?

#### Scenario: Detect hallucinations in image descriptions
Given an AI response claiming "three people" when image shows two
When evaluated by the image-description-judge
Then the judge SHALL identify the hallucination in its `details.hallucinations` field.

#### Scenario: Identify missing visual elements
Given an AI response that omits significant background elements
When evaluated by the image-description-judge
Then the judge SHALL list missing elements in its `details.missing_elements` field.

---

### Requirement: Activity Recognition Judge MUST evaluate action identification
An LLM judge SHALL assess the accuracy of identifying activities, actions, and behaviors visible in images.

#### Scenario: Evaluate activity identification accuracy
Given an AI response identifying "team meeting with 4 people"
When evaluated by the activity-judge
Then the score SHALL reflect:
- Activity identification (35%): Is the activity correctly identified?
- Accuracy (35%): Are counts and poses correct?
- Detail level (20%): Is the detail appropriate?
- Inference quality (10%): Are inferences reasonable?

---

### Requirement: Comparison Judge MUST evaluate multi-image analysis
An LLM judge SHALL assess the quality of comparing multiple images and detecting changes.

#### Scenario: Evaluate change detection accuracy
Given an AI response comparing before/after images
When evaluated by the comparison-judge
Then the score SHALL reflect:
- Change detection accuracy (40%): Are changes identified?
- Spatial precision (25%): Are locations accurately described?
- Completeness (20%): Are both similarities and differences noted?
- Clarity (15%): Is the comparison structure clear?

---

### Requirement: Visual Reasoning Judge MUST evaluate logic with visual information
An LLM judge SHALL assess the quality of logical reasoning applied to visual problems (e.g., chess positions, puzzles, diagrams).

#### Scenario: Evaluate visual reasoning correctness
Given an AI response solving a chess problem from an image
When evaluated by the reasoning-judge
Then the score SHALL reflect:
- Logical correctness (40%): Is reasoning sound?
- Visual understanding (30%): Is visual perception accurate?
- Problem-solving quality (20%): Is the solution approach appropriate?
- Explanation quality (10%): Is reasoning clearly explained?

---

### Requirement: Structured Output Judge MUST validate vision-based JSON
An LLM judge SHALL assess the quality of structured JSON outputs from vision analysis tasks.

#### Scenario: Evaluate JSON structure from vision task
Given an AI response with JSON object detection results
When evaluated by the structured-output-judge
Then the score SHALL reflect:
- JSON validity (30%): Is it parseable JSON?
- Schema compliance (35%): Does it match requested structure?
- Data accuracy (25%): Are values from image accurate?
- Completeness (10%): Are all relevant elements captured?

---

### Requirement: Quality Assessment Judge MUST evaluate image quality analysis
An LLM judge SHALL assess the completeness and accuracy of image quality assessments (technical, compositional, aesthetic).

#### Scenario: Evaluate quality assessment completeness
Given an AI response rating an image's quality
When evaluated by the quality-assessment-judge
Then the score SHALL reflect:
- Technical completeness (30%): Sharpness, exposure, noise discussed?
- Compositional analysis (25%): Rule of thirds, balance, framing?
- Aesthetic evaluation (20%): Color, mood, style assessed?
- Overall judgment (15%): Score provided with justification?
- Professional tone (10%): Objective and uses appropriate terminology?

---

### Requirement: Object Count Validator MUST verify numeric accuracy
A code-based validator SHALL extract and verify object counts from AI responses against expected values.

#### Scenario: Validate object count accuracy
Given an AI response stating "5 bottles" and expected output "5 bottles"
When evaluated by count_validator.py
Then the score SHALL be 1.0 (100% accuracy).

#### Scenario: Partial count matching
Given an AI response stating "5 bottles, 3 cans" and expected "5 bottles, 8 cans"
When evaluated by count_validator.py
Then the score SHALL be 0.5 (50% accuracy - one of two counts matched).

---

### Requirement: OCR Validator MUST verify text extraction accuracy
A code-based validator SHALL compare extracted text from images against expected text using similarity and keyword matching.

#### Scenario: Validate OCR text similarity
Given an AI response extracting "Project Proposal Q1 2026" and expected "Project Proposal Q1 2026"
When evaluated by ocr_validator.py
Then the score SHALL be >0.9 (high text similarity).

#### Scenario: Validate keyword presence
Given an AI response mentioning keywords "budget, timeline, deliverables"
When evaluated by ocr_validator.py with expected keywords
Then the keyword accuracy SHALL be reflected in the score.

---

### Requirement: JSON Structure Validator MUST verify structured outputs
A code-based validator SHALL validate that AI responses contain correctly structured JSON matching expected schemas.

#### Scenario: Validate JSON structure and fields
Given an AI response with valid JSON containing expected fields
When evaluated by json_validator.py
Then the validation SHALL:
- Confirm JSON is parseable
- Verify schema compliance
- Check field presence and types
- Return score based on coverage

#### Scenario: Detect schema violations
Given an AI response with JSON missing required fields
When evaluated by json_validator.py
Then the validation SHALL identify missing fields in `details.missing_keys`.

---

### Requirement: Chart Data Validator MUST verify data extraction
A code-based validator SHALL extract and validate numeric data (currency, percentages, dates) from chart/graph descriptions.

#### Scenario: Validate currency value extraction
Given an AI response stating "Q4: $2.4M" and expected "$2.4M"
When evaluated by chart_validator.py
Then the currency value SHALL be matched within 15% tolerance.

#### Scenario: Validate percentage extraction
Given an AI response stating "58% growth" and expected "58%"
When evaluated by chart_validator.py
Then the percentage SHALL be matched exactly.

---

### Requirement: Code Validators MUST execute via uv run
Python code validators SHALL be executed using `uv run` command with evaluation data passed as JSON.

#### Scenario: Execute Python validator with JSON input
Given a code validator script `count_validator.py`
When executed with eval data `{"output": "5 objects", "expected_output": "5 objects"}`
Then the validator SHALL:
- Receive data via stdin or command-line argument
- Process the data
- Return JSON result via stdout
- Exit with code 0 for passed, 1 for failed

#### Scenario: Handle validator timeouts
Given a code validator that runs longer than 30 seconds
When executed
Then the system SHALL terminate the validator and report a timeout error.

---

### Requirement: Evaluator Results MUST follow standard format
All evaluators (LLM judges and code validators) SHALL return results in a consistent format for scoring.

#### Scenario: Standard result format
Given any evaluator completing evaluation
When the result is returned
Then it SHALL include:
```typescript
{
  status: 'processed' | 'error' | 'skipped',
  score: number,  // 0.0 to 1.0
  passed: boolean,
  details: {
    // Evaluator-specific details
  }
}
```

---

## Cross-References

**Related Capabilities:**
- `vision-input` - Provides the images to evaluate
- `evaluation` - Base evaluation framework
- `rubric-evaluator` - Similar pattern for LLM judges
- `eval-execution` - Executes evaluators during eval runs

**Dependencies:**
- Requires `vision-input` to be implemented first
- Extends existing evaluator patterns from `rubric-evaluator`

---

## Implementation Notes

### LLM Judge File Structure
```
evaluators/llm-judges/
├── image-description-judge.md
├── activity-judge.md
├── comparison-judge.md
├── reasoning-judge.md
├── structured-output-judge.md
└── quality-assessment-judge.md
```

### Code Validator File Structure
```
evaluators/code-validators/
├── count_validator.py
├── ocr_validator.py
├── json_validator.py
└── chart_validator.py
```

### Judge Prompt Template Variables
- `{{input}}` - User's question/input
- `{{output}}` - AI's response
- `{{expected_output}}` - Expected response
- `{{image_reference}}` - Reference to image(s)
- `{{image_references}}` - Array of image references (for multi-image)

### Code Validator Interface
```python
def validate(
    output: str,
    expected_output: str,
    input_text: str = "",
    **kwargs
) -> Dict[str, Any]:
    return {
        "status": "processed",
        "score": 0.85,
        "passed": True,
        "details": {...}
    }
```

### Scoring Dimension Weights

**Image Description**:
- Visual Accuracy: 40%
- Completeness: 30%
- Clarity: 20%
- Relevance: 10%

**Activity Recognition**:
- Activity Identification: 35%
- Accuracy: 35%
- Detail Level: 20%
- Inference Quality: 10%

**Visual Reasoning**:
- Logical Correctness: 40%
- Visual Understanding: 30%
- Problem-Solving: 20%
- Explanation: 10%

**Comparison**:
- Change Detection: 40%
- Spatial Precision: 25%
- Completeness: 20%
- Clarity: 15%

---

## Future Enhancements (Out of Scope)
- Computer vision metric evaluators (SSIM, perceptual hash, CLIP similarity)
- Specialized domain evaluators (medical imaging, document understanding, face detection)
- Multi-sample evaluation automation (run judges 3-5 times, aggregate scores)
- Confidence calibration evaluators
- Adversarial image testing
