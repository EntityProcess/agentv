/**
 * Input enrichment utilities for script grader and assertion runtimes.
 *
 * With the removal of text convenience accessors (`inputText`, `outputText`,
 * `expectedOutputText`) from ScriptGraderInput, this module is a no-op pass-through.
 * Kept for backward compatibility — existing runtimes call `enrichInput()` and
 * the call is harmless.
 */
import type { ScriptGraderInput } from './schemas.js';

/**
 * Enrich a validated ScriptGraderInput.
 *
 * Previously populated text convenience accessors; now a no-op pass-through since
 * those fields were removed. script graders should extract text from `Message.content`
 * using `getTextContent()` from `@agentv/core` instead.
 */
export function enrichInput(input: ScriptGraderInput): ScriptGraderInput {
  return input;
}
