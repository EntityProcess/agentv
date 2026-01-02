# ADK-Python Image Evaluation Research Report

Research Date: January 2, 2026
Repository: google/adk-python (https://github.com/google/adk-python)

## Executive Summary

Google's ADK (Agent Development Kit) Python framework provides a comprehensive evaluation system for AI agents. While the framework doesn't have specific image-only evaluation examples, it demonstrates **multimodal content handling** through its agents and provides a robust evaluation infrastructure that can be adapted for vision tasks.

## Key Findings

### 1. Multimodal Content Handling

#### Image Input Patterns

The ADK framework supports multiple methods for handling non-text content:

**a) Inline Image Data (Base64)**
```python
from google.genai import types
import base64

# Sample image data as base64
SAMPLE_IMAGE_DATA = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="
)

# Create inline data part
types.Part(
    inline_data=types.Blob(
        data=SAMPLE_IMAGE_DATA,
        mime_type="image/png",
        display_name="sample_chart.png",
    )
)
```

**b) File URI References**
```python
# GCS URI (Vertex AI)
types.Part.from_uri(file_uri="gs://cloud-samples-data/generative-ai/pdf/2403.05530.pdf")

# HTTPS URL
types.Part(
    file_data=types.FileData(
        file_uri="https://storage.googleapis.com/cloud-samples-data/generative-ai/pdf/2403.05530.pdf",
        mime_type="application/pdf",
        display_name="Research Paper",
    )
)

# Files API Upload (Gemini Developer API)
client = genai.Client()
uploaded_file = client.files.upload(file=temp_file_path)
types.Part(
    file_data=types.FileData(
        file_uri=uploaded_file.uri,
        mime_type="text/markdown",
        display_name="Contributing Guide",
    )
)
```

**c) Tool Return Values**
```python
def get_image():
    """Tool that returns image parts"""
    return [types.Part.from_uri(file_uri="gs://replace_with_your_image_uri")]
```

**Key Pattern**: Images can be passed as:
- Part of static instructions (context)
- User input content
- Tool responses
- Multimodal tool results

### 2. Evaluation Framework Architecture

#### Core Evaluation Components

**File: `src/google/adk/evaluation/`**

1. **EvalCase** (`eval_case.py`)
   ```python
   class Invocation(EvalBaseModel):
       invocation_id: str
       user_content: genai_types.Content  # Can contain image parts
       final_response: Optional[genai_types.Content]
       intermediate_data: Optional[IntermediateDataType]
       rubrics: Optional[list[Rubric]]
   
   class EvalCase(EvalBaseModel):
       eval_id: str
       conversation: Optional[StaticConversation]
       conversation_scenario: Optional[ConversationScenario]
       rubrics: Optional[list[Rubric]]
   ```

2. **Rubrics** (`eval_rubrics.py`)
   ```python
   class RubricContent(EvalBaseModel):
       text_property: Optional[str] = Field(
           description='The property being evaluated. Example: "The agent\'s response is grammatically correct."'
       )
   
   class Rubric(EvalBaseModel):
       rubric_id: str
       rubric_content: RubricContent
       description: Optional[str]
       type: Optional[str]  # e.g., "TOOL_USE_QUALITY", "FINAL_RESPONSE_QUALITY"
   
   class RubricScore(EvalBaseModel):
       rubric_id: str
       rationale: Optional[str]
       score: Optional[float]
   ```

3. **Evaluation Metrics** (`eval_metrics.py`)
   ```python
   class PrebuiltMetrics(Enum):
       TOOL_TRAJECTORY_AVG_SCORE = "tool_trajectory_avg_score"
       RESPONSE_EVALUATION_SCORE = "response_evaluation_score"
       RESPONSE_MATCH_SCORE = "response_match_score"
       SAFETY_V1 = "safety_v1"
       FINAL_RESPONSE_MATCH_V2 = "final_response_match_v2"
       RUBRIC_BASED_FINAL_RESPONSE_QUALITY_V1 = "rubric_based_final_response_quality_v1"
       HALLUCINATIONS_V1 = "hallucinations_v1"
       RUBRIC_BASED_TOOL_USE_QUALITY_V1 = "rubric_based_tool_use_quality_v1"
   
   class JudgeModelOptions(EvalBaseModel):
       judge_model: str = "gemini-2.5-flash"
       num_samples: int = 5  # Sample multiple times for reliability
   
   class RubricsBasedCriterion(BaseCriterion):
       judge_model_options: JudgeModelOptions
       rubrics: list[Rubric]
   ```

