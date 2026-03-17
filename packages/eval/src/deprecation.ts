/**
 * Deprecation warning utilities for code grader and assertion runtimes.
 * Provides text convenience accessors and deprecation warnings on legacy field names.
 */
import type { CodeGraderInput } from './schemas.js';

const ANSI_YELLOW = '\u001b[33m';
const ANSI_RESET = '\u001b[0m';

/**
 * Emit a deprecation warning to stderr (once per field name per process).
 */
const deprecationWarned = new Set<string>();
function warnDeprecation(oldName: string, newName: string): void {
  if (deprecationWarned.has(oldName)) return;
  deprecationWarned.add(oldName);
  console.warn(
    `${ANSI_YELLOW}Warning: '${oldName}' is deprecated in code graders. Use '${newName}' instead.${ANSI_RESET}`,
  );
}

/**
 * Reset deprecation warning state. Used only in tests.
 */
export function resetDeprecationWarnings(): void {
  deprecationWarned.clear();
}

/**
 * Populate `inputText`, `outputText`, and `expectedOutputText` convenience accessors
 * on the validated input object, and install deprecation warnings on legacy fields.
 *
 * Text accessors are always strings. Structured fields (`input`, `output`, `expectedOutput`)
 * remain `Message[]` always.
 */
export function enrichInput(input: CodeGraderInput): CodeGraderInput {
  // Populate text convenience accessors (always strings)
  // inputText = question (first user message content as string)
  const inputText = input.question;
  // outputText = answer (last assistant message content as string)
  const outputText = input.answer;
  // expectedOutputText = referenceAnswer (expected output content as string)
  const expectedOutputText = input.referenceAnswer ?? '';

  // Store the original values before redefining properties
  const originalQuestion = input.question;
  const originalAnswer = input.answer;
  const originalReferenceAnswer = input.referenceAnswer;

  // Set new text accessor values
  Object.defineProperty(input, 'inputText', {
    value: inputText,
    writable: false,
    configurable: true,
    enumerable: true,
  });
  Object.defineProperty(input, 'outputText', {
    value: outputText,
    writable: false,
    configurable: true,
    enumerable: true,
  });
  Object.defineProperty(input, 'expectedOutputText', {
    value: expectedOutputText,
    writable: false,
    configurable: true,
    enumerable: true,
  });

  // Install deprecation warnings on legacy fields via property accessors
  Object.defineProperty(input, 'question', {
    get() {
      warnDeprecation('question', 'inputText');
      return originalQuestion;
    },
    configurable: true,
    enumerable: true,
  });

  Object.defineProperty(input, 'answer', {
    get() {
      warnDeprecation('answer', 'outputText');
      return originalAnswer;
    },
    configurable: true,
    enumerable: true,
  });

  Object.defineProperty(input, 'referenceAnswer', {
    get() {
      warnDeprecation('referenceAnswer', 'expectedOutputText');
      return originalReferenceAnswer;
    },
    configurable: true,
    enumerable: true,
  });

  return input;
}
