import { generateText } from 'ai';

import { extractLastAssistantContent } from '../providers/types.js';
import type {
  AssertionEntry,
  CompositeAggregatorConfig,
  CompositeGraderConfig,
  JsonObject,
} from '../types.js';
import { executeScript } from './code-grader.js';
import { buildOutputSchema, freeformEvaluationSchema } from './llm-grader.js';
import { clampScore, parseJsonFromText, parseJsonSafe, scoreToVerdict } from './scoring.js';
import type {
  ChildGraderResult,
  EvaluationContext,
  EvaluationScore,
  Grader,
  GraderFactory,
} from './types.js';

interface MemberResult {
  readonly id: string;
  readonly type: string;
  readonly result: EvaluationScore;
}

const DEFAULT_COMPOSITE_AGGREGATOR_PROMPT = `Review the following evaluation results:
{{EVALUATOR_RESULTS_JSON}}

Decide the final score and verdict based on all grader results.
Return a JSON object with: score (0.0-1.0), verdict (pass/fail), and reasoning.`;

export interface CompositeGraderOptions {
  readonly config: CompositeGraderConfig;
  readonly evaluatorFactory: GraderFactory;
  readonly cwd?: string;
}

export class CompositeGrader implements Grader {
  readonly kind = 'composite';

  private readonly config: CompositeGraderConfig;
  private readonly evaluatorFactory: GraderFactory;
  private readonly cwd?: string;

  constructor(options: CompositeGraderOptions) {
    this.config = options.config;
    this.evaluatorFactory = options.evaluatorFactory;
    this.cwd = options.cwd;
  }