4. **Evaluation Configuration** (`eval_config.py`)
   ```python
   class EvalConfig(BaseModel):
       criteria: dict[str, Union[Threshold, BaseCriterion]]
       user_simulator_config: Optional[BaseUserSimulatorConfig]
   
   # Example configuration
   {
       "criteria": {
           "tool_trajectory_avg_score": 1.0,
           "response_match_score": 0.5,
           "final_response_match_v2": {
               "threshold": 0.5,
               "judge_model_options": {
                   "judge_model": "gemini-2.5-flash",
                   "num_samples": 5
               }
           }
       }
   }
   ```

### 3. Multimodal Agent Examples

#### Example 1: Static Non-Text Content
**Location**: `contributing/samples/static_non_text_content/`

```python
def create_static_instruction_with_file_upload():
    """Create static instruction with images and files"""
    
    parts = [
        types.Part.from_text(text="You are an AI assistant..."),
        
        # Inline image data
        types.Part(
            inline_data=types.Blob(
                data=SAMPLE_IMAGE_DATA,
                mime_type="image/png",
                display_name="sample_chart.png",
            )
        ),
        
        types.Part.from_text(text="This is a sample chart..."),
    ]
    
    # Add file references based on API variant
    if api_variant == GoogleLLMVariant.VERTEX_AI:
        parts.append(
            types.Part(file_data=types.FileData(
                file_uri="gs://cloud-samples-data/generative-ai/pdf/2403.05530.pdf",
                mime_type="application/pdf",
            ))
        )
    
    return types.Content(parts=parts)

root_agent = Agent(
    model="gemini-2.5-flash",
    name="static_non_text_content_demo_agent",
    static_instruction=create_static_instruction_with_file_upload(),
    instruction="Please analyze the user's question..."
)
```

#### Example 2: Multimodal Tool Results
**Location**: `contributing/samples/multimodal_tool_results/`

```python
def get_image():
    """Tool that returns image parts"""
    return [types.Part.from_uri(file_uri="gs://replace_with_your_image_uri")]

root_agent = LlmAgent(
    name="image_describing_agent",
    description="image describing agent",
    instruction="Get the image using the get_image tool, and describe it.",
    model="gemini-2.0-flash",
    tools=[get_image],
)

app = App(
    name="multimodal_tool_results",
    root_agent=root_agent,
    plugins=[MultimodalToolResultsPlugin()],
)
```

#### Example 3: Image Generation Agent
**Location**: `contributing/samples/generate_image/`

Shows how to generate images and handle them in the conversation flow.

### 4. Best Practices for Image Evaluation

Based on the framework's patterns, here are recommended approaches:

#### A. Test Case Structure

```python
# eval_case with image input
test_case = EvalCase(
    eval_id="vision_test_001",
    conversation=[
        Invocation(
            invocation_id="inv_001",
            user_content=genai_types.Content(
                parts=[
                    types.Part.from_text(text="Describe this image:"),
                    types.Part(
                        inline_data=types.Blob(
                            data=image_bytes,
                            mime_type="image/jpeg",
                        )
                    )
                ]
            ),
            final_response=genai_types.Content(
                parts=[types.Part.from_text(text="Expected response...")]
            ),
            rubrics=[
                Rubric(
                    rubric_id="vision_accuracy",
                    rubric_content=RubricContent(
                        text_property="The agent correctly identifies the main objects in the image"
                    ),
                    type="VISION_ACCURACY"
                ),
                Rubric(
                    rubric_id="vision_detail",
                    rubric_content=RubricContent(
                        text_property="The agent provides detailed description including colors, positions, and context"
                    ),
                    type="VISION_DETAIL"
                )
            ]
        )
    ]
)
```

#### B. Evaluation Configuration for Vision Tasks

```python
eval_config = EvalConfig(
    criteria={
        # Use LLM-as-judge for vision tasks
        "rubric_based_final_response_quality_v1": RubricsBasedCriterion(
            threshold=0.7,
            judge_model_options=JudgeModelOptions(
                judge_model="gemini-2.5-flash",  # Vision-capable model
                num_samples=5
            ),
            rubrics=[
                Rubric(
                    rubric_id="object_detection",
                    rubric_content=RubricContent(
                        text_property="The response correctly identifies all major objects visible in the image"
                    )
                ),
                Rubric(
                    rubric_id="spatial_understanding",
                    rubric_content=RubricContent(
                        text_property="The response accurately describes spatial relationships between objects"
                    )
                ),
                Rubric(
                    rubric_id="detail_completeness",
                    rubric_content=RubricContent(
                        text_property="The response includes relevant details about colors, textures, and context"
                    )
                )
            ]
        ),
        
        # Safety check for vision
        "safety_v1": 0.9,
        
        # Hallucination detection
        "hallucinations_v1": HallucinationsCriterion(
            threshold=0.2,  # Low threshold = fewer hallucinations allowed
            judge_model_options=JudgeModelOptions(
                judge_model="gemini-2.5-flash",
                num_samples=3
            )
        )
    }
)
```

