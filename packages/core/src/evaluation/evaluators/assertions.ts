/**
 * Deterministic assertion evaluators.
 *
 * Pure functions that check agent output against simple conditions
 * and return a binary score (0 or 1) with descriptive hits/misses.
 */

export type AssertionResult = {
  score: number;
  hits: string[];
  misses: string[];
};

/** Checks if `output` contains the given `value` substring. */
export function runContainsAssertion(output: string, value: string): AssertionResult {
  const passed = output.includes(value);
  return {
    score: passed ? 1 : 0,
    hits: passed ? [`Output contains "${value}"`] : [],
    misses: passed ? [] : [`Output does not contain "${value}"`],
  };
}

/** Checks if `output` matches the given regex `pattern`. */
export function runRegexAssertion(output: string, pattern: string): AssertionResult {
  const regex = new RegExp(pattern);
  const passed = regex.test(output);
  return {
    score: passed ? 1 : 0,
    hits: passed ? [`Output matches pattern /${pattern}/`] : [],
    misses: passed ? [] : [`Output does not match pattern /${pattern}/`],
  };
}

/** Checks if `output` is valid JSON. */
export function runIsJsonAssertion(output: string): AssertionResult {
  let passed = false;
  try {
    JSON.parse(output);
    passed = true;
  } catch {
    // not valid JSON
  }
  return {
    score: passed ? 1 : 0,
    hits: passed ? ['Output is valid JSON'] : [],
    misses: passed ? [] : ['Output is not valid JSON'],
  };
}

/** Checks if `output` exactly equals `value` (both trimmed). */
export function runEqualsAssertion(output: string, value: string): AssertionResult {
  const passed = output.trim() === value.trim();
  return {
    score: passed ? 1 : 0,
    hits: passed ? [`Output equals "${value}"`] : [],
    misses: passed ? [] : [`Output does not equal "${value}"`],
  };
}
