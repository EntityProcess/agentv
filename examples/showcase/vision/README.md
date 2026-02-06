# Vision Evaluation Examples

This directory contains example evaluation files for testing AI agents with vision/image capabilities.

## Overview

Vision evaluation in AgentV extends the standard eval framework to support:
- Image inputs (local files and URLs)
- Multi-image comparisons
- Vision-specific evaluators (both LLM judges and code validators)
- Structured outputs from vision tasks
- Multi-turn conversations with visual context

## Quick Start

### Basic Image Analysis

```bash
# From examples/showcase/vision/ directory
agentv run datasets/basic-image-analysis.yaml

# Or from repository root
agentv run examples/showcase/vision/datasets/basic-image-analysis.yaml
```

### Advanced Vision Tasks

```bash
# From examples/showcase/vision/ directory
agentv run datasets/advanced-vision-tasks.yaml

# Or from repository root
agentv run examples/showcase/vision/datasets/advanced-vision-tasks.yaml
```

## Image Input Formats

### Local File Reference

```yaml
- type: image
  value: ./test-images/sample-office.jpg
  detail: high  # Options: low, high, auto
```

### Image URL

```yaml
- type: image_url
  value: https://example.com/image.jpg
```

### Data URI (Base64)

```yaml
- type: image
  value: data:image/jpeg;base64,/9j/4AAQSkZJRg...
```

## Evaluation Files

### datasets/basic-image-analysis.yaml

Demonstrates fundamental vision capabilities:
- **Simple image description** - Basic captioning
- **Object detection** - Counting and identifying objects
- **Spatial reasoning** - Understanding positions and layouts
- **Text extraction (OCR)** - Reading text from images
- **Image comparison** - Analyzing changes between images
- **Color analysis** - Identifying colors and schemes
- **URL loading** - Loading images from web URLs

### datasets/advanced-vision-tasks.yaml

Demonstrates complex vision scenarios:
- **Structured JSON output** - Vision data as JSON
- **Visual reasoning** - Logic applied to visual information (e.g., chess)
- **Multi-turn conversations** - Context maintained across turns
- **Image quality assessment** - Technical and aesthetic evaluation
- **Chart/graph analysis** - Data extraction from visualizations
- **Scene understanding** - Contextual inference
- **Instruction following** - Complex tasks with visual reference

## Evaluators

### LLM-Based Judges

Located in `evaluators/llm-judges/`:

1. **image-description-judge.md**
   - Evaluates description accuracy and completeness
   - Dimensions: Visual Accuracy (40%), Completeness (30%), Clarity (20%), Relevance (10%)
   - Detects hallucinations and missing elements

2. **activity-judge.md**
   - Evaluates activity and action recognition
   - Assesses people counting, pose recognition, interaction understanding

3. **comparison-judge.md**
   - Evaluates multi-image comparison quality
   - Tests change detection, spatial precision, completeness

4. **reasoning-judge.md**
   - Evaluates logical reasoning with visual information
   - Tests visual understanding, problem-solving, explanation quality
   - Supports multiple reasoning types (spatial, logical, quantitative)

### Code-Based Validators

Located in `evaluators/code-validators/`:

1. **count_validator.py**
   - Validates object counts in responses
   - Extracts numbers and matches against expected counts
   - Usage: `uv run count_validator.py`

2. **ocr_validator.py**
   - Validates text extraction accuracy
   - Uses text similarity and keyword matching
   - Configurable threshold (default: 70%)

3. **json_validator.py**
   - Validates structured JSON outputs from vision
   - Schema inference from expected output
   - Checks field presence and types

4. **chart_validator.py**
   - Validates data extraction from charts/graphs
   - Extracts currency values, percentages, quarters
   - Tolerance-based numeric validation (default: 15%)

## Best Practices from Research

### Context Engineering (from Agent-Skills research)

1. **Progressive Disclosure**
   - Load image metadata first (50 tokens)
   - Then descriptions (100 tokens)
   - Finally full image (765-1360 tokens)

2. **Token Budgeting**
   - Small image (512x512): ~765 tokens
   - Large image (2048x2048): ~1360 tokens
   - Budget context at 70-80% utilization

3. **File System State**
   - Store images and analyses as files
   - Pass file references in context, not image data

### Evaluation Patterns (from Google ADK)

1. **Multi-Sample Evaluation**
   - Run evaluators 5 times for reliability
   - Use vision-capable judge models (GPT-4V, Claude)

2. **Rubric-Based Grading**
   - Define clear success criteria
   - Weight dimensions appropriately
   - Support partial credit

### Input Handling (from Mastra & Azure SDK)

1. **Flexible Image Sources**
   - Local files: `./images/photo.jpg`
   - HTTP URLs: `https://...`
   - Cloud storage: `gs://...` or `s3://...`
   - Data URIs: `data:image/jpeg;base64,...`

2. **MIME Type Specification**
   - Always include for better compatibility
   - Common types: `image/jpeg`, `image/png`, `image/webp`

3. **Detail Level Control**
   - `low`: Faster, cheaper, less detail
   - `high`: Slower, more expensive, more detail
   - `auto`: Let model decide

## Creating Test Images

For local testing, place test images in `test-images/` directory. See `test-images/README.md` for detailed guidance on:
- Required test images for each eval case
- Image format and size requirements
- Alternative URL-based approaches
- Sources for obtaining test images

