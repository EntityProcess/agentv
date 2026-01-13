# Proposal: Add Vision Evaluation Capabilities

## Change ID
`add-vision-evaluation`

## Status
🟡 **Proposed** - Awaiting approval

## Summary
Add comprehensive image/vision evaluation capabilities to AgentV, enabling testing of AI agents with multimodal (text + image) inputs. This includes support for image inputs, vision-specific evaluators, and self-contained vision evaluation examples.

## Motivation

### Problem
AgentV currently only supports text-based evaluation. Modern AI agents increasingly work with vision-capable models (GPT-4V, Claude 3.5 Sonnet, Gemini Vision) that can analyze images, but there's no way to:
- Include images in evaluation test cases
- Evaluate the accuracy of visual analysis
- Test multimodal agent behaviors
- Compare vision performance across models

### Impact
Without vision evaluation support:
- Cannot test image description, object detection, OCR capabilities
- No way to validate spatial reasoning or visual understanding
- Missing coverage for multimodal agent workflows
- Cannot evaluate vision-specific failure modes (hallucinations, misidentification)

### Value Proposition
Adding vision evaluation enables:
- **Comprehensive testing**: Full coverage of multimodal agent capabilities
- **Quality assurance**: Validate visual analysis accuracy with specialized evaluators
- **Model comparison**: Compare vision performance across providers
- **Cost optimization**: Measure token costs for image processing
- **Real-world scenarios**: Test agents on tasks requiring visual understanding

## Research Foundation

This proposal is based on analysis of 4 leading AI agent and evaluation frameworks:
- **Google ADK-Python**: Rubric-based evaluation, multimodal content model
- **Mastra**: TypeScript patterns, structured outputs, Braintrust integration
- **Azure SDK**: Image input APIs, Computer Vision patterns, testing infrastructure
- **LangWatch**: Evaluation architecture, batch processing, flexible scoring

Detailed research findings are documented in `references/research-summary.md`.

## Scope

### In Scope
1. **Image Input Support** (YAML schema extension)
   - Local file paths (`./images/photo.jpg`)
   - HTTP/HTTPS URLs (`https://example.com/image.jpg`)
   - Base64 data URIs (`data:image/jpeg;base64,...`)
   - Detail level specification (`low`, `high`, `auto`)

2. **Vision Evaluators**
   - 6 LLM-based judges (description, activity, comparison, reasoning, quality, structured output)
   - 4 code-based validators (count, OCR, JSON structure, chart data)

3. **Self-Contained Examples**
   - Move vision evaluation to `examples/vision/` (self-contained folder)
   - 14 example eval cases (7 basic, 7 advanced)
   - Sample test images and documentation

4. **Documentation**
   - Comprehensive README
   - Quick reference index
   - Research summary

