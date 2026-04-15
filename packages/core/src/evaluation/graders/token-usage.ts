import type { AssertionEntry, TokenUsageGraderConfig } from '../types.js';
import type { EvaluationContext, EvaluationScore, Grader } from './types.js';

export interface TokenUsageGraderOptions {
  readonly config: TokenUsageGraderConfig;
}

/**
 * Grader that checks provider-reported token usage against configured limits.
 * Uses tokenUsage from the evaluation context.
 */
export class TokenUsageGrader implements Grader {
  readonly kind = 'token-usage';

  private readonly config: TokenUsageGraderConfig;

  constructor(options: TokenUsageGraderOptions) {
    this.config = options.config;
  }

  evaluate(context: EvaluationContext): EvaluationScore {
    const usage = context.tokenUsage;

    const maxTotal = this.config.max_total;
    const maxInput = this.config.max_input;
    const maxOutput = this.config.max_output;

    const expectedAspectCount = Math.max(
      [maxTotal, maxInput, maxOutput].filter((v) => typeof v === 'number').length,
      1,
    );

    if (!usage) {
      return {
        score: 0,
        verdict: 'fail',
        assertions: [{ text: 'No token usage data available in trace', passed: false }],
        expectedAspectCount,
        graderRawRequest: {
          type: 'token-usage',
          max_total: maxTotal ?? null,
          max_input: maxInput ?? null,
          max_output: maxOutput ?? null,
          tokenUsage: null,
        },
      };
    }

    const input = usage.input;
    const output = usage.output;
    const cached = usage.cached ?? 0;
    const total = input + output + cached;

    const assertions: AssertionEntry[] = [];

    if (typeof maxInput === 'number') {
      if (input <= maxInput) {
        assertions.push({ text: `Input tokens ${input} <= ${maxInput}`, passed: true });
      } else {
        assertions.push({ text: `Input tokens ${input} > ${maxInput}`, passed: false });
      }
    }

    if (typeof maxOutput === 'number') {
      if (output <= maxOutput) {
        assertions.push({ text: `Output tokens ${output} <= ${maxOutput}`, passed: true });
      } else {
        assertions.push({ text: `Output tokens ${output} > ${maxOutput}`, passed: false });
      }
    }

    if (typeof maxTotal === 'number') {
      if (total <= maxTotal) {
        assertions.push({ text: `Total tokens ${total} <= ${maxTotal}`, passed: true });
      } else {
        assertions.push({ text: `Total tokens ${total} > ${maxTotal}`, passed: false });
      }
    }

    const passed = assertions.every((a) => a.passed);

    return {
      score: passed ? 1 : 0,
      verdict: passed ? 'pass' : 'fail',
      assertions,
      expectedAspectCount,
      graderRawRequest: {
        type: 'token-usage',
        max_total: maxTotal ?? null,
        max_input: maxInput ?? null,
        max_output: maxOutput ?? null,
        tokenUsage: {
          input,
          output,
          cached,
          total,
        },
      },
    };
  }
}