### Example Test Images Structure

```bash
examples/showcase/vision/test-images/
├── README.md (detailed instructions)
├── .gitkeep
├── sample-office.jpg
├── objects-scene.jpg
├── spatial-layout.jpg
├── text-document.jpg
├── comparison-before.jpg
├── comparison-after.jpg
├── colorful-scene.jpg
├── street-scene.jpg
├── chess-puzzle.jpg
├── activity-photo.jpg
├── quality-test.jpg
├── bar-chart.jpg
├── complex-scene.jpg
└── instruction-reference.jpg
```

### Image Requirements

- **Formats**: JPEG, PNG, GIF, BMP, WEBP
- **Size limits**: 
  - Max: 20 MB, 16,000 x 16,000 pixels
  - Min: 50 x 50 pixels
- **Best practices**:
  - Use JPEG for photos
  - Use PNG for screenshots, diagrams, text
  - Optimize file size (aim for <5 MB)
  - Ensure clear, well-lit images for OCR tasks

## Multi-Turn Vision Conversations

Example pattern for maintaining visual context:

```yaml
- id: conversation-turn-1
  conversation_id: vision-convo-001
  input_messages:
    - role: user
      content:
        - type: text
          value: "What's in this image?"
        - type: image
          value: ./image.jpg
  expected_messages:
    - role: assistant
      content: "Description of image..."

- id: conversation-turn-2
  conversation_id: vision-convo-001
  input_messages:
    # Include full conversation history
    - role: user
      content:
        - type: text
          value: "What's in this image?"
        - type: image
          value: ./image.jpg
    - role: assistant
      content: "Description of image..."
    - role: user
      content: "Tell me more about the left side"
  expected_messages:
    - role: assistant
      content: "Details about left side..."
```

## Evaluation Metrics

### Dimension Weights (Recommended)

Based on research from Google ADK and LangWatch:

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
- Problem-Solving Quality: 20%
- Explanation Quality: 10%

**Image Comparison**:
- Change Detection Accuracy: 40%
- Spatial Precision: 25%
- Completeness: 20%
- Clarity: 15%

### Scoring Thresholds

- **0.9-1.0**: Excellent - Production ready
- **0.7-0.89**: Good - Minor improvements needed
- **0.5-0.69**: Acceptable - Significant gaps
- **0.3-0.49**: Poor - Major issues
- **0.0-0.29**: Failed - Not functional

## Integration with AgentV Core

### Required Model Capabilities

Ensure your model supports vision:
- ✅ OpenAI: GPT-4o, GPT-4 Turbo with Vision
- ✅ Anthropic: Claude 3.5 Sonnet, Claude 3 Opus/Haiku
- ✅ Google: Gemini 2.5 Pro/Flash, Gemini 3 Pro
- ✅ Azure: GPT-4o via Azure OpenAI

### Configuration

Configure vision-capable models in `.agentv/targets.yaml`:

```yaml
targets:
  gpt4v:
    provider: openai
    model: gpt-4o
    apiKey: ${OPENAI_API_KEY}
  
  claude-vision:
    provider: anthropic
    model: claude-3-5-sonnet-20241022
    apiKey: ${ANTHROPIC_API_KEY}
  
  gemini-vision:
    provider: google
    model: gemini-2.5-flash
    apiKey: ${GOOGLE_API_KEY}
```

## Cost Considerations

Vision API costs are significantly higher than text:

| Provider | Model | Cost per Image* | Notes |
|----------|-------|----------------|-------|
| OpenAI | GPT-4o | $2.50-$5.00 / 1K images | Detail level affects cost |
| Anthropic | Claude 3.5 | $3.00-$6.00 / 1K images | Resolution-based pricing |
| Google | Gemini 2.5 Flash | $0.04-$0.15 / 1K images | Most cost-effective |

*Estimates based on average image size and detail level

### Cost Optimization Tips

1. Use `detail: low` for simple tasks
2. Resize large images before sending
3. Use Gemini Flash for high-volume testing
4. Cache image descriptions for reuse
5. Use code validators when possible (free)

## Future Enhancements

Based on research findings, potential additions:

1. **Computer Vision Metrics**
   - SSIM (structural similarity)
   - Perceptual hashing
   - CLIP embeddings similarity

2. **Specialized Evaluators**
   - Face detection validation
   - Logo recognition accuracy
   - Medical image analysis
   - Document understanding

3. **Batch Processing**
   - Parallel image evaluation
   - Progress tracking
   - Cost reporting

4. **UI Integration**
   - Visual diff tools
   - Side-by-side comparisons
   - Annotation overlays

## References

For detailed research findings and framework analysis, see: [Vision Evaluation Research Summary](../../openspec/changes/add-vision-evaluation/references/research-summary.md)

Research sources consulted:

1. **Google ADK Python** - Rubric-based evaluation, multimodal content handling
2. **Mastra** - TypeScript patterns, structured outputs, Braintrust integration
3. **Azure SDK** - Image input patterns, Computer Vision API
4. **LangWatch** - Evaluation architecture, batch processing
5. **Agent Skills** - Context engineering, progressive disclosure patterns

## Support

For issues or questions:
- Check existing eval examples
- Review evaluator documentation
- Consult AgentV core documentation
- Open GitHub issue with reproduction case

## License

Same as AgentV project license.