### Out of Scope (Future Work)
- Computer vision metrics (SSIM, CLIP embeddings, perceptual hashing)
- Automatic image preprocessing/resizing
- Image generation evaluation
- Video input support
- Cloud storage integration (gs://, s3://)
- Progressive disclosure implementation
- Token budgeting automation
- Cost tracking per evaluation

## Design Decisions

### 1. YAML Schema Extension
**Decision**: Extend existing `content` array format to support image content types.

**Rationale**: 
- Consistent with existing multi-part message structure
- Follows patterns from Mastra and Azure SDK
- Allows mixing text and images naturally
- Supports multiple images per message

**Example**:
```yaml
input_messages:
  - role: user
    content:
      - type: text
        value: "Describe this image"
      - type: image
        value: ./test-images/photo.jpg
        detail: high
```

**Alternatives Considered**:
- ❌ Separate `images` field: Breaks natural message flow
- ❌ String-only with special syntax: Not extensible
- ✅ Content array with type discrimination: Flexible, extensible

### 2. Evaluator Organization
**Decision**: Create `evaluators/vision/` with both LLM judges (`.md`) and code validators (`.py`).

**Rationale**:
- LLM judges for subjective assessment (quality, completeness)
- Code validators for objective metrics (counts, structure)
- Separation of concerns
- Easy to add new evaluators

**Categories**:
- **LLM Judges**: Description, Activity, Comparison, Reasoning, Quality Assessment, Structured Output
- **Code Validators**: Count, OCR, JSON Structure, Chart Data

### 3. Self-Contained Structure
**Decision**: Move from `examples/features/evals/vision/` to `examples/showcase/vision/` with all assets included.

**Rationale**:
- Follows showcase pattern for feature demonstrations
- Single folder contains: datasets, evaluators, test images, docs
- Easier to discover and understand
- Can be copied/shared as complete package

**Structure**:
```
examples/showcase/vision/
├── .agentv/
│   ├── config.yaml
│   └── targets.yaml
├── datasets/
│   ├── basic-image-analysis.yaml
│   └── advanced-vision-tasks.yaml
├── evaluators/
│   ├── llm-judges/
│   │   └── *.md (6 judges)
│   └── code-validators/
│       └── *.py (4 validators)
├── test-images/
│   └── (sample images)
└── README.md
```

### 4. Detail Level Support
**Decision**: Support `detail` parameter for cost/quality trade-offs.

**Rationale**:
- Mirrors OpenAI, Anthropic, Google APIs
- Enables cost optimization (`low` saves ~90% tokens)
- Performance tuning (high detail for complex analysis)

**Values**:
- `low`: ~85 tokens, faster, cheaper
- `high`: ~765-1360 tokens, detailed analysis
- `auto`: Model decides based on task

### 5. Multi-Sample Evaluation
**Decision**: Document pattern but don't automate yet.

**Rationale**:
- Research shows 3-5 samples improves reliability
- Implementation deferred to future work
- Can be done manually for now

## Dependencies

### Technical Dependencies
- Existing YAML schema parser
- Evaluation execution engine
- LLM provider integrations (OpenAI, Anthropic, Google)
- `uv` for running Python validators

### Spec Dependencies
- `yaml-schema`: Requires extension for image content types
- `evaluation`: May need updates for multimodal scoring
- `eval-execution`: Needs image loading/passing to providers

### Example Dependencies
- Vision-capable models configured in targets
- Test images provided by users (not included in repo)

## Risks & Mitigations

### Risk 1: Token Cost
**Description**: Images consume 765-1360 tokens each, making evals expensive.

**Mitigation**:
- Document cost implications clearly
- Support `detail: low` for testing (90% savings)
- Recommend Gemini Flash for development (20-30x cheaper)
- Use code validators when possible (free)

**Severity**: Medium  
**Likelihood**: High

### Risk 2: Provider Compatibility
**Description**: Different providers have varying image input formats and capabilities.

**Mitigation**:
- Test with all major providers (OpenAI, Anthropic, Google)
- Document provider-specific limitations
- Use common denominator approach
- Clear error messages for unsupported features

**Severity**: Medium  
**Likelihood**: Medium

### Risk 3: Image Availability
**Description**: Local file paths and URLs may not be accessible.

**Mitigation**:
- Validate file existence before execution
- Support multiple input methods (file, URL, base64)
- Clear error messages for missing images
- Document image requirements (size, format)

**Severity**: Low  
**Likelihood**: Medium

### Risk 4: Hallucinations
**Description**: LLM judges may hallucinate when evaluating vision tasks.

**Mitigation**:
- Use vision-capable judge models
- Multi-sample evaluation (3-5 runs)
- Combine with code validators
- Document judge limitations

**Severity**: Medium  
**Likelihood**: Medium

## Implementation Notes

### Phase 1: Schema & Input (Week 1)
- Extend YAML schema for image content types
- Implement image loaders (file, URL, base64)
- Add MIME type detection
- Provider integration for vision APIs

### Phase 2: Evaluators (Week 2)
- Port LLM judge prompts
- Implement Python validator runner
- Test with real vision models
- Validate scoring accuracy

### Phase 3: Examples & Docs (Week 3)
- Reorganize into `examples/vision/`
- Create self-contained structure
- Add comprehensive documentation
- Create quick-start guide

### Phase 4: Validation (Week 4)
- End-to-end testing with multiple providers
- Cost analysis and optimization
- Performance benchmarking
- Documentation review

## Success Criteria

### Functional Requirements
- ✅ Support local files, URLs, and base64 image inputs
- ✅ Pass images to vision-capable LLM providers
- ✅ Run LLM judges with image context
- ✅ Execute code validators with Python
- ✅ Parse vision eval YAML files successfully
- ✅ Generate evaluation scores for vision tasks

### Quality Requirements
- ✅ Evaluation accuracy >90% vs human judgment
- ✅ Object count accuracy >95% (code validators)
- ✅ OCR validation >80% accuracy
- ✅ Hallucination detection >85% accuracy
- ✅ Multi-sample consistency >90%

### Performance Requirements
- ✅ Average eval latency <2s (excluding LLM calls)
- ✅ Support images up to 16MP / 20MB
- ✅ Handle 3+ image formats (JPEG, PNG, WEBP)

### Documentation Requirements
- ✅ README with examples and usage guide
- ✅ Quick reference index
- ✅ Research summary document
- ✅ Provider compatibility matrix
- ✅ Cost optimization guide

## Alternatives Considered

### Alternative 1: External Vision API
**Description**: Use external Computer Vision APIs (Azure, Google Cloud Vision) instead of LLM vision.

**Pros**:
- Potentially more accurate
- Specialized features (object detection, OCR)
- Lower cost per image

**Cons**:
- Additional dependencies
- Inconsistent with agent evaluation (we test LLMs)
- More complex integration
- Not testing actual agent capabilities

**Verdict**: ❌ Rejected - Want to test the actual LLMs agents use

### Alternative 2: Generate Test Images
**Description**: Auto-generate test images using DALL-E/Stable Diffusion.

**Pros**:
- No need for sample images
- Consistent test data
- Easy to create variations

**Cons**:
- Expensive
- Generated images may not match real-world scenarios
- Additional complexity
- Slower test execution

**Verdict**: ❌ Rejected - Out of scope, defer to future

### Alternative 3: Video Support
**Description**: Support video inputs in addition to images.

**Pros**:
- More comprehensive multimodal coverage
- Test temporal understanding

**Cons**:
- Significantly more complex
- Very high token costs
- Limited provider support
- Niche use case

**Verdict**: ❌ Rejected - Out of scope, future consideration

## Open Questions

None - all design decisions have been made based on comprehensive research.

## References

### Research Documents
- `docs/updates/VISION_EVAL_RESEARCH_SUMMARY.md` - Detailed findings from 5 frameworks
- `examples/vision/README.md` - Comprehensive usage guide
- `examples/vision/INDEX.md` - Quick reference

### External Resources
- Google ADK-Python: https://github.com/google/adk-python
- Mastra: https://github.com/mastra-ai/mastra
- Azure SDK: https://github.com/Azure/azure-sdk-for-python
- LangWatch: https://github.com/langwatch/langwatch
- Agent Skills: https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering

### Related Specs
- `yaml-schema` - Requires extension for image content
- `evaluation` - May need multimodal scoring support
- `eval-execution` - Needs image loading capability

## Approval

**Proposed by**: AI Assistant  
**Date**: January 2, 2026  
**Approval required from**: Project maintainers

---

**Next Steps After Approval**:
1. Review and approve this proposal
2. Review `tasks.md` for implementation sequence
3. Review spec deltas in `specs/*/spec.md`
4. Begin implementation following task order
