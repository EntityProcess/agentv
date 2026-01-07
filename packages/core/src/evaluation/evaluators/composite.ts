import { generateText } from 'ai';

import { extractLastAssistantContent } from '../providers/types.js';
import type { CompositeAggregatorConfig, CompositeEvaluatorConfig, JsonObject } from '../types.js';
import { executeScript } from './code-evaluator.js';
import { buildOutputSchema, freeformEvaluationSchema } from './llm-judge.js';
import {
  clampScore,
  isNonEmptyString,
  parseJsonFromText,
  parseJsonSafe,
  scoreToVerdict,
} from './scoring.js';
import type {
  ChildEvaluatorResult,
  EvaluationContext,
  EvaluationScore,
  Evaluator,
  EvaluatorFactory,
} from './types.js';

interface MemberResult {
  readonly id: string;
  readonly type: string;
  readonly result: EvaluationScore;
}

const DEFAULT_COMPOSITE_AGGREGATOR_PROMPT = `Review the following evaluation results:
{{EVALUATOR_RESULTS_JSON}}

Decide the final score and verdict based on all evaluator results.
Return a JSON object with: score (0.0-1.0), verdict (pass/fail/borderline), and reasoning.`;

export interface CompositeEvaluatorOptions {
  readonly config: CompositeEvaluatorConfig;
  readonly evaluatorFactory: EvaluatorFactory;
  readonly cwd?: string;
}

export class CompositeEvaluator implements Evaluator {
  readonly kind = 'composite';

  private readonly config: CompositeEvaluatorConfig;
  private readonly evaluatorFactory: EvaluatorFactory;
  private readonly cwd?: string;

  constructor(options: CompositeEvaluatorOptions) {
    this.config = options.config;
    this.evaluatorFactory = options.evaluatorFactory;
    this.cwd = options.cwd;
  }

  async evaluate(context: EvaluationContext): Promise<EvaluationScore> {
    // 1. Instantiate and run evaluators in parallel
    const memberResults = await Promise.all(
      this.config.evaluators.map(async (memberConfig) => {
        const evaluator = this.evaluatorFactory.create(memberConfig, context);
        return {
          id: memberConfig.name,
          type: memberConfig.type,
          result: await evaluator.evaluate(context),
        };
      }),
    );

    // 2. Aggregate results
    return this.aggregate(memberResults, context);
  }

  private async aggregate(
    results: readonly MemberResult[],
    context: EvaluationContext,
  ): Promise<EvaluationScore> {
    const aggregator = this.config.aggregator;

    switch (aggregator.type) {
      case 'code_judge':
        return this.runCodeAggregator(results, aggregator.path, aggregator.cwd ?? this.cwd);
      case 'llm_judge':
        return this.runLlmAggregator(results, context, aggregator);
      default:
        return this.runWeightedAverage(results, aggregator.weights);
    }
  }

  private runWeightedAverage(
    results: readonly MemberResult[],
    weights?: Record<string, number>,
  ): EvaluationScore {
    let totalWeight = 0;
    let weightedSum = 0;
    const allHits: string[] = [];
    const allMisses: string[] = [];
    const reasoningParts: string[] = [];
    const evaluatorResults: ChildEvaluatorResult[] = [];

    for (const member of results) {
      const weight = weights?.[member.id] ?? 1.0;
      totalWeight += weight;
      weightedSum += member.result.score * weight;
      allHits.push(...member.result.hits.map((h) => `[${member.id}] ${h}`));
      allMisses.push(...member.result.misses.map((m) => `[${member.id}] ${m}`));
      if (member.result.reasoning) {
        reasoningParts.push(`${member.id}: ${member.result.reasoning}`);
      }

      // Build child result entry
      evaluatorResults.push({
        name: member.id,
        type: member.type,
        score: member.result.score,
        weight,
        verdict: member.result.verdict,
        hits: [...member.result.hits],
        misses: [...member.result.misses],
        reasoning: member.result.reasoning,
        evaluatorRawRequest: member.result.evaluatorRawRequest,
        evaluatorResults: member.result.evaluatorResults,
        details: member.result.details,
      });
    }

    const finalScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

    return {
      score: clampScore(finalScore),
      verdict: scoreToVerdict(finalScore),
      hits: allHits,
      misses: allMisses,
      expectedAspectCount: Math.max(allHits.length + allMisses.length, 1),
      reasoning: reasoningParts.length > 0 ? reasoningParts.join('; ') : undefined,
      evaluatorRawRequest: {
        aggregator: 'weighted_average',
        ...(weights ? { weights } : {}),
      },
      evaluatorResults,
    };
  }

