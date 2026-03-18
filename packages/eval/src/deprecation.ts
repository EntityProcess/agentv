/**
 * Input enrichment utilities for code grader and assertion runtimes.
 * Populates text convenience accessors on validated input objects.
 */
import type { CodeGraderInput } from './schemas.js';

/**
 * Populate `inputText`, `outputText`, and `expectedOutputText` accessors
 * on the validated input object.
 *
 * Text accessors are always strings. Structured fields (`input`, `output`, `expectedOutput`)
 * remain `Message[]` always.
 */
export function enrichInput(input: CodeGraderInput): CodeGraderInput {
  // Ensure expectedOutputText is always a string (may be undefined from schema)
  if (input.expectedOutputText === undefined) {
    Object.defineProperty(input, 'expectedOutputText', {
      value: '',
      writable: false,
      configurable: true,
      enumerable: true,
    });
  }

  return input;
}
