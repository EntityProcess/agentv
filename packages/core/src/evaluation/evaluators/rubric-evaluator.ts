import { generateObject } from 'ai';
import { z } from 'zod';

import type { EvaluationContext, EvaluationScore, Evaluator } from '../evaluators.js';
import type { RubricEvaluatorConfig, RubricItem } from '../types.js';

const rubricCheckResultSchema = z.object({
  id: z.string().describe('The ID of the rubric item being checked'),
  satisfied: z.boolean().describe('Whether this rubric requirement is met'),
  reasoning: z.string().describe('Brief explanation (1-2 sentences) for this check'),
});

const rubricEvaluationSchema = z.object({
  checks: z.array(rubricCheckResultSchema).describe('Results for each rubric item'),
  overall_reasoning: z.string().describe('Overall assessment summary (1-2 sentences)'),
});

export interface RubricEvaluatorOptions {
  readonly config: RubricEvaluatorConfig;
  readonly resolveJudgeProvider: (context: EvaluationContext) => Promise<import('../providers/types.js').Provider | undefined>;
}

export class RubricEvaluator implements Evaluator {
  readonly kind = 'rubric';

  private readonly config: RubricEvaluatorConfig;
  private readonly resolveJudgeProvider: (context: EvaluationContext) => Promise<import('../providers/types.js').Provider | undefined>;

  constructor(options: RubricEvaluatorOptions) {
    this.config = options.config;
    this.resolveJudgeProvider = options.resolveJudgeProvider;
  }

  async evaluate(context: EvaluationContext): Promise<EvaluationScore> {
    const judgeProvider = await this.resolveJudgeProvider(context);
    if (!judgeProvider) {
      throw new Error('No judge provider available for rubric evaluation');
    }

    // Validate rubrics exist
    if (!this.config.rubrics || this.config.rubrics.length === 0) {
      throw new Error(
        `No rubrics found for evaluator "${this.config.name}". Run "agentv generate rubrics" first.`,
      );
    }

    const prompt = this.buildPrompt(context, this.config.rubrics);

    // Use generateObject to get structured output
    const model = judgeProvider.asLanguageModel?.();
    if (!model) {
      throw new Error('Judge provider does not support language model interface');
    }

    const { object: result } = await generateObject({
      model,
      schema: rubricEvaluationSchema,
      prompt,
    });

    // Calculate score and verdict
    const { score, verdict, hits, misses } = this.calculateScore(result, this.config.rubrics);

    return {
      score,
      verdict,
      hits,
      misses,
      expectedAspectCount: this.config.rubrics.length,
      reasoning: result.overall_reasoning,
      evaluatorRawRequest: {
        prompt,
        rubrics: this.config.rubrics,
      },
    };
  }

  private buildPrompt(context: EvaluationContext, rubrics: readonly RubricItem[]): string {
    const parts: string[] = [
      'You are an expert evaluator. Evaluate the candidate answer against each rubric item below.',
      '',
      '[[ Question ]]',
      context.evalCase.question,
      '',
      '[[ Expected Outcome ]]',
      context.evalCase.expected_outcome,
      '',
    ];

    if (context.evalCase.reference_answer && context.evalCase.reference_answer.trim().length > 0) {
      parts.push(
        '[[ Reference Answer ]]',
        context.evalCase.reference_answer,
        '',
      );
    }

    parts.push(
      '[[ Candidate Answer ]]',
      context.candidate,
      '',
      '[[ Rubrics ]]',
    );

    for (const rubric of rubrics) {
      const requiredLabel = rubric.required ? ' (REQUIRED)' : '';
      const weightLabel = rubric.weight !== 1.0 ? ` (weight: ${rubric.weight})` : '';
      parts.push(`- [${rubric.id}]${requiredLabel}${weightLabel}: ${rubric.description}`);
    }

    parts.push(
      '',
      'For each rubric, determine if it is satisfied and provide brief reasoning.',
    );

    return parts.join('\n');
  }

  private calculateScore(
    result: z.infer<typeof rubricEvaluationSchema>,
    rubrics: readonly RubricItem[],
  ): {
    score: number;
    verdict: 'pass' | 'fail' | 'borderline';
    hits: string[];
    misses: string[];
  } {
    const rubricMap = new Map(rubrics.map((r) => [r.id, r]));
    const hits: string[] = [];
    const misses: string[] = [];
    let totalWeight = 0;
    let earnedWeight = 0;
    let failedRequired = false;

    for (const check of result.checks) {
      const rubric = rubricMap.get(check.id);
      if (!rubric) {
        continue;
      }

      totalWeight += rubric.weight;

      if (check.satisfied) {
        earnedWeight += rubric.weight;
        hits.push(`[${rubric.id}] ${rubric.description}: ${check.reasoning}`);
      } else {
        misses.push(`[${rubric.id}] ${rubric.description}: ${check.reasoning}`);
        if (rubric.required) {
          failedRequired = true;
        }
      }
    }

    // Calculate normalized score
    const score = totalWeight > 0 ? Math.min(1, Math.max(0, earnedWeight / totalWeight)) : 0;

    // Determine verdict
    let verdict: 'pass' | 'fail' | 'borderline';
    if (failedRequired) {
      verdict = 'fail';
    } else if (score >= 0.8) {
      verdict = 'pass';
    } else if (score >= 0.6) {
      verdict = 'borderline';
    } else {
      verdict = 'fail';
    }

    return { score, verdict, hits, misses };
  }
}
