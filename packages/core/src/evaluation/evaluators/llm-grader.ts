import fs from 'node:fs/promises';
import path from 'node:path';

import { generateText, stepCountIs, tool } from 'ai';
import { z } from 'zod';

import type { Provider, ProviderResponse } from '../providers/types.js';
import { extractLastAssistantContent, isAgentProvider } from '../providers/types.js';
import { TEMPLATE_VARIABLES } from '../template-variables.js';
import type { TokenUsage } from '../trace.js';
import type { AssertionEntry, JsonObject, RubricItem } from '../types.js';
import { clampScore, isNonEmptyString, parseJsonFromText, scoreToVerdict } from './scoring.js';
import type { EvaluationContext, EvaluationScore, Evaluator } from './types.js';

// ---------------------------------------------------------------------------
// Constants for built-in agent mode (filesystem tools)
// ---------------------------------------------------------------------------

const DEFAULT_MAX_STEPS = 10;
const MAX_STEPS_LIMIT = 50;
const MAX_FILE_SIZE = 50 * 1024; // 50KB
const MAX_SEARCH_MATCHES = 20;

/**
 * Directories/patterns to skip during file search.
 */
const SEARCH_SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  '__pycache__',
  '.cache',
]);

/**
 * Binary file extensions to skip during search.
 */
const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.svg',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.mp3',
  '.mp4',
  '.wav',
  '.zip',
  '.tar',
  '.gz',
  '.pdf',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
]);

/**
 * Default evaluator template for the user prompt (variables will be substituted).
 * Custom evaluators can override this via evaluatorTemplate option.
 */
export const DEFAULT_EVALUATOR_TEMPLATE = `You are an expert evaluator. Your goal is to grade the answer based on how well it achieves the criteria for the original task.

Use the reference_answer as a gold standard for a high-quality response (if provided). The reference_answer may be a simple text response, or it may contain a sequence of expected agent messages including tool calls. When it contains multiple messages, the last message represents the final expected answer. The answer does not need to match it verbatim, but should capture the key points and follow the same spirit.

Be concise and focused in your evaluation. Provide succinct, specific feedback rather than verbose explanations.

[[ ## criteria ## ]]
{{${TEMPLATE_VARIABLES.CRITERIA}}}

[[ ## question ## ]]
{{${TEMPLATE_VARIABLES.INPUT_TEXT}}}

[[ ## reference_answer ## ]]
{{${TEMPLATE_VARIABLES.EXPECTED_OUTPUT_TEXT}}}

[[ ## answer ## ]]
{{${TEMPLATE_VARIABLES.OUTPUT_TEXT}}}`;

type GraderProviderResolver = (context: EvaluationContext) => Promise<Provider | undefined>;

export interface LlmGraderEvaluatorOptions {
  readonly resolveGraderProvider: GraderProviderResolver;
  /** @deprecated Use `resolveGraderProvider` instead. */
  readonly resolveJudgeProvider?: GraderProviderResolver;
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
  readonly evaluatorTemplate?: string;
  readonly maxSteps?: number;
  readonly graderTargetProvider?: Provider;
  /** @deprecated Use `graderTargetProvider` instead. */
  readonly judgeTargetProvider?: Provider;
}

