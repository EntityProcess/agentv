import { generateText } from 'ai';
import { z } from 'zod';

import type { Provider, ProviderResponse } from '../providers/types.js';
import { extractLastAssistantContent } from '../providers/types.js';
import { TEMPLATE_VARIABLES } from '../template-variables.js';
import type { JsonObject, RubricItem } from '../types.js';
import { clampScore, isNonEmptyString, parseJsonFromText, scoreToVerdict } from './scoring.js';
import type { EvaluationContext, EvaluationScore, Evaluator } from './types.js';

/**
 * Default evaluator template for the user prompt (variables will be substituted).
 * Custom evaluators can override this via evaluatorTemplate option.
 */
const DEFAULT_EVALUATOR_TEMPLATE = `You are an expert evaluator. Your goal is to grade the candidate_answer based on how well it achieves the expected_outcome for the original task.

Use the reference_answer as a gold standard for a high-quality response (if provided). The reference_answer may be a simple text response, or it may contain a sequence of expected agent messages including tool calls. When it contains multiple messages, the last message represents the final expected answer. The candidate_answer does not need to match it verbatim, but should capture the key points and follow the same spirit.

Be concise and focused in your evaluation. Provide succinct, specific feedback rather than verbose explanations.

[[ ## expected_outcome ## ]]
{{${TEMPLATE_VARIABLES.EXPECTED_OUTCOME}}}

[[ ## question ## ]]
{{${TEMPLATE_VARIABLES.QUESTION}}}

[[ ## reference_answer ## ]]
{{${TEMPLATE_VARIABLES.REFERENCE_ANSWER}}}

[[ ## candidate_answer ## ]]
{{${TEMPLATE_VARIABLES.CANDIDATE_ANSWER}}}

[[ ## file_changes ## ]]
{{${TEMPLATE_VARIABLES.FILE_CHANGES}}}`;

type JudgeProviderResolver = (context: EvaluationContext) => Promise<Provider | undefined>;

export interface LlmJudgeEvaluatorOptions {
  readonly resolveJudgeProvider: JudgeProviderResolver;
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
  readonly evaluatorTemplate?: string;
}

const freeformEvaluationSchema = z.object({
  score: z.number().min(0).max(1).describe('Score between 0.0 and 1.0'),
  hits: z.array(z.string()).describe('Brief specific achievements').optional(),
  misses: z.array(z.string()).describe('Brief failures or omissions').optional(),
  reasoning: z.string().describe('Concise explanation (1-2 sentences)').optional(),
});

const rubricCheckResultSchema = z.object({
  id: z.string().describe('The ID of the rubric item being checked'),
  satisfied: z.boolean().describe('Whether this rubric requirement is met'),
  reasoning: z.string().describe('Brief explanation (1-2 sentences) for this check'),
});

const rubricEvaluationSchema = z.object({
  checks: z.array(rubricCheckResultSchema).describe('Results for each rubric item'),
  overall_reasoning: z.string().describe('Overall assessment summary (1-2 sentences)'),
});

/**
 * Schema for score-range rubric evaluation.
 * Each check returns an integer score 0-10 instead of boolean satisfied.
 */
const scoreRangeCheckResultSchema = z.object({
  id: z.string().describe('The ID of the rubric criterion being scored'),
  score: z.number().int().min(0).max(10).describe('Integer score 0-10 for this criterion'),
  reasoning: z.string().describe('Brief explanation (1-2 sentences) for this score').optional(),
});

const scoreRangeEvaluationSchema = z.object({
  checks: z.array(scoreRangeCheckResultSchema).describe('Scores for each rubric criterion'),
  overall_reasoning: z.string().describe('Overall assessment summary (1-2 sentences)').optional(),
});

export { freeformEvaluationSchema };

export class LlmJudgeEvaluator implements Evaluator {
  readonly kind = 'llm_judge';

  private readonly resolveJudgeProvider: JudgeProviderResolver;
  private readonly maxOutputTokens?: number;
  private readonly temperature?: number;
  private readonly evaluatorTemplate?: string;

  constructor(options: LlmJudgeEvaluatorOptions) {
    this.resolveJudgeProvider = options.resolveJudgeProvider;
    this.maxOutputTokens = options.maxOutputTokens;
    this.temperature = options.temperature;
    this.evaluatorTemplate = options.evaluatorTemplate;
  }

