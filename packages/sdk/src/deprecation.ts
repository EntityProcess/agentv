/**
 * Input enrichment utilities for code grader and assertion runtimes.
 *
 * With the removal of text convenience accessors (`inputText`, `outputText`,
 * `expectedOutputText`) from CodeGraderInput, this module is a no-op pass-through.
 * Kept for backward compatibility — existing runtimes call `enrichInput()` and
 * the call is harmless.
 */
import type { CodeGraderInput } from './schemas.js';

/**
 * Enrich a validated CodeGraderInput.
 *
 * Previously populated text convenience accessors; now a no-op pass-through since
 * those fields were removed. Code graders should extract text from `Message.content`
 * using `getTextContent()` from `@agentv/core` instead.
 */
export function enrichInput(input: CodeGraderInput): CodeGraderInput {
  return input;
}