const freeformEvaluationSchema = z.object({
  score: z.number().min(0).max(1).describe('Score between 0.0 and 1.0'),
  assertions: z
    .array(
      z.object({
        text: z.string().describe('Brief description of what was checked'),
        passed: z.boolean().describe('Whether this aspect was satisfied'),
        evidence: z.string().describe('Concise evidence (1-2 sentences)').optional(),
      }),
    )
    .describe('Per-aspect evaluation results — one entry per aspect checked')
    .optional(),
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

export { freeformEvaluationSchema, rubricEvaluationSchema };

export class LlmGraderEvaluator implements Evaluator {
  readonly kind = 'llm-grader';

  private readonly resolveGraderProvider: GraderProviderResolver;
  private readonly maxOutputTokens?: number;
  private readonly temperature?: number;
  private readonly evaluatorTemplate?: string;
  private readonly maxSteps: number;
  private readonly graderTargetProvider?: Provider;

  constructor(options: LlmGraderEvaluatorOptions) {
    this.resolveGraderProvider = (options.resolveGraderProvider ??
      options.resolveJudgeProvider) as NonNullable<typeof options.resolveGraderProvider>;
    this.maxOutputTokens = options.maxOutputTokens;
    this.temperature = options.temperature;
    this.evaluatorTemplate = options.evaluatorTemplate;
    this.maxSteps = Math.min(options.maxSteps ?? DEFAULT_MAX_STEPS, MAX_STEPS_LIMIT);
    this.graderTargetProvider = options.graderTargetProvider ?? options.judgeTargetProvider;
  }

  async evaluate(context: EvaluationContext): Promise<EvaluationScore> {
    // Delegate mode: grader target provider is an agent provider — send prompt via invoke()
    if (this.graderTargetProvider) {
      return this.evaluateWithGraderTarget(context);
    }

    const graderProvider = await this.resolveGraderProvider(context);
    if (!graderProvider) {
      throw new Error('No grader provider available for LLM grading');
    }

    // Built-in agent mode: agentv provider → AI SDK generateText with filesystem tools
    if (graderProvider.kind === 'agentv') {
      return this.evaluateBuiltIn(context, graderProvider);
    }

    // Delegate mode: resolved provider is an agent provider → send prompt via invoke()
    if (isAgentProvider(graderProvider)) {
      return this.evaluateWithDelegatedAgent(context, graderProvider);
    }

    // LLM mode: structured JSON evaluation
    const config = context.evaluator;
    if (
      (config?.type === 'llm-grader' || config?.type === 'llm-judge') &&
      config.rubrics &&
      config.rubrics.length > 0
    ) {
      return this.evaluateWithRubrics(context, graderProvider, config.rubrics);
    }

    return this.evaluateFreeform(context, graderProvider);
  }

  // ---------------------------------------------------------------------------
  // LLM mode (existing)
  // ---------------------------------------------------------------------------

  private async evaluateFreeform(
    context: EvaluationContext,
    graderProvider: Provider,
  ): Promise<EvaluationScore> {
    const formattedQuestion =
      context.promptInputs.question && context.promptInputs.question.trim().length > 0
        ? context.promptInputs.question
        : context.evalCase.question;

    // Prepare template variables for substitution
    const variables = {
      [TEMPLATE_VARIABLES.INPUT]: JSON.stringify(context.evalCase.input_segments, null, 2),
      [TEMPLATE_VARIABLES.EXPECTED_OUTPUT]: JSON.stringify(
        context.evalCase.expected_output,
        null,
        2,
      ),
      [TEMPLATE_VARIABLES.OUTPUT]: JSON.stringify(context.output ?? [], null, 2),
      [TEMPLATE_VARIABLES.ANSWER]: context.candidate.trim(),
      [TEMPLATE_VARIABLES.REFERENCE_ANSWER]: (context.evalCase.reference_answer ?? '').trim(),
      [TEMPLATE_VARIABLES.CRITERIA]: context.evalCase.criteria.trim(),
      [TEMPLATE_VARIABLES.QUESTION]: formattedQuestion.trim(),
      [TEMPLATE_VARIABLES.FILE_CHANGES]: context.fileChanges ?? '',
      // Text convenience accessors (new names, always strings)
      [TEMPLATE_VARIABLES.INPUT_TEXT]: formattedQuestion.trim(),
      [TEMPLATE_VARIABLES.OUTPUT_TEXT]: context.candidate.trim(),
      [TEMPLATE_VARIABLES.EXPECTED_OUTPUT_TEXT]: (context.evalCase.reference_answer ?? '').trim(),
    };

    // Build system prompt (only the mandatory output schema)
    const systemPrompt = buildOutputSchema();

    // Build user prompt based on custom template or default template
    const evaluatorTemplate =
      context.evaluatorTemplateOverride ?? this.evaluatorTemplate ?? DEFAULT_EVALUATOR_TEMPLATE;
    let userPrompt = substituteVariables(evaluatorTemplate, variables);

    // Append file_changes section to default template only when present
    if (context.fileChanges && !context.evaluatorTemplateOverride && !this.evaluatorTemplate) {
      userPrompt += `\n\n[[ ## file_changes ## ]]\n${context.fileChanges}`;
    }

    const evaluatorRawRequest: JsonObject = {
      userPrompt,
      systemPrompt,
      target: graderProvider.targetName,
    };

    try {
      const { data, tokenUsage } = await this.runWithRetry({
        context,
        graderProvider,
        systemPrompt,
        userPrompt,
        schema: freeformEvaluationSchema,
      });

      const score = clampScore(data.score);
      const assertions: AssertionEntry[] = Array.isArray(data.assertions)
        ? data.assertions.slice(0, 8)
        : [];

      return {
        score,
        verdict: scoreToVerdict(score),
        assertions,
        expectedAspectCount: Math.max(assertions.length, 1),
        evaluatorRawRequest,
        tokenUsage,
      };
    } catch (e: unknown) {
      // Grader parse failure -> skip (not silent zero).
      // Signals infrastructure error to downstream consumers, excluded from score averages.
      const message = e instanceof Error ? e.message : String(e);
      const evalName = context.evaluator?.name ?? 'llm-grader';
      console.warn(`⚠ LLM grader "${evalName}" failed after 3 attempts (${message}) — skipped`);
      return {
        score: 0,
        verdict: 'skip' as const,
        assertions: [{ text: `Grader parse failure after 3 attempts: ${message}`, passed: false }],
        expectedAspectCount: 1,
        evaluatorRawRequest,
      };
    }
  }

  private async evaluateWithRubrics(
    context: EvaluationContext,
    graderProvider: Provider,
    rubrics: readonly RubricItem[],
  ): Promise<EvaluationScore> {
    if (!rubrics || rubrics.length === 0) {
      throw new Error(
        `No rubrics found for evaluator "${context.evaluator?.name ?? 'llm-grader'}". Run "agentv generate rubrics" first.`,
      );
    }

    // Detect if any rubric uses score_ranges (analytic rubric mode)
    const hasScoreRanges = rubrics.some((r) => r.score_ranges && r.score_ranges.length > 0);

    if (hasScoreRanges) {
      return this.evaluateWithScoreRanges(context, graderProvider, rubrics);
    }

    const prompt = this.buildRubricPrompt(context, rubrics);
    const systemPrompt = buildRubricOutputSchema();

    const evaluatorRawRequest: JsonObject = {
      userPrompt: prompt,
      systemPrompt,
      target: graderProvider.targetName,
    };

    try {
      const { data, tokenUsage } = await this.runWithRetry({
        context,
        graderProvider,
        systemPrompt,
        userPrompt: prompt,
        schema: rubricEvaluationSchema,
      });

      const { score, verdict, assertions } = calculateRubricScore(data, rubrics);

      return {
        score,
        verdict,
        assertions,
        expectedAspectCount: rubrics.length,
        evaluatorRawRequest,
        tokenUsage,
      };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      const evalName = context.evaluator?.name ?? 'llm-grader';
      console.warn(`⚠ LLM grader "${evalName}" failed after 3 attempts (${message}) — skipped`);
      return {
        score: 0,
        verdict: 'skip' as const,
        assertions: [{ text: `Grader parse failure after 3 attempts: ${message}`, passed: false }],
        expectedAspectCount: rubrics.length,
        evaluatorRawRequest,
      };
    }
  }

  /**
   * Evaluate using score-range rubrics (analytic rubric scoring).
   * Each criterion is scored 0-10 and normalized to 0-1.
   */
  private async evaluateWithScoreRanges(
    context: EvaluationContext,
    graderProvider: Provider,
    rubrics: readonly RubricItem[],
  ): Promise<EvaluationScore> {
    const prompt = this.buildScoreRangePrompt(context, rubrics);
    const systemPrompt = buildScoreRangeOutputSchema();

    const evaluatorRawRequest: JsonObject = {
      userPrompt: prompt,
      systemPrompt,
      target: graderProvider.targetName,
    };

    try {
      const { data, tokenUsage } = await this.runWithRetry({
        context,
        graderProvider,
        systemPrompt,
        userPrompt: prompt,
        schema: scoreRangeEvaluationSchema,
      });

      const { score, verdict, assertions, details } = calculateScoreRangeResult(data, rubrics);

      return {
        score,
        verdict,
        assertions,
        expectedAspectCount: rubrics.length,
        evaluatorRawRequest,
        details,
        tokenUsage,
      };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      const evalName = context.evaluator?.name ?? 'llm-grader';
      console.warn(`⚠ LLM grader "${evalName}" failed after 3 attempts (${message}) — skipped`);
      return {
        score: 0,
        verdict: 'skip' as const,
        assertions: [{ text: `Grader parse failure after 3 attempts: ${message}`, passed: false }],
        expectedAspectCount: rubrics.length,
        evaluatorRawRequest,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Built-in agent mode (agentv provider — AI SDK generateText with filesystem tools)
  // ---------------------------------------------------------------------------

  /**
   * Built-in mode: Uses Vercel AI SDK generateText() with sandboxed filesystem tools.
   */
  private async evaluateBuiltIn(
    context: EvaluationContext,
    graderProvider: Provider,
  ): Promise<EvaluationScore> {
    const model = graderProvider.asLanguageModel?.();
    if (!model) {
      throw new Error(
        `Grader provider '${graderProvider.targetName}' does not support asLanguageModel() — required for built-in agent mode`,
      );
    }

    const workspacePath = context.workspacePath;
    if (!workspacePath) {
      throw new Error(
        'llm-grader built-in agent mode requires a workspace_template target (workspacePath is not set)',
      );
    }

    const systemPrompt = this.buildAgentSystemPrompt(context);
    const userPrompt = this.buildAgentUserPrompt(context);

    const config = context.evaluator;
    const rubrics =
      config?.type === 'llm-grader' || config?.type === 'llm-judge' ? config.rubrics : undefined;

    const fsTools = createFilesystemTools(workspacePath);

    const evaluatorRawRequest: JsonObject = {
      mode: 'built-in',
      systemPrompt,
      userPrompt,
      target: graderProvider.targetName,
      maxSteps: this.maxSteps,
    };

    try {
      const { text, steps } = await generateText({
        model,
        system: systemPrompt,
        prompt: userPrompt,
        tools: fsTools,
        stopWhen: stepCountIs(this.maxSteps),
        temperature: this.temperature ?? 0,
      });

      const toolCallCount = steps.reduce((count, step) => count + (step.toolCalls?.length ?? 0), 0);

      const details: JsonObject = {
        mode: 'built-in',
        steps: steps.length,
        tool_calls: toolCallCount,
      };

      return this.parseAgentResult(text, rubrics, evaluatorRawRequest, details);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        score: 0,
        verdict: 'fail',
        assertions: [{ text: `llm-grader built-in evaluation failed: ${message}`, passed: false }],
        expectedAspectCount: 1,
        evaluatorRawRequest,
        details: { mode: 'built-in', error: message },
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Delegate mode (agent provider — send prompt via Provider.invoke())
  // ---------------------------------------------------------------------------

  /**
   * Grader target mode: Delegates to an explicit graderTargetProvider via Provider.invoke().
   */
  private async evaluateWithGraderTarget(context: EvaluationContext): Promise<EvaluationScore> {
    return this.evaluateWithDelegate(
      context,
      this.graderTargetProvider as Provider,
      'grader_target',
    );
  }

  /**
   * Delegate mode: resolved provider is an agent provider — send prompt via invoke().
   */
  private async evaluateWithDelegatedAgent(
    context: EvaluationContext,
    graderProvider: Provider,
  ): Promise<EvaluationScore> {
    return this.evaluateWithDelegate(context, graderProvider, 'delegate');
  }

  /**
   * Shared implementation for grader_target and delegate modes.
   * Both invoke a provider and parse the agent result from the response.
   */
  private async evaluateWithDelegate(
    context: EvaluationContext,
    provider: Provider,
    modeLabel: string,
  ): Promise<EvaluationScore> {
    const workspacePath = context.workspacePath;
    const prompt = this.buildDelegatedPrompt(context);

    const evaluatorRawRequest: JsonObject = {
      mode: modeLabel,
      grader_target: provider.targetName,
      prompt,
    };

    try {
      const response = await provider.invoke({
        question: prompt,
        cwd: workspacePath,
        evalCaseId: context.evalCase.id,
        attempt: context.attempt,
      });

      const assistantContent = extractLastAssistantContent(response.output);
      if (!assistantContent) {
        return {
          score: 0,
          verdict: 'fail',
          assertions: [
            { text: `llm-grader ${modeLabel} returned no assistant response`, passed: false },
          ],
          expectedAspectCount: 1,
          evaluatorRawRequest,
          details: { mode: modeLabel, grader_target: provider.targetName },
        };
      }

      const config = context.evaluator;
      const rubrics =
        config?.type === 'llm-grader' || config?.type === 'llm-judge' ? config.rubrics : undefined;

      const details: JsonObject = {
        mode: modeLabel,
        grader_target: provider.targetName,
      };

      return this.parseAgentResult(assistantContent, rubrics, evaluatorRawRequest, details);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        score: 0,
        verdict: 'fail',
        assertions: [
          { text: `llm-grader ${modeLabel} evaluation failed: ${message}`, passed: false },
        ],
        expectedAspectCount: 1,
        evaluatorRawRequest,
        details: {
          mode: modeLabel,
          grader_target: provider.targetName,
          error: message,
        },
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Prompt builders for agent modes
  // ---------------------------------------------------------------------------

  /**
   * Build system prompt for built-in agent mode.
   * Includes output format instructions.
   */
  private buildAgentSystemPrompt(context: EvaluationContext): string {
    const config = context.evaluator;
    const rubrics =
      config?.type === 'llm-grader' || config?.type === 'llm-judge' ? config.rubrics : undefined;

    const parts: string[] = [
      'You are an expert evaluator with access to the workspace filesystem.',
      'Use the provided tools to investigate the workspace and verify the criteria are met.',
      'Thoroughly examine relevant files before making your assessment.',
      '',
    ];

    if (rubrics && rubrics.length > 0) {
      parts.push(buildRubricOutputSchema());
    } else {
      parts.push(buildOutputSchema());
    }

    return parts.join('\n');
  }

  /**
   * Build user prompt for built-in agent mode.
   * Uses custom template if provided, otherwise builds default prompt.
   */
  private buildAgentUserPrompt(context: EvaluationContext): string {
    const formattedQuestion =
      context.promptInputs.question && context.promptInputs.question.trim().length > 0
        ? context.promptInputs.question
        : context.evalCase.question;

    const variables: Record<string, string> = {
      [TEMPLATE_VARIABLES.ANSWER]: context.candidate.trim(),
      [TEMPLATE_VARIABLES.REFERENCE_ANSWER]: (context.evalCase.reference_answer ?? '').trim(),
      [TEMPLATE_VARIABLES.CRITERIA]: context.evalCase.criteria.trim(),
      [TEMPLATE_VARIABLES.QUESTION]: formattedQuestion.trim(),
      [TEMPLATE_VARIABLES.FILE_CHANGES]: context.fileChanges ?? '',
    };

    if (this.evaluatorTemplate) {
      return substituteVariables(this.evaluatorTemplate, variables);
    }

    const config = context.evaluator;
    const rubrics =
      config?.type === 'llm-grader' || config?.type === 'llm-judge' ? config.rubrics : undefined;

    const parts: string[] = [
      'Evaluate the candidate answer by investigating the workspace.',
      '',
      '[[ ## question ## ]]',
      formattedQuestion,
      '',
      '[[ ## criteria ## ]]',
      context.evalCase.criteria,
      '',
    ];

    if (context.evalCase.reference_answer && context.evalCase.reference_answer.trim().length > 0) {
      parts.push('[[ ## reference_answer ## ]]', context.evalCase.reference_answer, '');
    }

    parts.push('[[ ## answer ## ]]', context.candidate, '');

    if (context.fileChanges) {
      parts.push('[[ ## file_changes ## ]]', context.fileChanges, '');
    }

    if (rubrics && rubrics.length > 0) {
      parts.push('[[ ## rubrics ## ]]');
      for (const rubric of rubrics) {
        const requiredLabel = rubric.required ? ' (REQUIRED)' : '';
        const weightLabel = rubric.weight !== 1.0 ? ` (weight: ${rubric.weight})` : '';
        parts.push(`- [${rubric.id}]${requiredLabel}${weightLabel}: ${rubric.outcome}`);
      }
      parts.push(
        '',
        'For each rubric, investigate the workspace to determine if it is satisfied. Provide brief reasoning.',
      );
    } else {
      parts.push(
        'Investigate the workspace to verify the criteria. Provide a score between 0.0 and 1.0.',
      );
    }

    return parts.join('\n');
  }

  /**
   * Build the full evaluation prompt for delegate mode (agent providers).
   * Combines task context, criteria, candidate info, and output format instructions.
   */
  private buildDelegatedPrompt(context: EvaluationContext): string {
    const formattedQuestion =
      context.promptInputs.question && context.promptInputs.question.trim().length > 0
        ? context.promptInputs.question
        : context.evalCase.question;

    const config = context.evaluator;
    const rubrics =
      config?.type === 'llm-grader' || config?.type === 'llm-judge' ? config.rubrics : undefined;

    if (this.evaluatorTemplate) {
      const variables: Record<string, string> = {
        [TEMPLATE_VARIABLES.ANSWER]: context.candidate.trim(),
        [TEMPLATE_VARIABLES.REFERENCE_ANSWER]: (context.evalCase.reference_answer ?? '').trim(),
        [TEMPLATE_VARIABLES.CRITERIA]: context.evalCase.criteria.trim(),
        [TEMPLATE_VARIABLES.QUESTION]: formattedQuestion.trim(),
        [TEMPLATE_VARIABLES.FILE_CHANGES]: context.fileChanges ?? '',
      };
      const customPrompt = substituteVariables(this.evaluatorTemplate, variables);

      const outputSchema =
        rubrics && rubrics.length > 0 ? buildRubricOutputSchema() : buildOutputSchema();

      return `${customPrompt}\n\n${outputSchema}`;
    }

    const parts: string[] = [
      'You are an expert evaluator. Investigate the workspace to verify the criteria are met.',
      '',
      '[[ ## question ## ]]',
      formattedQuestion,
      '',
      '[[ ## criteria ## ]]',
      context.evalCase.criteria,
      '',
    ];

    if (context.evalCase.reference_answer && context.evalCase.reference_answer.trim().length > 0) {
      parts.push('[[ ## reference_answer ## ]]', context.evalCase.reference_answer, '');
    }

    parts.push('[[ ## answer ## ]]', context.candidate, '');

    if (context.fileChanges) {
      parts.push('[[ ## file_changes ## ]]', context.fileChanges, '');
    }

    if (rubrics && rubrics.length > 0) {
      parts.push('[[ ## rubrics ## ]]');
      for (const rubric of rubrics) {
        const requiredLabel = rubric.required ? ' (REQUIRED)' : '';
        const weightLabel = rubric.weight !== 1.0 ? ` (weight: ${rubric.weight})` : '';
        parts.push(`- [${rubric.id}]${requiredLabel}${weightLabel}: ${rubric.outcome}`);
      }
      parts.push('');
      parts.push(buildRubricOutputSchema());
    } else {
      parts.push(buildOutputSchema());
    }

    return parts.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Agent result parser (shared by built-in and delegate modes)
  // ---------------------------------------------------------------------------

  /**
   * Parse the agent's response text into an EvaluationScore.
   * Supports both freeform and rubric modes.
   */
  private parseAgentResult(
    text: string,
    rubrics: readonly RubricItem[] | undefined,
    evaluatorRawRequest: JsonObject,
    details: JsonObject,
  ): EvaluationScore {
    try {
      const parsed = parseJsonFromText(text);

      if (rubrics && rubrics.length > 0) {
        const data = rubricEvaluationSchema.parse(parsed);
        const { score, verdict, assertions } = calculateRubricScore(data, rubrics);
        return {
          score,
          verdict,
          assertions,
          expectedAspectCount: rubrics.length,
          evaluatorRawRequest,
          details,
        };
      }

      const data = freeformEvaluationSchema.parse(parsed);
      const score = clampScore(data.score);
      const assertions: AssertionEntry[] = Array.isArray(data.assertions)
        ? data.assertions.slice(0, 8)
        : [];

      return {
        score,
        verdict: scoreToVerdict(score),
        assertions,
        expectedAspectCount: Math.max(assertions.length, 1),
        evaluatorRawRequest,
        details,
      };
    } catch {
      return {
        score: 0,
        verdict: 'fail',
        assertions: [
          {
            text: 'Failed to parse llm-grader agent response as valid evaluation JSON',
            passed: false,
          },
        ],
        expectedAspectCount: 1,
        evaluatorRawRequest,
        details,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // LLM mode prompt builders
  // ---------------------------------------------------------------------------

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
      '[[ ## criteria ## ]]',
      context.evalCase.criteria,
      '',
    ];

    if (context.evalCase.reference_answer && context.evalCase.reference_answer.trim().length > 0) {
      parts.push('[[ ## reference_answer ## ]]', context.evalCase.reference_answer, '');
    }

    parts.push('[[ ## answer ## ]]', context.candidate, '');

    if (context.fileChanges) {
      parts.push('[[ ## file_changes ## ]]', context.fileChanges, '');
    }

    parts.push('[[ ## scoring_criteria ## ]]');

    for (const rubric of rubrics) {
      const weightLabel = rubric.weight !== 1.0 ? ` (weight: ${rubric.weight})` : '';
      const minScoreLabel =
        rubric.required_min_score !== undefined
          ? ` [REQUIRED: min score ${rubric.required_min_score}]`
          : '';

      parts.push('', `### Criterion: ${rubric.id}${weightLabel}${minScoreLabel}`);

      if (rubric.outcome) {
        parts.push(`Description: ${rubric.outcome}`);
      }

      if (rubric.score_ranges && rubric.score_ranges.length > 0) {
        parts.push('Score ranges:');
        for (const range of rubric.score_ranges) {
          const [min, max] = range.score_range;
          const rangeLabel = min === max ? `${min}` : `${min}-${max}`;
          parts.push(`  - Score ${rangeLabel}: ${range.outcome}`);
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
      '[[ ## criteria ## ]]',
      context.evalCase.criteria,
      '',
    ];

    if (context.evalCase.reference_answer && context.evalCase.reference_answer.trim().length > 0) {
      parts.push('[[ ## reference_answer ## ]]', context.evalCase.reference_answer, '');
    }

    parts.push('[[ ## answer ## ]]', context.candidate, '');

    if (context.fileChanges) {
      parts.push('[[ ## file_changes ## ]]', context.fileChanges, '');
    }

    parts.push('[[ ## rubrics ## ]]');

    for (const rubric of rubrics) {
      const requiredLabel = rubric.required ? ' (REQUIRED)' : '';
      const weightLabel = rubric.weight !== 1.0 ? ` (weight: ${rubric.weight})` : '';
      parts.push(`- [${rubric.id}]${requiredLabel}${weightLabel}: ${rubric.outcome}`);
    }

    parts.push('', 'For each rubric, determine if it is satisfied and provide brief reasoning.');

    return parts.join('\n');
  }

  // ---------------------------------------------------------------------------
  // LLM mode retry logic
  // ---------------------------------------------------------------------------

  private async runWithRetry<T>(options: {
    readonly context: EvaluationContext;
    readonly graderProvider: Provider;
    readonly systemPrompt: string;
    readonly userPrompt: string;
    readonly schema: z.ZodSchema<T>;
  }): Promise<{ data: T; providerResponse?: ProviderResponse; tokenUsage?: TokenUsage }> {
    const { context, graderProvider, systemPrompt, userPrompt, schema } = options;

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        // Prefer Vercel AI SDK language model if available.
        const model = graderProvider.asLanguageModel?.();
        if (model) {
          const result = await generateText({
            model,
            system: systemPrompt,
            prompt: userPrompt,
            ...(this.maxOutputTokens ? { maxTokens: this.maxOutputTokens } : {}),
            ...(typeof this.temperature === 'number' ? { temperature: this.temperature } : {}),
          });

          const data = schema.parse(parseJsonFromText(result.text));
          const rawUsage = result.usage;
          const tokenUsage =
            rawUsage?.inputTokens != null && rawUsage?.outputTokens != null
              ? { input: rawUsage.inputTokens, output: rawUsage.outputTokens }
              : undefined;
          return { data, tokenUsage };
        }

        const response = await graderProvider.invoke({
          question: userPrompt,
          systemPrompt,
          evalCaseId: context.evalCase.id,
          attempt: context.attempt,
          maxOutputTokens: this.maxOutputTokens,
          temperature: this.temperature,
        });

        const data = schema.parse(parseJsonFromText(extractLastAssistantContent(response.output)));
        return { data, providerResponse: response, tokenUsage: response.tokenUsage };
      } catch (e: unknown) {
        lastError = e instanceof Error ? e : new Error(String(e));
      }
    }

    throw new Error(`Failed to parse evaluator response after 3 attempts: ${lastError?.message}`);
  }
}

// ---------------------------------------------------------------------------
// Output schema builders (exported for reuse)
// ---------------------------------------------------------------------------

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
    '  "assertions": [',
    '    {',
    '      "text": "<brief description of what was checked>",',
    '      "passed": <boolean>,',
    '      "evidence": "<concise evidence, 1-2 sentences, optional>"',
    '    }',
    '  ]',
    '}',
  ].join('\n');
}

export function buildRubricOutputSchema(): string {
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

export function substituteVariables(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, varName) => {
    return variables[varName] ?? match;
  });
}

export function calculateRubricScore(
  result: z.infer<typeof rubricEvaluationSchema>,
  rubrics: readonly RubricItem[],
): {
  score: number;
  verdict: import('../types.js').EvaluationVerdict;
  assertions: AssertionEntry[];
} {
  const rubricMap = new Map(rubrics.map((rubric) => [rubric.id, rubric]));
  const assertions: AssertionEntry[] = [];
  let totalWeight = 0;
  let earnedWeight = 0;
  let failedRequired = false;

  for (const check of result.checks) {
    const rubric = rubricMap.get(check.id);
    if (!rubric) {
      continue;
    }

    totalWeight += rubric.weight;

    assertions.push({
      text: `[${rubric.id}] ${rubric.outcome}`,
      passed: check.satisfied,
      evidence: check.reasoning,
    });

    if (check.satisfied) {
      earnedWeight += rubric.weight;
    } else if (rubric.required) {
      failedRequired = true;
    }
  }

  const score = totalWeight > 0 ? Math.min(1, Math.max(0, earnedWeight / totalWeight)) : 0;
  const verdict = failedRequired ? 'fail' : scoreToVerdict(score);
  return { score, verdict, assertions };
}

/**
 * Build the output schema for score-range rubric evaluation.
 */
export function buildScoreRangeOutputSchema(): string {
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
  verdict: import('../types.js').EvaluationVerdict;
  assertions: AssertionEntry[];
  details: JsonObject;
} {
  const rubricMap = new Map(rubrics.map((rubric) => [rubric.id, rubric]));
  const assertions: AssertionEntry[] = [];
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
    const rangeDescription = matchingRange?.outcome ?? '';
    const criterionLabel = rubric.outcome ?? rubric.id;

    // Check gating
    const passed =
      !(requiredMinScore !== undefined && rawScore < requiredMinScore) && rawScore >= 7;
    if (requiredMinScore !== undefined && rawScore < requiredMinScore) {
      failedRequired = true;
    }

    assertions.push({
      text: `[${rubric.id}] ${criterionLabel} - Score: ${rawScore}/10 (${rangeDescription})`,
      passed,
      evidence: check.reasoning,
    });
  }

  const score = totalWeight > 0 ? Math.min(1, Math.max(0, weightedScoreSum / totalWeight)) : 0;
  const verdict = failedRequired ? 'fail' : scoreToVerdict(score);

  return {
    score,
    verdict,
    assertions,
    details: {
      raw_scores: rawScores,
      normalization: 'score / 10',
      aggregation: 'weighted_average',
    },
  };
}

// ---------------------------------------------------------------------------
// Sandboxed filesystem tools for built-in agent mode
// ---------------------------------------------------------------------------

/**
 * Resolve a relative path within the sandbox, preventing path traversal.
 * Returns the absolute path if valid, or throws if the path escapes the sandbox.
 */
function resolveSandboxed(basePath: string, relativePath: string): string {
  const resolved = path.resolve(basePath, relativePath);
  if (!resolved.startsWith(basePath + path.sep) && resolved !== basePath) {
    throw new Error(`Path '${relativePath}' is outside the workspace`);
  }
  return resolved;
}

/**
 * Create sandboxed filesystem tools for the AI SDK agent loop.
 */
function createFilesystemTools(workspacePath: string) {
  return {
    list_files: tool({
      description:
        'List files and directories at a relative path within the workspace. Returns names only (single level, no recursion).',
      inputSchema: z.object({
        path: z.string().describe('Relative path within workspace (use "." for root)').default('.'),
      }),
      execute: async (input: { path: string }) => {
        try {
          const resolved = resolveSandboxed(workspacePath, input.path);
          const entries = await fs.readdir(resolved, { withFileTypes: true });
          return entries
            .map((e) => ({
              name: e.name,
              type: e.isDirectory() ? 'directory' : 'file',
            }))
            .slice(0, 100);
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) };
        }
      },
    }),

    read_file: tool({
      description:
        'Read the content of a file at a relative path within the workspace. Large files are truncated at 50KB.',
      inputSchema: z.object({
        path: z.string().describe('Relative path to file within workspace'),
      }),
      execute: async (input: { path: string }) => {
        try {
          const resolved = resolveSandboxed(workspacePath, input.path);
          const stat = await fs.stat(resolved);
          if (stat.isDirectory()) {
            return { error: `'${input.path}' is a directory, not a file` };
          }
          const buffer = Buffer.alloc(Math.min(stat.size, MAX_FILE_SIZE));
          const fd = await fs.open(resolved, 'r');
          try {
            await fd.read(buffer, 0, buffer.length, 0);
          } finally {
            await fd.close();
          }
          const content = buffer.toString('utf-8');
          const truncated = stat.size > MAX_FILE_SIZE;
          return { content, truncated, size: stat.size };
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) };
        }
      },
    }),

    search_files: tool({
      description:
        'Search for a regex pattern across files in the workspace. Returns up to 20 matches. Skips binary files and node_modules/.git.',
      inputSchema: z.object({
        pattern: z.string().describe('Regex pattern to search for'),
        path: z.string().describe('Relative path to search within (use "." for root)').default('.'),
      }),
      execute: async (input: { pattern: string; path: string }) => {
        try {
          const resolved = resolveSandboxed(workspacePath, input.path);
          let regex: RegExp;
          try {
            regex = new RegExp(input.pattern, 'gi');
          } catch (regexErr) {
            return {
              error: `Invalid regex pattern: ${regexErr instanceof Error ? regexErr.message : String(regexErr)}`,
            };
          }
          const matches: Array<{ file: string; line: number; text: string }> = [];

          await searchDirectory(resolved, workspacePath, regex, matches);

          return { matches, total: matches.length };
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) };
        }
      },
    }),
  };
}

/**
 * Recursively search a directory for regex matches.
 */
async function searchDirectory(
  dirPath: string,
  workspacePath: string,
  regex: RegExp,
  matches: Array<{ file: string; line: number; text: string }>,
): Promise<void> {
  if (matches.length >= MAX_SEARCH_MATCHES) return;

  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (matches.length >= MAX_SEARCH_MATCHES) return;

    if (SEARCH_SKIP_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      await searchDirectory(fullPath, workspacePath, regex, matches);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (BINARY_EXTENSIONS.has(ext)) continue;

      try {
        const stat = await fs.stat(fullPath);
        if (stat.size > MAX_FILE_SIZE) continue;

        const content = await fs.readFile(fullPath, 'utf-8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          if (matches.length >= MAX_SEARCH_MATCHES) return;
          regex.lastIndex = 0;
          if (regex.test(lines[i])) {
            matches.push({
              file: path.relative(workspacePath, fullPath),
              line: i + 1,
              text: lines[i].substring(0, 200),
            });
          }
        }
      } catch {
        // Skip unreadable files
      }
    }
  }
}