  async evaluate(context: EvaluationContext): Promise<EvaluationScore> {
    const judgeProvider = await this.resolveJudgeProvider(context);
    if (!judgeProvider) {
      throw new Error('No judge provider available for LLM grading');
    }

    const config = context.evaluator;
    if (config?.type === 'llm_judge' && config.rubrics && config.rubrics.length > 0) {
      return this.evaluateWithRubrics(context, judgeProvider, config.rubrics);
    }

    return this.evaluateFreeform(context, judgeProvider);
  }

  private async evaluateFreeform(
    context: EvaluationContext,
    judgeProvider: Provider,
  ): Promise<EvaluationScore> {
    const formattedQuestion =
      context.promptInputs.question && context.promptInputs.question.trim().length > 0
        ? context.promptInputs.question
        : context.evalCase.question;

    // Prepare template variables for substitution
    const variables = {
      [TEMPLATE_VARIABLES.INPUT_MESSAGES]: JSON.stringify(context.evalCase.input_segments, null, 2),
      [TEMPLATE_VARIABLES.EXPECTED_MESSAGES]: JSON.stringify(
        context.evalCase.expected_messages,
        null,
        2,
      ),
      [TEMPLATE_VARIABLES.OUTPUT_MESSAGES]: JSON.stringify(context.outputMessages ?? [], null, 2),
      [TEMPLATE_VARIABLES.CANDIDATE_ANSWER]: context.candidate.trim(),
      [TEMPLATE_VARIABLES.REFERENCE_ANSWER]: (context.evalCase.reference_answer ?? '').trim(),
      [TEMPLATE_VARIABLES.EXPECTED_OUTCOME]: context.evalCase.expected_outcome.trim(),
      [TEMPLATE_VARIABLES.QUESTION]: formattedQuestion.trim(),
      [TEMPLATE_VARIABLES.FILE_CHANGES]: context.fileChanges ?? '',
    };

    // Build system prompt (only the mandatory output schema)
    const systemPrompt = buildOutputSchema();

    // Build user prompt based on custom template or default template
    const evaluatorTemplate =
      context.evaluatorTemplateOverride ?? this.evaluatorTemplate ?? DEFAULT_EVALUATOR_TEMPLATE;
    const userPrompt = substituteVariables(evaluatorTemplate, variables);

    const evaluatorRawRequest: JsonObject = {
      userPrompt,
      systemPrompt,
      target: judgeProvider.targetName,
    };

    try {
      const { data } = await this.runWithRetry({
        context,
        judgeProvider,
        systemPrompt,
        userPrompt,
        schema: freeformEvaluationSchema,
      });

      const score = clampScore(data.score);
      // Cap hits/misses at 4 items to keep LLM judge output concise and focused
      const hits = Array.isArray(data.hits) ? data.hits.filter(isNonEmptyString).slice(0, 4) : [];
      const misses = Array.isArray(data.misses)
        ? data.misses.filter(isNonEmptyString).slice(0, 4)
        : [];
      const reasoning = data.reasoning;
      const expectedAspectCount = Math.max(hits.length + misses.length, 1);

      return {
        score,
        verdict: scoreToVerdict(score),
        hits,
        misses,
        expectedAspectCount,
        reasoning,
        evaluatorRawRequest,
      };
    } catch {
      // Deliberate: parse failures yield score 0 silently — no warning emitted,
      // the zeroed score itself signals the failure to downstream consumers.
      return {
        score: 0,
        verdict: 'fail',
        hits: [],
        misses: [],
        expectedAspectCount: 1,
        evaluatorRawRequest,
      };
    }
  }

