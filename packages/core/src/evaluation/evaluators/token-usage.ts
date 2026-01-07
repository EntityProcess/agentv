import type { TokenUsageEvaluatorConfig } from '../types.js';
import type { EvaluationContext, EvaluationScore, Evaluator } from './types.js';

export interface TokenUsageEvaluatorOptions {
  readonly config: TokenUsageEvaluatorConfig;
}

/**
 * Evaluator that checks provider-reported token usage against configured limits.
 * Uses traceSummary.tokenUsage from the evaluation context.
 */
export class TokenUsageEvaluator implements Evaluator {
  readonly kind = 'token_usage';

  private readonly config: TokenUsageEvaluatorConfig;

  constructor(options: TokenUsageEvaluatorOptions) {
    this.config = options.config;
  }

  evaluate(context: EvaluationContext): EvaluationScore {
    const usage = context.traceSummary?.tokenUsage;

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
        hits: [],
        misses: ['No token usage data available in trace'],
        expectedAspectCount,
        reasoning: 'Token usage not reported by provider',
        evaluatorRawRequest: {
          type: 'token_usage',
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

    const hits: string[] = [];
    const misses: string[] = [];

    if (typeof maxInput === 'number') {
      if (input <= maxInput) {
        hits.push(`Input tokens ${input} <= ${maxInput}`);
      } else {
        misses.push(`Input tokens ${input} > ${maxInput}`);
      }
    }

    if (typeof maxOutput === 'number') {
      if (output <= maxOutput) {
        hits.push(`Output tokens ${output} <= ${maxOutput}`);
      } else {
        misses.push(`Output tokens ${output} > ${maxOutput}`);
      }
    }

    if (typeof maxTotal === 'number') {
      if (total <= maxTotal) {
        hits.push(`Total tokens ${total} <= ${maxTotal}`);
      } else {
        misses.push(`Total tokens ${total} > ${maxTotal}`);
      }
    }

    const passed = misses.length === 0;

    return {
      score: passed ? 1 : 0,
      verdict: passed ? 'pass' : 'fail',
      hits,
      misses,
      expectedAspectCount,
      reasoning: `token_usage input=${input}, output=${output}, cached=${cached}, total=${total}`,
      evaluatorRawRequest: {
        type: 'token_usage',
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
