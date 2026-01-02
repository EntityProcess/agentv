# vision-evaluation Specification

## Purpose
Provide comprehensive, self-contained vision evaluation examples demonstrating best practices for testing AI agents with image inputs. Organized as a standalone package under `examples/showcase/vision/` with all necessary assets.

## ADDED Requirements

### Requirement: Vision Examples MUST be self-contained in examples/showcase/vision/
All vision evaluation files SHALL be organized in a single directory structure under `examples/showcase/vision/`, making it easy to discover, understand, and use as a complete package.

#### Scenario: Directory structure is self-contained
Given the vision examples directory
When inspecting `examples/showcase/vision/`
Then it SHALL contain:
- `.agentv/` - Configuration files
- `datasets/` - Evaluation YAML files
- `evaluators/` - LLM judges and code validators
- `test-images/` - Placeholder for user test images
- `README.md` - Comprehensive documentation
- `INDEX.md` - Quick reference guide

---

### Requirement: Basic Image Analysis Examples MUST cover fundamental tasks
The examples SHALL include 7 basic vision evaluation cases covering essential image understanding capabilities.

#### Scenario: Simple image description eval case
Given `datasets/basic-image-analysis.yaml`
When loaded
Then it SHALL contain an eval case `simple-image-description` that:
- Includes an image in the input
- Expects a description of the image
- Uses `image-description-judge` for evaluation

#### Scenario: Object detection eval case
Given `datasets/basic-image-analysis.yaml`
When loaded
Then it SHALL contain an eval case `object-detection-simple` that:
- Asks to count/identify objects
- Includes expected count in output
- Uses `count_validator` for verification

#### Scenario: Spatial relationships eval case
Given `datasets/basic-image-analysis.yaml`
When loaded
Then it SHALL contain an eval case `spatial-relationships` that:
- Asks about object positions
- Expects spatial descriptions
- Uses `image-description-judge` for evaluation

#### Scenario: OCR text extraction eval case
Given `datasets/basic-image-analysis.yaml`
When loaded
Then it SHALL contain an eval case `text-extraction-ocr` that:
- Shows an image with text
- Expects text extraction
- Uses `ocr_validator` for verification

#### Scenario: Multi-image comparison eval case
Given `datasets/basic-image-analysis.yaml`
When loaded
Then it SHALL contain an eval case `multi-image-comparison` that:
- Includes two images (before/after)
- Expects change identification
- Uses `comparison-judge` for evaluation

#### Scenario: Color identification eval case
Given `datasets/basic-image-analysis.yaml`
When loaded
Then it SHALL contain an eval case `color-identification` that:
- Asks about colors in image
- Expects color descriptions
- Uses `image-description-judge` for evaluation

#### Scenario: Image from URL eval case
Given `datasets/basic-image-analysis.yaml`
When loaded
Then it SHALL contain an eval case `image-from-url` that:
- References an image via HTTP URL
- Demonstrates URL loading capability
- Uses standard judge for evaluation

---

### Requirement: Advanced Vision Examples MUST demonstrate complex scenarios
The examples SHALL include 7 advanced vision evaluation cases showcasing sophisticated capabilities.

#### Scenario: Structured JSON output eval case
Given `datasets/advanced-vision-tasks.yaml`
When loaded
Then it SHALL contain an eval case `structured-object-detection` that:
- Requests JSON-formatted object detection results
- Expects specific JSON structure
- Uses `json_validator` and `structured-output-judge`

#### Scenario: Visual reasoning eval case
Given `datasets/advanced-vision-tasks.yaml`
When loaded
Then it SHALL contain an eval case `visual-reasoning-problem` that:
- Presents a logical puzzle with image (e.g., chess)
- Expects reasoned solution
- Uses `reasoning-judge` for evaluation

#### Scenario: Multi-turn conversation eval cases
Given `datasets/advanced-vision-tasks.yaml`
When loaded
Then it SHALL contain eval cases `multi-turn-image-discussion-part1` and `part2` that:
- Share the same `conversation_id`
- Maintain image context across turns
- Demonstrate contextual follow-up questions

#### Scenario: Image quality assessment eval case
Given `datasets/advanced-vision-tasks.yaml`
When loaded
Then it SHALL contain an eval case `image-quality-assessment` that:
- Asks for technical/aesthetic quality rating
- Expects detailed assessment
- Uses `quality-assessment-judge`

#### Scenario: Chart data extraction eval case
Given `datasets/advanced-vision-tasks.yaml`
When loaded
Then it SHALL contain an eval case `chart-data-extraction` that:
- Shows a chart/graph image
- Expects data extraction and analysis
- Uses `chart_validator` for verification

#### Scenario: Scene understanding eval case
Given `datasets/advanced-vision-tasks.yaml`
When loaded
Then it SHALL contain an eval case `scene-context-inference` that:
- Requires contextual understanding beyond literal content
- Expects inferred situation/mood
- Uses `image-description-judge`

#### Scenario: Instruction following with image eval case
Given `datasets/advanced-vision-tasks.yaml`
When loaded
Then it SHALL contain an eval case `instruction-following-with-image` that:
- Combines complex instructions with visual reference
- May include file attachments with instructions
- Tests multi-step task completion

---

### Requirement: Comprehensive README MUST provide usage guidance
The `examples/showcase/vision/README.md` file SHALL serve as the primary documentation for vision evaluation.