  private async evaluateWithRubrics(
    context: EvaluationContext,
    judgeProvider: Provider,
    rubrics: readonly RubricItem[],
  ): Promise<EvaluationScore> {
    if (!rubrics || rubrics.length === 0) {
      throw new Error(
        `No rubrics found for evaluator "${context.evaluator?.name ?? 'llm_judge'}". Run "agentv generate rubrics" first.`,
      );
    }

    // Detect if any rubric uses score_ranges (analytic rubric mode)
    const hasScoreRanges = rubrics.some((r) => r.score_ranges && r.score_ranges.length > 0);

    if (hasScoreRanges) {
      return this.evaluateWithScoreRanges(context, judgeProvider, rubrics);
    }

    const prompt = this.buildRubricPrompt(context, rubrics);
    const systemPrompt = buildRubricOutputSchema();

    const evaluatorRawRequest: JsonObject = {
      userPrompt: prompt,
      systemPrompt,
      target: judgeProvider.targetName,
    };

    const { data } = await this.runWithRetry({
      context,
      judgeProvider,
      systemPrompt,
      userPrompt: prompt,
      schema: rubricEvaluationSchema,
    });

    const { score, verdict, hits, misses } = calculateRubricScore(data, rubrics);

    return {
      score,
      verdict,
      hits,
      misses,
      expectedAspectCount: rubrics.length,
      reasoning: data.overall_reasoning,
      evaluatorRawRequest,
    };
  }

  /**
   * Evaluate using score-range rubrics (analytic rubric scoring).
   * Each criterion is scored 0-10 and normalized to 0-1.
   */
  private async evaluateWithScoreRanges(
    context: EvaluationContext,
    judgeProvider: Provider,
    rubrics: readonly RubricItem[],
  ): Promise<EvaluationScore> {
    const prompt = this.buildScoreRangePrompt(context, rubrics);
    const systemPrompt = buildScoreRangeOutputSchema();

    const evaluatorRawRequest: JsonObject = {
      userPrompt: prompt,
      systemPrompt,
      target: judgeProvider.targetName,
    };

    const { data } = await this.runWithRetry({
      context,
      judgeProvider,
      systemPrompt,
      userPrompt: prompt,
      schema: scoreRangeEvaluationSchema,
    });

    const { score, verdict, hits, misses, details } = calculateScoreRangeResult(data, rubrics);

    return {
      score,
      verdict,
      hits,
      misses,
      expectedAspectCount: rubrics.length,
      reasoning: data.overall_reasoning,
      evaluatorRawRequest,
      details,
    };
  }

  /**
   * Build prompt for score-range rubric evaluation.
   */
  private buildScoreRangePrompt(
    context: EvaluationContext,
    rubrics: readonly RubricItem[],
  ): string {
    const formattedQuestion =
      context.promptInputs.question && context.promptInputs.question.trim().length > 0
        ? context.promptInputs.question
        : context.evalCase.question;

    const parts: string[] = [
      'You are an expert evaluator. Score the candidate answer on each criterion below using the provided score ranges.',
      'For each criterion, output an integer score from 0 to 10 based on which score range best matches the answer.',
      '',
      '[[ ## question ## ]]',
      formattedQuestion,
      '',
      '[[ ## expected_outcome ## ]]',
      context.evalCase.expected_outcome,
      '',
    ];

    if (context.evalCase.reference_answer && context.evalCase.reference_answer.trim().length > 0) {
      parts.push('[[ ## reference_answer ## ]]', context.evalCase.reference_answer, '');
    }

    parts.push(
      '[[ ## candidate_answer ## ]]',
      context.candidate,
      '',
      '[[ ## scoring_criteria ## ]]',
    );

    for (const rubric of rubrics) {
      const weightLabel = rubric.weight !== 1.0 ? ` (weight: ${rubric.weight})` : '';
      const minScoreLabel =
        rubric.required_min_score !== undefined
          ? ` [REQUIRED: min score ${rubric.required_min_score}]`
          : '';

      parts.push('', `### Criterion: ${rubric.id}${weightLabel}${minScoreLabel}`);

      if (rubric.expected_outcome) {
        parts.push(`Description: ${rubric.expected_outcome}`);
      }

      if (rubric.score_ranges && rubric.score_ranges.length > 0) {
        parts.push('Score ranges:');
        for (const range of rubric.score_ranges) {
          const [min, max] = range.score_range;
          const rangeLabel = min === max ? `${min}` : `${min}-${max}`;
          parts.push(`  - Score ${rangeLabel}: ${range.expected_outcome}`);
        }
      }
    }

    parts.push(
      '',
      'For each criterion, provide an integer score 0-10 that matches one of its defined score ranges.',
    );

    return parts.join('\n');
  }

