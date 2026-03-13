/**
 * Built-in assertion factories for the evaluate() API.
 *
 * Each factory returns an AssertFn — a plain function that takes
 * { input, output, expectedOutput, criteria, metadata } and returns
 * { name, score }. These wrap the same logic as the built-in evaluator
 * types but are usable as inline functions in the assert array.
 */

/** Context passed to inline assertion functions */
export interface AssertContext {
  readonly input: string;
  readonly output: string;
  readonly expectedOutput?: string;
  readonly criteria?: string;
  readonly metadata?: Record<string, unknown>;
}

/** Result from an inline assertion function */
export interface AssertResult {
  readonly name: string;
  readonly score: number;
  readonly metadata?: Record<string, unknown>;
}

/** Inline assertion function signature */
export type AssertFn = (ctx: AssertContext) => AssertResult | Promise<AssertResult>;

/** Checks if output contains the given substring. */
export function contains(value: string): AssertFn {
  return ({ output }) => ({
    name: 'contains',
    score: output.includes(value) ? 1.0 : 0.0,
  });
}

/** Case-insensitive contains check. */
export function icontains(value: string): AssertFn {
  const lower = value.toLowerCase();
  return ({ output }) => ({
    name: 'icontains',
    score: output.toLowerCase().includes(lower) ? 1.0 : 0.0,
  });
}

/** Checks if output contains ALL of the given substrings. */
export function containsAll(values: readonly string[]): AssertFn {
  return ({ output }) => ({
    name: 'contains-all',
    score: values.every((v) => output.includes(v)) ? 1.0 : 0.0,
  });
}

/** Checks if output contains ANY of the given substrings. */
export function containsAny(values: readonly string[]): AssertFn {
  return ({ output }) => ({
    name: 'contains-any',
    score: values.some((v) => output.includes(v)) ? 1.0 : 0.0,
  });
}

/** Checks if trimmed output exactly equals trimmed expectedOutput. */
export const exactMatch: AssertFn = ({ output, expectedOutput }) => ({
  name: 'exact-match',
  score: expectedOutput !== undefined && output.trim() === expectedOutput.trim() ? 1.0 : 0.0,
});

/** Checks if trimmed output starts with the given value. */
export function startsWith(value: string): AssertFn {
  return ({ output }) => ({
    name: 'starts-with',
    score: output.trim().startsWith(value.trim()) ? 1.0 : 0.0,
  });
}

/** Checks if trimmed output ends with the given value. */
export function endsWith(value: string): AssertFn {
  return ({ output }) => ({
    name: 'ends-with',
    score: output.trim().endsWith(value.trim()) ? 1.0 : 0.0,
  });
}

/** Checks if output matches the given regex pattern. */
export function regex(pattern: string, flags?: string): AssertFn {
  const re = new RegExp(pattern, flags);
  return ({ output }) => ({
    name: 'regex',
    score: re.test(output) ? 1.0 : 0.0,
  });
}

/** Checks if output is valid JSON. */
export const isJson: AssertFn = ({ output }) => {
  try {
    JSON.parse(output);
    return { name: 'is-json', score: 1.0 };
  } catch {
    return { name: 'is-json', score: 0.0 };
  }
};