#### Scenario: README covers quick start
Given `examples/showcase/vision/README.md`
When a user reads the Quick Start section
Then they SHALL find:
- How to run basic evals
- How to run advanced evals
- How to add test images

#### Scenario: README documents image input formats
Given `examples/showcase/vision/README.md`
When a user looks up image input formats
Then they SHALL find examples for:
- Local file paths
- HTTP URLs
- Base64 data URIs
- Detail level specification

#### Scenario: README lists all evaluators
Given `examples/showcase/vision/README.md`
When a user wants to know available evaluators
Then they SHALL find:
- Complete list of LLM judges with descriptions
- Complete list of code validators with descriptions
- Usage examples for each type

#### Scenario: README includes best practices
Given `examples/showcase/vision/README.md`
When a user looks for best practices
Then they SHALL find guidance on:
- Context engineering (progressive disclosure)
- Token budgeting (image costs)
- Cost optimization strategies
- Provider selection

#### Scenario: README documents success criteria
Given `examples/vision/README.md`
When a user wants to understand evaluation metrics
Then they SHALL find:
- Scoring dimension weights
- Passing thresholds
- Performance expectations

---

### Requirement: Configuration Files MUST enable easy setup
The `.agentv/` directory SHALL contain configuration files for running vision evals.

#### Scenario: Config file specifies directories
Given `examples/showcase/vision/.agentv/config.yaml`
When loaded
Then it SHALL specify:
- `evalsDir: ./evals`
- `evaluatorsDir: ./evaluators`

#### Scenario: Targets file includes vision models
Given `examples/showcase/vision/.agentv/targets.yaml`
When loaded
Then it SHALL define targets for:
- OpenAI GPT-4o (default)
- Anthropic Claude 3.5 Sonnet
- Google Gemini 2.5 Flash
With appropriate environment variable references.

---

### Requirement: Test Images Directory MUST be provided
The examples SHALL include a `test-images/` directory for users to place their own test images.

#### Scenario: Test images directory exists
Given the vision examples structure
When checking `examples/showcase/vision/test-images/`
Then the directory SHALL exist with a `.gitkeep` file.

#### Scenario: README documents image requirements
Given `examples/showcase/vision/README.md`
When a user wants to add test images
Then they SHALL find specifications for:
- Supported formats (JPEG, PNG, WEBP, GIF, BMP)
- Size limits (50x50 to 16,000x16,000 pixels, max 20MB)
- File naming conventions
- Which images are needed for which eval cases

---

### Requirement: Research Documentation MUST be accessible
The research findings that informed the vision evaluation design SHALL be documented and referenced.

#### Scenario: Research summary is available
Given `docs/updates/VISION_EVAL_RESEARCH_SUMMARY.md`
When a user wants to understand design rationale
Then they SHALL find:
- Analysis of 5 leading frameworks
- Key findings by framework
- Implementation recommendations
- Best practices summary
- References to source repositories

#### Scenario: README links to research
Given `examples/showcase/vision/README.md`
When a user wants deeper context
Then they SHALL find a link to the research summary document.

---

## Cross-References

**Related Capabilities:**
- `vision-input` - Provides image input support used in examples
- `vision-evaluators` - Provides evaluators used in examples
- `yaml-schema` - Examples use extended schema
- `eval-execution` - Examples are run via eval execution

**Dependencies:**
- Requires `vision-input` and `vision-evaluators` to be implemented
- Examples serve as integration tests for those capabilities

---

## Implementation Notes

### Directory Structure
```
examples/showcase/vision/
├── .agentv/
│   ├── config.yaml
│   └── targets.yaml
├── datasets/
│   ├── basic-image-analysis.yaml (7 cases)
│   └── advanced-vision-tasks.yaml (7 cases)
├── evaluators/
│   ├── llm-judges/
│   │   ├── image-description-judge.md
│   │   ├── activity-judge.md
│   │   ├── comparison-judge.md
│   │   ├── reasoning-judge.md
│   │   ├── structured-output-judge.md
│   │   └── quality-assessment-judge.md
│   └── code-validators/
│       ├── count_validator.py
│       ├── ocr_validator.py
│       ├── json_validator.py
│       └── chart_validator.py
├── test-images/
│   └── .gitkeep
├── README.md (comprehensive guide)
└── INDEX.md (quick reference)
```

### Eval Case Distribution

**Basic (7 cases):**
1. simple-image-description
2. object-detection-simple
3. spatial-relationships
4. text-extraction-ocr
5. multi-image-comparison
6. color-identification
7. image-from-url

**Advanced (7 cases):**
1. structured-object-detection
2. visual-reasoning-problem
3. multi-turn-image-discussion-part1
4. multi-turn-image-discussion-part2
5. image-quality-assessment
6. chart-data-extraction
7. scene-context-inference
8. instruction-following-with-image

### Documentation Hierarchy
1. **INDEX.md** - Quick start, table of contents
2. **README.md** - Comprehensive usage guide
3. **Research Summary** - Deep dive into design rationale

---

## Future Enhancements (Out of Scope)
- Pre-included sample test images (users provide their own)
- Video tutorial or walkthrough
- Interactive web-based examples
- Automated eval case generation from templates
- Domain-specific example sets (medical, document analysis, etc.)