  private buildRubricPrompt(context: EvaluationContext, rubrics: readonly RubricItem[]): string {
    const formattedQuestion =
      context.promptInputs.question && context.promptInputs.question.trim().length > 0
        ? context.promptInputs.question
        : context.evalCase.question;

    const parts: string[] = [
      'You are an expert evaluator. Evaluate the candidate answer against each rubric item below.',
      '',
      '[[ ## question ## ]]',
      formattedQuestion,
      '',
      '[[ ## expected_outcome ## ]]',
      context.evalCase.expected_outcome,
      '',
    ];

    if (context.evalCase.reference_answer && context.evalCase.reference_answer.trim().length > 0) {
      parts.push('[[ ## reference_answer ## ]]', context.evalCase.reference_answer, '');
    }

    parts.push('[[ ## candidate_answer ## ]]', context.candidate, '', '[[ ## rubrics ## ]]');

    for (const rubric of rubrics) {
      const requiredLabel = rubric.required ? ' (REQUIRED)' : '';
      const weightLabel = rubric.weight !== 1.0 ? ` (weight: ${rubric.weight})` : '';
      parts.push(`- [${rubric.id}]${requiredLabel}${weightLabel}: ${rubric.expected_outcome}`);
    }

    parts.push('', 'For each rubric, determine if it is satisfied and provide brief reasoning.');

    return parts.join('\n');
  }

  private async runWithRetry<T>(options: {
    readonly context: EvaluationContext;
    readonly judgeProvider: Provider;
    readonly systemPrompt: string;
    readonly userPrompt: string;
    readonly schema: z.ZodSchema<T>;
  }): Promise<{ data: T; providerResponse?: ProviderResponse }> {
    const { context, judgeProvider, systemPrompt, userPrompt, schema } = options;

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        // Prefer Vercel AI SDK language model if available.
        const model = judgeProvider.asLanguageModel?.();
        if (model) {
          const { text } = await generateText({
            model,
            system: systemPrompt,
            prompt: userPrompt,
            ...(this.maxOutputTokens ? { maxTokens: this.maxOutputTokens } : {}),
            ...(typeof this.temperature === 'number' ? { temperature: this.temperature } : {}),
          });

          const data = schema.parse(parseJsonFromText(text));
          return { data };
        }

        const response = await judgeProvider.invoke({
          question: userPrompt,
          systemPrompt,
          evalCaseId: context.evalCase.id,
          attempt: context.attempt,
          maxOutputTokens: this.maxOutputTokens,
          temperature: this.temperature,
        });

        const data = schema.parse(
          parseJsonFromText(extractLastAssistantContent(response.outputMessages)),
        );
        return { data, providerResponse: response };
      } catch (e: unknown) {
        lastError = e instanceof Error ? e : new Error(String(e));
      }
    }

    throw new Error(`Failed to parse evaluator response after 3 attempts: ${lastError?.message}`);
  }
}

/**
 * Build the mandatory output schema that all evaluators must follow.
 * This schema is always appended to the evaluator template.
 */
export function buildOutputSchema(): string {
  return [
    'You must respond with a single JSON object matching this schema:',
    '',
    '{',
    '  "score": <number between 0.0 and 1.0>,',
    '  "hits": [<array of strings, max 4 items, brief specific achievements>],',
    '  "misses": [<array of strings, max 4 items, brief specific failures or omissions, empty if none>],',
    '  "reasoning": "<string, concise explanation for the score, 1-2 sentences max>"',
    '}',
  ].join('\n');
}

function buildRubricOutputSchema(): string {
  return `You are an expert evaluator. Evaluate the candidate answer against each rubric item.
You must return a valid JSON object matching this schema:
{
  "checks": [
    {
      "id": "string (rubric id)",
      "satisfied": boolean,
      "reasoning": "string (brief explanation)"
    }
  ],
  "overall_reasoning": "string (summary)"
}`;
}

function substituteVariables(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, varName) => {
    return variables[varName] ?? match;
  });
}

