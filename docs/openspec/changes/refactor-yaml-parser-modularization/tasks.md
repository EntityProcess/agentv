## 1. Preparation

- [ ] 1.1 Capture baseline behavior of `loadEvalCases()` with integration tests and/or snapshots.
- [ ] 1.2 Identify and document the current responsibilities and helper functions inside `yaml-parser.ts` (file resolution, config, formatting, messages, prompts, evaluators).

## 2. File Resolution & Config Loading

- [ ] 2.1 Create `file-resolver.ts` and move file resolution helpers (e.g., `resolveFileReference`, search roots, absolute path helpers).
- [ ] 2.2 Create `config-loader.ts` and move config loading, guideline detection, and related types/constants.
- [ ] 2.3 Update `yaml-parser.ts` to use `file-resolver.ts` and `config-loader.ts` without changing external behavior.
- [ ] 2.4 Add unit tests for file resolution and config loading modules.

## 3. Segment Formatting & Message Processing

- [ ] 3.1 Create `segment-formatter.ts` and extract segment/file content formatting functions.
- [ ] 3.2 Create `message-processor.ts` and extract message processing and assistant content helpers.
- [ ] 3.3 Replace inline formatting and message logic in `yaml-parser.ts` with calls to the new modules.
- [ ] 3.4 Add unit tests for segment formatting and message processing.

## 4. Prompt Building & Evaluator Parsing

- [ ] 4.1 Create `prompt-builder.ts` and move prompt construction logic (e.g., building chat prompts, role markers, prompt inputs).
- [ ] 4.2 Create `evaluator-parser.ts` and move evaluator parsing/coercion and related types.
- [ ] 4.3 Update `yaml-parser.ts` to delegate prompt and evaluator logic to these modules.
- [ ] 4.4 Add unit tests for prompt building and evaluator parsing.

## 5. Orchestrator Cleanup & Regression Checks

- [ ] 5.1 Simplify `yaml-parser.ts` to a small orchestrator that wires the new modules and exposes `loadEvalCases()`.
- [ ] 5.2 Ensure no duplicate file reading or guideline resolution logic remains.
- [ ] 5.3 Run the full test suite and compare evaluation outputs against the baseline.
- [ ] 5.4 Update any relevant docs or comments referencing the old monolithic parser.
- [ ] 5.5 Confirm no observable behavior change in evaluation results and mark all tasks complete.
