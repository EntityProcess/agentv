# Implementation Tasks: Add Vision Evaluation

## Overview
This document outlines the ordered tasks for implementing vision evaluation capabilities in AgentV. Tasks are organized to deliver user-visible progress incrementally while managing dependencies.

## Task Dependency Graph
```
Phase 1 (Foundation)
├─ T1: Reorganize files → T2, T3
├─ T2: Schema extension → T4, T5
└─ T3: Documentation → T14

Phase 2 (Core Implementation)
├─ T4: Image loaders → T5
├─ T5: Provider integration → T6, T7
├─ T6: LLM judges → T8, T9
└─ T7: Code validators → T8, T9

Phase 3 (Testing & Validation)
├─ T8: Basic eval tests → T10
├─ T9: Advanced eval tests → T10
├─ T10: Provider compatibility → T11
└─ T11: Cost analysis → T12

Phase 4 (Polish)
├─ T12: Performance optimization → T13
├─ T13: Documentation review → T14
└─ T14: Final validation
```

## Tasks

### Phase 1: Foundation & Structure (Days 1-2)

#### ✅ Task 1: Reorganize Vision Files into Self-Contained Structure
**Priority**: High  
**Effort**: 1 day  
**Dependencies**: None  

**Description**: Move vision evaluation files from `examples/features/evals/vision/` and `examples/features/evaluators/vision/` to a self-contained `examples/showcase/vision/` directory structure.