function calculateRubricScore(
  result: z.infer<typeof rubricEvaluationSchema>,
  rubrics: readonly RubricItem[],
): {
  score: number;
  verdict: 'pass' | 'fail' | 'borderline';
  hits: string[];
  misses: string[];
} {
  const rubricMap = new Map(rubrics.map((rubric) => [rubric.id, rubric]));
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
      hits.push(`[${rubric.id}] ${rubric.expected_outcome}: ${check.reasoning}`);
    } else {
      misses.push(`[${rubric.id}] ${rubric.expected_outcome}: ${check.reasoning}`);
      if (rubric.required) {
        failedRequired = true;
      }
    }
  }

  const score = totalWeight > 0 ? Math.min(1, Math.max(0, earnedWeight / totalWeight)) : 0;
  const verdict = failedRequired ? 'fail' : scoreToVerdict(score);
  return { score, verdict, hits, misses };
}

/**
 * Build the output schema for score-range rubric evaluation.
 */
function buildScoreRangeOutputSchema(): string {
  return `You are an expert evaluator. Score the candidate answer on each criterion.
You must return a valid JSON object matching this schema:
{
  "checks": [
    {
      "id": "string (criterion id)",
      "score": integer (0-10),
      "reasoning": "string (brief explanation for score)"
    }
  ],
  "overall_reasoning": "string (summary, optional)"
}

Important: The "score" must be an integer from 0 to 10 that falls within one of the defined score ranges for that criterion.`;
}

/**
 * Calculate score from score-range rubric evaluation results.
 * - Normalizes each criterion score (0-10) to 0-1 by dividing by 10
 * - Computes weighted average across criteria
 * - Applies required_min_score gating (force fail if below threshold)
 */
function calculateScoreRangeResult(
  result: z.infer<typeof scoreRangeEvaluationSchema>,
  rubrics: readonly RubricItem[],
): {
  score: number;
  verdict: 'pass' | 'fail' | 'borderline';
  hits: string[];
  misses: string[];
  details: JsonObject;
} {
  const rubricMap = new Map(rubrics.map((rubric) => [rubric.id, rubric]));
  const hits: string[] = [];
  const misses: string[] = [];
  const rawScores: Record<string, number> = {};
  let totalWeight = 0;
  let weightedScoreSum = 0;
  let failedRequired = false;

  for (const check of result.checks) {
    const rubric = rubricMap.get(check.id);
    if (!rubric) {
      continue;
    }

    const rawScore = Math.max(0, Math.min(10, check.score)); // Clamp to 0-10
    const normalizedScore = rawScore / 10; // Normalize to 0-1
    rawScores[rubric.id] = rawScore;

    totalWeight += rubric.weight;
    weightedScoreSum += normalizedScore * rubric.weight;

    // Determine required minimum score:
    // - If required_min_score is set, use it directly
    // - If required is true (legacy), treat as required_min_score: 10
    // - Otherwise, no gating
    let requiredMinScore: number | undefined;
    if (rubric.required_min_score !== undefined) {
      requiredMinScore = rubric.required_min_score;
    } else if (rubric.required === true) {
      requiredMinScore = 10; // Legacy: required: true means must score 10/10
    }

    // Find the matching score range description for reporting
    const matchingRange = rubric.score_ranges?.find(
      (r) => rawScore >= r.score_range[0] && rawScore <= r.score_range[1],
    );
    const rangeDescription = matchingRange?.expected_outcome ?? '';
    const criterionLabel = rubric.expected_outcome ?? rubric.id;

    const reasoningText = check.reasoning ? `: ${check.reasoning}` : '';
    const scoreInfo = `[${rubric.id}] ${criterionLabel} - Score: ${rawScore}/10 (${rangeDescription})${reasoningText}`;

    // Check gating
    if (requiredMinScore !== undefined && rawScore < requiredMinScore) {
      failedRequired = true;
      misses.push(scoreInfo);
    } else if (rawScore >= 7) {
      hits.push(scoreInfo);
    } else {
      misses.push(scoreInfo);
    }
  }

  const score = totalWeight > 0 ? Math.min(1, Math.max(0, weightedScoreSum / totalWeight)) : 0;
  const verdict = failedRequired ? 'fail' : scoreToVerdict(score);

  return {
    score,
    verdict,
    hits,
    misses,
    details: {
      raw_scores: rawScores,
      normalization: 'score / 10',
      aggregation: 'weighted_average',
    },
  };
}
