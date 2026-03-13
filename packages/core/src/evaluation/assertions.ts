/**
 * Types for inline assertion functions used in the evaluate() API.
 *
 * Inline functions are the escape hatch for custom evaluation logic
 * that doesn't fit a built-in evaluator type. For built-in assertions
 * (contains, regex, is-json, etc.), use config objects instead:
 *
 *   assert: [{ type: 'contains', value: 'hello' }]
 *
 * Inline functions are for custom logic:
 *
 *   assert: [({ output }) => ({ name: 'len', score: output.length > 5 ? 1 : 0 })]
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