#### C. Tool Trajectory Evaluation for Vision Agents

```python
# When evaluating vision agents that use tools
eval_config = EvalConfig(
    criteria={
        "tool_trajectory_avg_score": ToolTrajectoryCriterion(
            threshold=1.0,
            match_type=ToolTrajectoryCriterion.MatchType.IN_ORDER
        ),
        "rubric_based_tool_use_quality_v1": RubricsBasedCriterion(
            threshold=0.8,
            rubrics=[
                Rubric(
                    rubric_id="tool_selection",
                    rubric_content=RubricContent(
                        text_property="The agent selects appropriate vision tools for the task"
                    ),
                    type="TOOL_USE_QUALITY"
                )
            ]
        )
    }
)
```

### 5. Key Architectural Patterns

#### Pattern 1: Content Parts as Universal Container

```python
# Content is composed of Parts
# Parts can be: text, inline_data (images), file_data (URIs), function_call, function_response
class Content:
    parts: list[Part]
    role: str  # "user" | "model"

# This allows mixing text and images naturally
user_input = Content(
    role="user",
    parts=[
        Part.from_text("What's in this image?"),
        Part(inline_data=Blob(data=image_data, mime_type="image/jpeg"))
    ]
)
```

#### Pattern 2: Static Instructions with Context

```python
# Static instructions can include visual context that's available to all conversations
agent = Agent(
    static_instruction=Content(
        parts=[
            Part.from_text("You are a visual assistant..."),
            Part(inline_data=Blob(...)),  # Reference image
            Part.from_text("Use the reference image above as context...")
        ]
    ),
    instruction="Dynamic per-request instructions..."
)
```

#### Pattern 3: Multimodal Tool Results

```python
# Tools can return multimodal content
def analyze_chart():
    return [
        Part.from_text("Chart shows upward trend"),
        Part.from_uri("gs://bucket/enhanced_chart.png")
    ]

# Framework handles multimodal tool results through plugins
app = App(
    root_agent=agent,
    plugins=[MultimodalToolResultsPlugin()]
)
```

#### Pattern 4: LLM-as-Judge for Multimodal Evaluation

```python
# Use vision-capable judge model to evaluate vision task responses
judge_evaluates = f"""
Given:
- Original image: {image_uri}
- User question: {user_question}
- Agent response: {agent_response}
- Rubric: {rubric.rubric_content.text_property}

Evaluate if the response satisfies the rubric criterion.
Score: 0-1
"""
```

### 6. Event Logging Structure

The framework logs detailed event information:

```python
{
    "invocation_id": "CFs9iCdD",
    "event_id": "urXUWHfc",
    "model_request": {
        "model": "gemini-1.5-flash",
        "contents": [/* multimodal content */],
        "config": {
            "system_instruction": "...",
            "tools": [/* tool definitions */]
        }
    },
    "model_response": {
        "candidates": [{
            "content": {/* response content */},
            "finish_reason": "STOP",
            "safety_ratings": [/* safety scores */]
        }],
        "usage_metadata": {
            "candidates_token_count": 16,
            "prompt_token_count": 84,
            "total_token_count": 100
        }
    }
}
```

## Recommendations for AgentV Implementation

### 1. Eval Case Structure

```typescript
interface VisionEvalCase {
  eval_id: string;
  invocations: Array<{
    user_content: {
      text: string;
      images?: Array<{
        data: string;  // base64 or URI
        mime_type: string;
        display_name?: string;
      }>;
    };
    expected_response?: string;
    rubrics: Array<{
      rubric_id: string;
      criterion: string;
      type: "VISION_ACCURACY" | "VISION_DETAIL" | "SPATIAL_UNDERSTANDING";
    }>;
  }>;
}
```

### 2. YAML Configuration Pattern

```yaml
eval_cases:
  - eval_id: "image_description_001"
    conversation:
      - invocation_id: "inv_001"
        user_content:
          text: "Describe the objects in this image"
          images:
            - uri: "file://./test_images/scene_001.jpg"
              mime_type: "image/jpeg"
        rubrics:
          - rubric_id: "object_detection"
            criterion: "Correctly identifies all major objects"
            threshold: 0.8
          - rubric_id: "spatial_relations"
            criterion: "Accurately describes object positions"
            threshold: 0.7

eval_config:
  criteria:
    rubric_based_vision_quality:
      threshold: 0.75
      judge_model: "gemini-2.5-flash"
      num_samples: 5
```

