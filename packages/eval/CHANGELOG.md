# @agentv/eval

## 0.3.0

### Minor Changes

- e414534: - Added a "Target Proxy" for `code_judge` evaluators, enabling custom code judges to make LLM calls through the configured evaluation provider without direct credential access.
  - Unified framework message types into a single `Message` schema.
  - Added `TargetClient` to `@agentv/eval` SDK for easy target invocation in custom evaluators.
  - Removed the deprecated `code_snippets` field from `EvalCase`.
- caf7a15: Add target proxy visibility and control for code judges:

  - Added `GET /info` endpoint to target proxy returning target name, max calls, call count, and available targets
  - Added optional `target` parameter to invoke requests for per-call target override
  - Added `getInfo()` method to `TargetClient` in `@agentv/eval` SDK
  - Added `TargetInfo` type export from `@agentv/eval`

  This enables code judges to query proxy configuration and use different targets for different purposes (e.g., cheap model for simple checks, expensive model for nuanced evaluation).

### Patch Changes

- d497c6e: Add document extraction metrics support with details passthrough

  - Added optional `details` field to code judge output for structured metrics (TP/TN/FP/FN counts, alignments)
  - Core evaluation now captures and persists `details` from code judges to JSONL output
  - Added example judges for header field confusion metrics and line item matching with greedy alignment
  - Macro-F1 calculation treats undefined F1 as 0 when errors occurred (sklearn best practice)

## 0.2.1

### Patch Changes

- 5f074d0: add optional message name (e.g., agent name) used by some providers for multi-agent transcripts

## 0.2.0

### Minor Changes

- 2ce1844: Create @agentv/eval package and add pi-agent-sdk provider support

  - Create standalone @agentv/eval package for code judge SDK with defineCodeJudge()
  - Move defineCodeJudge from @agentv/core to @agentv/eval
  - New import: `import { defineCodeJudge } from '@agentv/eval'`
  - Includes schemas, runtime, and Zod re-export for typed configs
  - Add pi-agent-sdk provider for multi-LLM provider support (Anthropic, OpenAI, Google, Mistral, Groq, Cerebras, xAI, OpenRouter)