  async evaluate(context: EvaluationContext): Promise<EvaluationScore> {
    // 1. Instantiate and run evaluators in parallel
    const memberResults = await Promise.all(
      this.config.assertions.map(async (memberConfig) => {
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
      case 'code-grader':
        return this.runCodeAggregator(results, aggregator.path, aggregator.cwd ?? this.cwd);
      case 'llm-grader':
        return this.runLlmAggregator(results, context, aggregator);
      case 'threshold':
        return this.runThreshold(results, aggregator.threshold);
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
    let evaluatedCount = 0;
    const allAssertions: AssertionEntry[] = [];
    const scores: ChildGraderResult[] = [];

    for (const member of results) {
      const weight = weights?.[member.id] ?? 1.0;

      // Always build child result entry for observability
      scores.push({
        name: member.id,
        type: member.type,
        score: member.result.score,
        weight,
        verdict: member.result.verdict,
        assertions: [...member.result.assertions],
        graderRawRequest: member.result.graderRawRequest,
        scores: member.result.scores,
        details: member.result.details,
        tokenUsage: member.result.tokenUsage,
      });

      // Skip-verdict members excluded from aggregation
      if (member.result.verdict === 'skip') {
        continue;
      }

      evaluatedCount++;
      totalWeight += weight;
      weightedSum += member.result.score * weight;
      allAssertions.push(
        ...member.result.assertions.map((a) => ({ ...a, text: `[${member.id}] ${a.text}` })),
      );
    }

    // If all members skipped, propagate skip verdict
    if (evaluatedCount === 0 && results.length > 0) {
      return {
        score: 0,
        verdict: 'skip' as const,
        assertions: [{ text: 'All evaluators skipped (infrastructure failure)', passed: false }],
        expectedAspectCount: 1,
        graderRawRequest: {
          aggregator: 'weighted_average',
          ...(weights ? { weights } : {}),
        },
        scores,
      };
    }

    const finalScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

    return {
      score: clampScore(finalScore),
      verdict: scoreToVerdict(finalScore),
      assertions: allAssertions,
      expectedAspectCount: allAssertions.length || 1,
      graderRawRequest: {
        aggregator: 'weighted_average',
        ...(weights ? { weights } : {}),
      },
      scores,
    };
  }

  private runThreshold(results: readonly MemberResult[], threshold: number): EvaluationScore {
    const scores: ChildGraderResult[] = [];
    const allAssertions: AssertionEntry[] = [];
    let passingCount = 0;
    let evaluatedCount = 0;

    for (const member of results) {
      // Always add to scores for observability
      scores.push({
        name: member.id,
        type: member.type,
        score: member.result.score,
        verdict: member.result.verdict,
        assertions: [...member.result.assertions],
        graderRawRequest: member.result.graderRawRequest,
        scores: member.result.scores,
        details: member.result.details,
        tokenUsage: member.result.tokenUsage,
      });

      // Skip-verdict members excluded from aggregation
      if (member.result.verdict === 'skip') {
        continue;
      }

      evaluatedCount++;
      const isPassing = member.result.verdict === 'pass';
      if (isPassing) {
        passingCount++;
      }

      allAssertions.push(
        ...member.result.assertions.map((a) => ({ ...a, text: `[${member.id}] ${a.text}` })),
      );
    }

    // If all members skipped, propagate skip verdict
    if (evaluatedCount === 0 && results.length > 0) {
      return {
        score: 0,
        verdict: 'skip' as const,
        assertions: [{ text: 'All evaluators skipped (infrastructure failure)', passed: false }],
        expectedAspectCount: 1,
        graderRawRequest: {
          aggregator: 'threshold',
          threshold,
        },
        scores,
      };
    }

    const totalCount = evaluatedCount;
    const score = totalCount > 0 ? passingCount / totalCount : 0;
    const pass = score >= threshold;

    allAssertions.unshift({
      text: `${passingCount}/${totalCount} evaluators passed (threshold: ${threshold})`,
      passed: pass,
    });

    return {
      score: clampScore(score),
      verdict: pass ? 'pass' : 'fail',
      assertions: allAssertions,
      expectedAspectCount: allAssertions.length || 1,
      graderRawRequest: {
        aggregator: 'threshold',
        threshold,
      },
      scores,
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
    const scores: ChildGraderResult[] = results.map((member) => ({
      name: member.id,
      type: member.type,
      score: member.result.score,
      weight: weights?.[member.id] ?? 1.0,
      verdict: member.result.verdict,
      assertions: [...member.result.assertions],
      graderRawRequest: member.result.graderRawRequest,
      scores: member.result.scores,
      details: member.result.details,
    }));

    try {
      const stdout = await executeScript(scriptPath, inputPayload, undefined, cwd);
      const parsed = parseJsonSafe(stdout);
      const score = clampScore(typeof parsed?.score === 'number' ? parsed.score : 0);
      const assertions: AssertionEntry[] = Array.isArray(parsed?.assertions)
        ? parsed.assertions
            .filter(
              (a: unknown): a is { text: string; passed: boolean; evidence?: string } =>
                typeof a === 'object' &&
                a !== null &&
                typeof (a as Record<string, unknown>).text === 'string',
            )
            .map((a) => ({
              text: String(a.text),
              passed: Boolean(a.passed),
              ...(typeof a.evidence === 'string' ? { evidence: a.evidence } : {}),
            }))
        : [];
      const verdict =
        typeof parsed?.verdict === 'string' &&
        (parsed.verdict === 'pass' || parsed.verdict === 'fail')
          ? parsed.verdict
          : scoreToVerdict(score);

      return {
        score,
        verdict,
        assertions,
        expectedAspectCount: assertions.length || 1,
        graderRawRequest: {
          aggregator: 'code-grader',
          script: scriptPath,
        },
        scores,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        score: 0,
        verdict: 'fail',
        assertions: [{ text: `Code aggregator failed: ${message}`, passed: false }],
        expectedAspectCount: 1,
        graderRawRequest: {
          aggregator: 'code-grader',
          script: scriptPath,
          error: message,
        },
        scores,
      };
    }
  }

  private async runLlmAggregator(
    results: readonly MemberResult[],
    context: EvaluationContext,
    config: Extract<CompositeAggregatorConfig, { type: 'llm-grader' }>,
  ): Promise<EvaluationScore> {
    const graderProvider = context.graderProvider;
    if (!graderProvider) {
      throw new Error('No grader provider available for LLM aggregation');
    }

    const resultsObject = Object.fromEntries(results.map((r) => [r.id, r.result]));
    const resultsJson = JSON.stringify(resultsObject, null, 2);

    // Build child results for output
    const scores: ChildGraderResult[] = results.map((member) => ({
      name: member.id,
      type: member.type,
      score: member.result.score,
      verdict: member.result.verdict,
      assertions: [...member.result.assertions],
      graderRawRequest: member.result.graderRawRequest,
      scores: member.result.scores,
      details: member.result.details,
    }));

    // Use custom prompt if provided, otherwise use default
    const promptTemplate = config.prompt ?? DEFAULT_COMPOSITE_AGGREGATOR_PROMPT;
    const userPrompt = promptTemplate.replace(/\{\{EVALUATOR_RESULTS_JSON\}\}/g, resultsJson);

    const systemPrompt = buildOutputSchema();

    const graderRawRequest: JsonObject = {
      aggregator: 'llm-grader',
      userPrompt,
      systemPrompt,
      target: graderProvider.targetName,
    };

    try {
      const model = graderProvider.asLanguageModel?.();
      if (model) {
        const { text } = await generateText({
          model,
          system: systemPrompt,
          prompt: userPrompt,
        });

        const data = freeformEvaluationSchema.parse(parseJsonFromText(text));
        const score = clampScore(data.score);
        const assertions: AssertionEntry[] = Array.isArray(data.assertions)
          ? data.assertions.slice(0, 8)
          : [];

        return {
          score,
          verdict: scoreToVerdict(score),
          assertions,
          expectedAspectCount: Math.max(assertions.length, 1),
          graderRawRequest,
          scores,
        };
      }

      const response = await graderProvider.invoke({
        question: userPrompt,
        systemPrompt,
        evalCaseId: context.evalCase.id,
        attempt: context.attempt,
      });

      const data = freeformEvaluationSchema.parse(
        parseJsonFromText(extractLastAssistantContent(response.output)),
      );
      const score = clampScore(data.score);
      const assertions: AssertionEntry[] = Array.isArray(data.assertions)
        ? data.assertions.slice(0, 8)
        : [];

      return {
        score,
        verdict: scoreToVerdict(score),
        assertions,
        expectedAspectCount: Math.max(assertions.length, 1),
        graderRawRequest,
        scores,
      };
    } catch {
      return {
        score: 0,
        verdict: 'fail',
        assertions: [{ text: 'LLM aggregator failed', passed: false }],
        expectedAspectCount: 1,
        graderRawRequest,
        scores,
      };
    }
  }
}