### 3. Rubric Types for Vision

- **VISION_ACCURACY**: Object detection accuracy
- **VISION_DETAIL**: Level of detail in descriptions
- **SPATIAL_UNDERSTANDING**: Understanding of spatial relationships
- **COLOR_ACCURACY**: Correct identification of colors
- **CONTEXT_UNDERSTANDING**: Understanding scene context
- **OCR_ACCURACY**: Text extraction accuracy (if applicable)
- **VISUAL_REASONING**: Ability to reason about visual content

### 4. Multi-Sample Evaluation

Follow ADK's pattern of sampling judge model multiple times (default: 5) for reliability:

```python
num_samples = 5
scores = []
for _ in range(num_samples):
    score = judge_model.evaluate(image, response, rubric)
    scores.append(score)
final_score = statistics.mean(scores)
```

### 5. Image Storage Patterns

Support multiple image sources:
- **Inline Base64**: For small images in YAML
- **File URIs**: `file://./path/to/image.jpg`
- **HTTP/HTTPS URIs**: For external images
- **Cloud Storage**: `gs://bucket/image.jpg` (if using GCP)

### 6. Evaluation Flow

```
1. Load eval case with image references
2. Resolve image data (download if URI, decode if base64)
3. Run agent with image + text input
4. Collect agent response
5. For each rubric:
   a. Sample judge model N times
   b. Average scores
   c. Compare to threshold
6. Aggregate results
7. Generate report
```

## Code Examples to Reference

### Key Files to Study

1. **Multimodal Content Handling**:
   - `contributing/samples/static_non_text_content/agent.py`
   - `contributing/samples/multimodal_tool_results/agent.py`

2. **Evaluation Infrastructure**:
   - `src/google/adk/evaluation/eval_case.py`
   - `src/google/adk/evaluation/eval_rubrics.py`
   - `src/google/adk/evaluation/eval_metrics.py`
   - `src/google/adk/evaluation/eval_config.py`

3. **LLM-as-Judge Implementation**:
   - `src/google/adk/evaluation/llm_as_judge.py`
   - `src/google/adk/evaluation/rubric_based_evaluator.py`

4. **Safety and Hallucination Detection**:
   - `src/google/adk/evaluation/safety_evaluator.py`
   - `src/google/adk/evaluation/hallucinations_v1.py`

## Gaps and Adaptations Needed

### What ADK Doesn't Provide

1. **No specific vision-focused eval examples**
   - Need to create vision-specific rubrics
   - Need vision test datasets

2. **No image similarity metrics**
   - No CLIP score, SSIM, etc.
   - Relies on LLM-as-judge for vision evaluation

3. **No automated image annotation**
   - Need to manually create expected responses
   - No computer vision metrics integration

### What to Adapt

1. **Create vision-specific rubric library**
   ```python
   VISION_RUBRICS = {
       "object_detection": "Identifies all major objects correctly",
       "spatial_understanding": "Describes spatial relationships accurately",
       "color_accuracy": "Identifies colors correctly",
       # etc.
   }
   ```

2. **Image preprocessing utilities**
   ```python
   def prepare_image_for_eval(image_path):
       # Resize, normalize, encode as base64
       pass
   ```

3. **Vision-specific judge prompts**
   ```python
   VISION_JUDGE_TEMPLATE = """
   You are evaluating a vision AI agent's response.
   
   Image: {image_uri}
   Question: {question}
   Agent Response: {response}
   Rubric: {rubric}
   
   Score the response 0-1 based on the rubric.
   """
   ```

## Conclusion

The ADK-Python framework provides a solid foundation for multimodal evaluation through:

1. **Flexible content model** supporting images via inline_data and file_data
2. **Rubric-based evaluation** system adaptable to vision tasks
3. **LLM-as-judge pattern** that works with vision-capable models
4. **Multi-sample evaluation** for reliability
5. **Comprehensive event logging** for debugging

**Key Takeaway**: While ADK doesn't have vision-specific examples, its architecture is well-suited for image evaluation. The main work needed is creating vision-specific rubrics and test cases, which can follow the existing patterns for text-based evaluation.

## References

- Repository: https://github.com/google/adk-python
- Static Non-Text Content Example: `contributing/samples/static_non_text_content/`
- Multimodal Tool Results: `contributing/samples/multimodal_tool_results/`
- Evaluation Module: `src/google/adk/evaluation/`