  private async runCodeAggregator(
    results: readonly MemberResult[],
    scriptPath: string,
    cwd?: string,
    weights?: Record<string, number>,
  ): Promise<EvaluationScore> {
    const resultsObject = Object.fromEntries(results.map((r) => [r.id, r.result]));
    const inputPayload = JSON.stringify({ results: resultsObject }, null, 2);

    // Build child results for output
    const evaluatorResults: ChildEvaluatorResult[] = results.map((member) => ({
      name: member.id,
      type: member.type,
      score: member.result.score,
      weight: weights?.[member.id] ?? 1.0,
      verdict: member.result.verdict,
      hits: [...member.result.hits],
      misses: [...member.result.misses],
      reasoning: member.result.reasoning,
      evaluatorRawRequest: member.result.evaluatorRawRequest,
      evaluatorResults: member.result.evaluatorResults,
      details: member.result.details,
    }));

    try {
      const stdout = await executeScript(scriptPath, inputPayload, undefined, cwd);
      const parsed = parseJsonSafe(stdout);
      const score = clampScore(typeof parsed?.score === 'number' ? parsed.score : 0);
      const hits = Array.isArray(parsed?.hits) ? parsed.hits.filter(isNonEmptyString) : [];
      const misses = Array.isArray(parsed?.misses) ? parsed.misses.filter(isNonEmptyString) : [];
      const reasoning = typeof parsed?.reasoning === 'string' ? parsed.reasoning : undefined;
      const verdict =
        typeof parsed?.verdict === 'string' &&
        (parsed.verdict === 'pass' || parsed.verdict === 'fail' || parsed.verdict === 'borderline')
          ? parsed.verdict
          : scoreToVerdict(score);

      return {
        score,
        verdict,
        hits,
        misses,
        expectedAspectCount: hits.length + misses.length || 1,
        reasoning,
        evaluatorRawRequest: {
          aggregator: 'code_judge',
          script: scriptPath,
        },
        evaluatorResults,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        score: 0,
        verdict: 'fail',
        hits: [],
        misses: [`Code aggregator failed: ${message}`],
        expectedAspectCount: 1,
        reasoning: message,
        evaluatorRawRequest: {
          aggregator: 'code_judge',
          script: scriptPath,
          error: message,
        },
        evaluatorResults,
      };
    }
  }

  private async runLlmAggregator(
    results: readonly MemberResult[],
    context: EvaluationContext,
    config: Extract<CompositeAggregatorConfig, { type: 'llm_judge' }>,
  ): Promise<EvaluationScore> {
    const judgeProvider = context.judgeProvider;
    if (!judgeProvider) {
      throw new Error('No judge provider available for LLM aggregation');
    }

    const resultsObject = Object.fromEntries(results.map((r) => [r.id, r.result]));
    const resultsJson = JSON.stringify(resultsObject, null, 2);

    // Build child results for output
    const evaluatorResults: ChildEvaluatorResult[] = results.map((member) => ({
      name: member.id,
      type: member.type,
      score: member.result.score,
      verdict: member.result.verdict,
      hits: [...member.result.hits],
      misses: [...member.result.misses],
      reasoning: member.result.reasoning,
      evaluatorRawRequest: member.result.evaluatorRawRequest,
      evaluatorResults: member.result.evaluatorResults,
      details: member.result.details,
    }));

    // Use custom prompt if provided, otherwise use default
    const promptTemplate = config.prompt ?? DEFAULT_COMPOSITE_AGGREGATOR_PROMPT;
    const userPrompt = promptTemplate.replace(/\{\{EVALUATOR_RESULTS_JSON\}\}/g, resultsJson);

    const systemPrompt = buildOutputSchema();

    const evaluatorRawRequest: JsonObject = {
      aggregator: 'llm_judge',
      userPrompt,
      systemPrompt,
      target: judgeProvider.targetName,
    };

    try {
      const model = judgeProvider.asLanguageModel?.();
      if (model) {
        const { text } = await generateText({
          model,
          system: systemPrompt,
          prompt: userPrompt,
        });

        const data = freeformEvaluationSchema.parse(parseJsonFromText(text));
        const score = clampScore(data.score);
        const hits = Array.isArray(data.hits) ? data.hits.filter(isNonEmptyString).slice(0, 4) : [];
        const misses = Array.isArray(data.misses)
          ? data.misses.filter(isNonEmptyString).slice(0, 4)
          : [];
        const reasoning = data.reasoning;

        return {
          score,
          verdict: scoreToVerdict(score),
          hits,
          misses,
          expectedAspectCount: Math.max(hits.length + misses.length, 1),
          reasoning,
          evaluatorRawRequest,
          evaluatorResults,
        };
      }

      const response = await judgeProvider.invoke({
        question: userPrompt,
        systemPrompt,
        evalCaseId: context.evalCase.id,
        attempt: context.attempt,
      });

      const data = freeformEvaluationSchema.parse(
        parseJsonFromText(extractLastAssistantContent(response.outputMessages)),
      );
      const score = clampScore(data.score);
      const hits = Array.isArray(data.hits) ? data.hits.filter(isNonEmptyString).slice(0, 4) : [];
      const misses = Array.isArray(data.misses)
        ? data.misses.filter(isNonEmptyString).slice(0, 4)
        : [];
      const reasoning = data.reasoning;

      return {
        score,
        verdict: scoreToVerdict(score),
        hits,
        misses,
        expectedAspectCount: Math.max(hits.length + misses.length, 1),
        reasoning,
        evaluatorRawRequest,
        evaluatorResults,
      };
    } catch {
      return {
        score: 0,
        verdict: 'fail',
        hits: [],
        misses: [],
        expectedAspectCount: 1,
        evaluatorRawRequest,
        evaluatorResults,
      };
    }
  }
}