**Actions**:
1. Create `examples/showcase/vision/` directory structure:
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
   │   └── .gitkeep (users provide their own images)
   └── README.md
   ```

2. Move all existing vision files to new structure
3. Update all relative paths in YAML files to reference new evaluator locations
4. Update documentation paths
5. Delete old `examples/features/evals/vision/` and `examples/features/evaluators/vision/` directories

**Validation**:
- [ ] All files exist in new location
- [ ] No broken relative paths in YAML files
- [ ] Documentation links updated
- [ ] Old directories removed

**User-Visible**: Clear, self-contained vision examples directory

---

#### Task 2: Extend YAML Schema for Image Content Types
**Priority**: High  
**Effort**: 2 days  
**Dependencies**: None  
**Blocks**: T4, T5

**Description**: Extend the existing YAML schema and TypeScript types to support image content in messages.

**Actions**:
1. Add `ImageContentItem` type to content union:
   ```typescript
   type ContentItem = TextContentItem | ImageContentItem | FileContentItem;
   
   interface ImageContentItem {
     type: 'image';
     value: string;  // path, URL, or data URI
     detail?: 'low' | 'high' | 'auto';
     mimeType?: string;
   }
   
   interface ImageURLContentItem {
     type: 'image_url';
     value: string;  // URL only
     detail?: 'low' | 'high' | 'auto';
   }
   ```

2. Update YAML parser to recognize `type: image` and `type: image_url`
3. Add Zod validation schema for image content
4. Update TypeScript interfaces in core package
5. Add schema documentation

**Validation**:
- [ ] TypeScript types compile without errors
- [ ] Zod schema validates image content correctly
- [ ] YAML parser recognizes image types
- [ ] Unit tests for schema parsing pass
- [ ] Invalid image content rejected with clear errors

**User-Visible**: Can write YAML evals with image content

---

#### Task 3: Create Configuration Files
**Priority**: Medium  
**Effort**: 0.5 days  
**Dependencies**: T1  

**Description**: Create `.agentv/` configuration files for the vision examples directory.

**Actions**:
1. Create `.agentv/config.yaml`:
   ```yaml
   version: "1.0"
   evalsDir: ./evals
   evaluatorsDir: ./evaluators
   ```

2. Create `.agentv/targets.yaml` with vision-capable models:
   ```yaml
   targets:
     default:
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
       apiKey: ${GOOGLE_GENERATIVE_AI_API_KEY}
   ```

**Validation**:
- [ ] Config files parse successfully
- [ ] Targets reference vision-capable models
- [ ] Environment variables documented

**User-Visible**: Easy configuration for vision models

---

### Phase 2: Core Implementation (Days 3-6)

#### Task 4: Implement Image Loaders
**Priority**: High  
**Effort**: 2 days  
**Dependencies**: T2  
**Blocks**: T5

**Description**: Implement utilities to load images from various sources and convert to appropriate formats for LLM providers.

**Actions**:
1. Create `packages/core/src/vision/imageLoader.ts`:
   - `loadImageFromFile(path: string): Promise<Buffer>`
   - `loadImageFromURL(url: string): Promise<Buffer>`
   - `parseDataURI(uri: string): Buffer`
   - `detectMimeType(buffer: Buffer): string`
   - `validateImageFormat(buffer: Buffer): boolean`

2. Create `packages/core/src/vision/imageConverter.ts`:
   - `bufferToBase64(buffer: Buffer): string`
   - `createDataURI(base64: string, mimeType: string): string`
   - `resizeIfNeeded(buffer: Buffer, maxDim: number): Promise<Buffer>`

3. Add error handling:
   - File not found
   - Invalid URL
   - Unsupported format
   - File too large (>20MB)
   - Image dimensions out of range

4. Add unit tests for all loaders and converters

**Validation**:
- [ ] Load local files successfully
- [ ] Load HTTP/HTTPS URLs successfully
- [ ] Parse base64 data URIs successfully
- [ ] Detect MIME types correctly (JPEG, PNG, WEBP, GIF)
- [ ] Validate image sizes and dimensions
- [ ] Error messages clear and actionable
- [ ] Unit test coverage >90%

**User-Visible**: Reliable image loading from multiple sources

---

#### Task 5: Integrate Image Support in Provider Clients
**Priority**: High  
**Effort**: 3 days  
**Dependencies**: T2, T4  
**Blocks**: T6, T7

**Description**: Update LLM provider clients (OpenAI, Anthropic, Google) to pass image content correctly.

**Actions**:
1. Update `packages/core/src/providers/openai.ts`:
   - Handle `ImageContentItem` in message content
   - Convert to OpenAI's `image_url` format
   - Support `detail` parameter
   - Pass base64 data URIs

2. Update `packages/core/src/providers/anthropic.ts`:
   - Handle `ImageContentItem` in message content
   - Convert to Anthropic's image format
   - Support `source` with base64 data

3. Update `packages/core/src/providers/google.ts`:
   - Handle `ImageContentItem` in message content
   - Convert to Gemini's `inlineData` format
   - Support both URL and base64

4. Add integration tests with real models (optional, can use mocks)

5. Document provider-specific limitations

**Validation**:
- [ ] OpenAI provider accepts images correctly
- [ ] Anthropic provider accepts images correctly
- [ ] Google provider accepts images correctly
- [ ] Detail levels passed correctly
- [ ] Error handling for unsupported formats
- [ ] Integration tests pass (or mocked tests)

**User-Visible**: Can run evals with images on all major providers

---

#### Task 6: Implement LLM Judge Runner for Vision
**Priority**: High  
**Effort**: 2 days  
**Dependencies**: T5  
**Blocks**: T8, T9

**Description**: Enable LLM judges to evaluate vision tasks by passing image context to judge models.

**Actions**:
1. Update judge prompt renderer to include image references:
   ```typescript
   renderJudgePrompt(
     judgeTemplate: string,
     input: ContentItem[],
     output: string,
     expected: string,
     imageReferences?: string[]
   ): string
   ```

2. Modify LLM judge execution to:
   - Load judge prompt from `.md` file
   - Substitute placeholders (input, output, expected, image_reference)
   - Call judge model with vision capability
   - Parse structured JSON response

3. Add support for multi-image judging

4. Add unit tests for judge rendering and execution

**Validation**:
- [ ] Judge prompts load correctly
- [ ] Image references passed to judge model
- [ ] JSON responses parsed successfully
- [ ] Scoring dimensions extracted
- [ ] Error handling for invalid judge outputs
- [ ] Unit tests pass

**User-Visible**: LLM judges can evaluate image-based responses

---

#### Task 7: Implement Code Validator Runner
**Priority**: High  
**Effort**: 2 days  
**Dependencies**: T5  
**Blocks**: T8, T9

**Description**: Create runner for Python-based code validators that perform objective evaluation.

**Actions**:
1. Create `packages/core/src/evaluators/codeValidatorRunner.ts`:
   - `runPythonValidator(scriptPath: string, evalData: EvalData): Promise<ValidationResult>`
   - Use `uv run` to execute Python scripts
   - Pass eval data as JSON via stdin or args
   - Parse JSON result from stdout
   - Handle Python errors gracefully

2. Create standard interface for validator results:
   ```typescript
   interface ValidationResult {
     status: 'processed' | 'error' | 'skipped';
     score: number;
     passed: boolean;
     details: Record<string, any>;
   }
   ```

3. Add timeout handling (30s default)

4. Add unit tests with mock Python scripts

**Validation**:
- [ ] Python validators execute successfully
- [ ] JSON data passed correctly
- [ ] Results parsed correctly
- [ ] Timeouts handled
- [ ] Python errors reported clearly
- [ ] Unit tests pass

**User-Visible**: Objective code validators work reliably

---

### Phase 3: Testing & Validation (Days 7-10)

#### Task 8: Test Basic Image Analysis Evals
**Priority**: High  
**Effort**: 2 days  
**Dependencies**: T6, T7  
**Blocks**: T10

**Description**: Run all 7 basic eval cases from `basic-image-analysis.yaml` and validate results.

**Actions**:
1. Create sample test images (or use placeholder URLs)
2. Run each eval case:
   - simple-image-description
   - object-detection-simple
   - spatial-relationships
   - text-extraction-ocr
   - multi-image-comparison
   - color-identification
   - image-from-url

3. Verify evaluators run successfully
4. Check score outputs are reasonable
5. Document any issues or edge cases
6. Create test fixtures for automated testing

**Validation**:
- [ ] All 7 eval cases execute without errors
- [ ] LLM judges return valid scores
- [ ] Code validators return valid scores
- [ ] Results documented
- [ ] Test fixtures created

**User-Visible**: Basic vision evals work end-to-end

---

#### Task 9: Test Advanced Vision Tasks Evals
**Priority**: High  
**Effort**: 2 days  
**Dependencies**: T6, T7  
**Blocks**: T10

**Description**: Run all 7 advanced eval cases from `advanced-vision-tasks.yaml` and validate results.

**Actions**:
1. Create additional test images for complex scenarios
2. Run each eval case:
   - structured-object-detection
   - visual-reasoning-problem
   - multi-turn-image-discussion (parts 1 & 2)
   - image-quality-assessment
   - chart-data-extraction
   - scene-context-inference
   - instruction-following-with-image

3. Verify structured outputs
4. Test multi-turn conversations maintain context
5. Validate complex evaluators
6. Document performance and cost metrics

**Validation**:
- [ ] All 7 eval cases execute without errors
- [ ] Structured outputs parse correctly
- [ ] Multi-turn context maintained
- [ ] Complex judges work accurately
- [ ] Performance metrics collected
- [ ] Cost estimates documented

**User-Visible**: Advanced vision evals work end-to-end

---

#### Task 10: Provider Compatibility Testing
**Priority**: High  
**Effort**: 2 days  
**Dependencies**: T8, T9  
**Blocks**: T11

**Description**: Test vision evals across all major providers to ensure compatibility.

**Actions**:
1. Run basic evals on:
   - OpenAI GPT-4o
   - Anthropic Claude 3.5 Sonnet
   - Google Gemini 2.5 Flash

2. Compare results across providers
3. Document provider-specific behaviors
4. Identify and document limitations
5. Create provider compatibility matrix

**Validation**:
- [ ] All providers execute vision evals
- [ ] Results comparable across providers
- [ ] Limitations documented
- [ ] Compatibility matrix created
- [ ] Errors handled gracefully

**User-Visible**: Works reliably across all major providers

---

#### Task 11: Cost Analysis & Optimization
**Priority**: Medium  
**Effort**: 1 day  
**Dependencies**: T10  
**Blocks**: T12

**Description**: Analyze token costs for vision evals and document optimization strategies.

**Actions**:
1. Measure token usage for:
   - Different image sizes
   - Detail levels (low, high, auto)
   - Different providers

2. Calculate cost per eval case
3. Document cost optimization strategies:
   - Use `detail: low` for simple tasks
   - Use Gemini Flash for development
   - Cache image descriptions
   - Use code validators when possible

4. Create cost estimation guide
5. Add cost warnings to documentation

**Validation**:
- [ ] Token usage measured for various scenarios
- [ ] Cost per eval documented
- [ ] Optimization strategies validated
- [ ] Cost guide created
- [ ] Warnings added to docs

**User-Visible**: Clear understanding of costs and how to optimize

---

### Phase 4: Polish & Documentation (Days 11-14)

#### Task 12: Performance Optimization
**Priority**: Medium  
**Effort**: 2 days  
**Dependencies**: T11  
**Blocks**: T13

**Description**: Optimize image loading, processing, and evaluation performance.

**Actions**:
1. Profile image loading times
2. Implement caching for loaded images
3. Add image dimension limits to prevent oversized loads
4. Optimize base64 conversions
5. Parallelize independent evaluators
6. Add progress tracking for batch evals

**Validation**:
- [ ] Average eval latency <2s (excluding LLM calls)
- [ ] Image loading cached appropriately
- [ ] Large images handled efficiently
- [ ] Parallel execution works correctly
- [ ] Progress reporting functional

**User-Visible**: Fast, responsive evaluation experience

---

#### Task 13: Documentation Review & Enhancement
**Priority**: High  
**Effort**: 2 days  
**Dependencies**: T12  
**Blocks**: T14

**Description**: Review and enhance all vision evaluation documentation.

**Actions**:
1. Review and update `examples/vision/README.md`:
   - Add getting started section
   - Update usage examples
   - Add troubleshooting section
   - Include provider setup instructions

2. Review and update `examples/vision/INDEX.md`:
   - Ensure all examples listed
   - Update cost estimates
   - Add quick reference tables

3. Update `docs/updates/VISION_EVAL_RESEARCH_SUMMARY.md`:
   - Add implementation notes
   - Update status of completed work

4. Create migration guide if needed
5. Add inline code comments
6. Create video tutorial (optional)

**Validation**:
- [ ] README comprehensive and accurate
- [ ] INDEX up-to-date
- [ ] Research summary reflects implementation
- [ ] Code well-commented
- [ ] No broken links or references

**User-Visible**: Excellent documentation for vision evaluation

---

#### Task 14: Final Validation & Release Prep
**Priority**: High  
**Effort**: 1 day  
**Dependencies**: T13  

**Description**: Final validation before marking the change as complete.

**Actions**:
1. Run OpenSpec validation:
   ```bash
   npx @fission-ai/openspec validate add-vision-evaluation --strict
   ```

2. Run full test suite:
   ```bash
   bun test
   ```

3. Run end-to-end eval tests:
   ```bash
   agentv run examples/showcase/vision/datasets/basic-image-analysis.yaml
   agentv run examples/showcase/vision/datasets/advanced-vision-tasks.yaml
   ```

4. Create changelog entry
5. Update version in package.json
6. Tag release (if applicable)

**Validation**:
- [ ] OpenSpec validation passes
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] End-to-end evals work
- [ ] Changelog updated
- [ ] Version bumped

**User-Visible**: Production-ready vision evaluation feature

---

## Summary

**Total Estimated Effort**: 21 days (3-4 weeks with parallelization)

**Critical Path**: T1 → T2 → T4 → T5 → T6 → T8 → T10 → T11 → T12 → T13 → T14

**Parallelizable Work**:
- T3 can run parallel to T2
- T6 and T7 can run in parallel after T5
- T8 and T9 can run in parallel
- Documentation tasks can be done incrementally

**Key Milestones**:
1. Day 2: Schema extended, files reorganized
2. Day 6: Core implementation complete
3. Day 10: All tests passing
4. Day 14: Production ready

**Success Metrics**:
- All 14 eval cases working
- 3+ providers supported
- Documentation complete
- >90% test coverage
- <2s avg eval latency
