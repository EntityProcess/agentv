import type { AssertFn } from '../assertions.js';
import type { JsonObject } from '../types.js';
import { clampScore, scoreToVerdict } from './scoring.js';
import type { EvaluationContext, EvaluationScore, Evaluator } from './types.js';

/**
 * Evaluator that wraps an inline AssertFn and runs it in-process.
 * No subprocess, no stdin/stdout -- just calls the function directly.
 */
export class InlineAssertEvaluator implements Evaluator {
  readonly kind = 'inline-assert';

  constructor(
    private readonly fn: AssertFn,
    private readonly name: string,
  ) {}

  async evaluate(context: EvaluationContext): Promise<EvaluationScore> {
    const result = await this.fn({
      input: context.evalCase.question,
      output: context.candidate,
      expectedOutput: context.evalCase.reference_answer,
      criteria: context.evalCase.criteria,
      metadata: context.evalCase.metadata as Record<string, unknown> | undefined,
    });

    const score = clampScore(result.score);

    return {
      score,
      verdict: scoreToVerdict(score),
      hits: score >= 0.8 ? [result.name] : [],
      misses: score < 0.5 ? [result.name] : [],
      expectedAspectCount: 1,
      reasoning: undefined,
      details: result.metadata ? (result.metadata as JsonObject) : undefined,
    };
  }
}
