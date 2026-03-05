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

/** Checks if `output` contains ANY of the given `values`. */
export function runContainsAnyAssertion(
  output: string,
  values: readonly string[],
): AssertionResult {
  const matched = values.filter((v) => output.includes(v));
  const passed = matched.length > 0;
  return {
    score: passed ? 1 : 0,
    hits: passed ? [`Output contains "${matched[0]}"`] : [],
    misses: passed
      ? []
      : [`Output does not contain any of: ${values.map((v) => `"${v}"`).join(', ')}`],
  };
}

/** Checks if `output` contains ALL of the given `values`. */
export function runContainsAllAssertion(
  output: string,
  values: readonly string[],
): AssertionResult {
  const missing = values.filter((v) => !output.includes(v));
  const passed = missing.length === 0;
  return {
    score: passed ? 1 : 0,
    hits: passed ? [`Output contains all ${values.length} expected strings`] : [],
    misses: passed ? [] : [`Output missing: ${missing.map((v) => `"${v}"`).join(', ')}`],
  };
}

/** Case-insensitive check if `output` contains `value`. */
export function runIcontainsAssertion(output: string, value: string): AssertionResult {
  const passed = output.toLowerCase().includes(value.toLowerCase());
  return {
    score: passed ? 1 : 0,
    hits: passed ? [`Output contains "${value}" (case-insensitive)`] : [],
    misses: passed ? [] : [`Output does not contain "${value}" (case-insensitive)`],
  };
}

/** Case-insensitive check if `output` contains ANY of the given `values`. */
export function runIcontainsAnyAssertion(
  output: string,
  values: readonly string[],
): AssertionResult {
  const lower = output.toLowerCase();
  const matched = values.filter((v) => lower.includes(v.toLowerCase()));
  const passed = matched.length > 0;
  return {
    score: passed ? 1 : 0,
    hits: passed ? [`Output contains "${matched[0]}" (case-insensitive)`] : [],
    misses: passed
      ? []
      : [
          `Output does not contain any of: ${values.map((v) => `"${v}"`).join(', ')} (case-insensitive)`,
        ],
  };
}

/** Case-insensitive check if `output` contains ALL of the given `values`. */
export function runIcontainsAllAssertion(
  output: string,
  values: readonly string[],
): AssertionResult {
  const lower = output.toLowerCase();
  const missing = values.filter((v) => !lower.includes(v.toLowerCase()));
  const passed = missing.length === 0;
  return {
    score: passed ? 1 : 0,
    hits: passed
      ? [`Output contains all ${values.length} expected strings (case-insensitive)`]
      : [],
    misses: passed
      ? []
      : [`Output missing (case-insensitive): ${missing.map((v) => `"${v}"`).join(', ')}`],
  };
}

/** Checks if `output` starts with `value` (both trimmed). */
export function runStartsWithAssertion(output: string, value: string): AssertionResult {
  const passed = output.trim().startsWith(value.trim());
  return {
    score: passed ? 1 : 0,
    hits: passed ? [`Output starts with "${value}"`] : [],
    misses: passed ? [] : [`Output does not start with "${value}"`],
  };
}

/** Checks if `output` ends with `value` (both trimmed). */
export function runEndsWithAssertion(output: string, value: string): AssertionResult {
  const passed = output.trim().endsWith(value.trim());
  return {
    score: passed ? 1 : 0,
    hits: passed ? [`Output ends with "${value}"`] : [],
    misses: passed ? [] : [`Output does not end with "${value}"`],
  };
}

/** Checks if `output` matches the given regex `pattern` with optional `flags`. */
export function runRegexAssertion(
  output: string,
  pattern: string,
  flags?: string,
): AssertionResult {
  const regex = new RegExp(pattern, flags);
  const passed = regex.test(output);
  const flagsLabel = flags ? ` (flags: ${flags})` : '';
  return {
    score: passed ? 1 : 0,
    hits: passed ? [`Output matches pattern /${pattern}/${flags ?? ''}${flagsLabel}`] : [],
    misses: passed ? [] : [`Output does not match pattern /${pattern}/${flags ?? ''}${flagsLabel}`],
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
