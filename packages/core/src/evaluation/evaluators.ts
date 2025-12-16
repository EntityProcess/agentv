import { generateText } from 'ai';
import { z } from 'zod';

import type { ResolvedTarget } from './providers/targets.js';
import type { ChatPrompt, Provider, ProviderResponse } from './providers/types.js';
import { TEMPLATE_VARIABLES } from './template-variables.js';
import type {
  EvalCase,
  EvaluationVerdict,
  EvaluatorConfig,
  JsonObject,
  RubricItem,
} from './types.js';

export type { EvaluationVerdict };

/**
 * Default evaluator template for the user prompt (variables will be substituted).
 * Custom evaluators can override this via evaluatorTemplate option.
 */
const DEFAULT_EVALUATOR_TEMPLATE = `You are an expert evaluator. Your goal is to grade the candidate_answer based on how well it achieves the expected_outcome for the original task.

Use the reference_answer as a gold standard for a high-quality response (if provided). The candidate_answer does not need to match it verbatim, but should capture the key points and follow the same spirit.

Be concise and focused in your evaluation. Provide succinct, specific feedback rather than verbose explanations.

[[ ## expected_outcome ## ]]
{{${TEMPLATE_VARIABLES.EXPECTED_OUTCOME}}}

[[ ## question ## ]]
{{${TEMPLATE_VARIABLES.QUESTION}}}

[[ ## reference_answer ## ]]
{{${TEMPLATE_VARIABLES.REFERENCE_ANSWER}}}

[[ ## candidate_answer ## ]]
{{${TEMPLATE_VARIABLES.CANDIDATE_ANSWER}}}`;

export interface EvaluationContext {
  readonly evalCase: EvalCase;
  readonly candidate: string;
  readonly target: ResolvedTarget;
  readonly provider: Provider;
  readonly attempt: number;
  readonly promptInputs: {
    readonly question: string;
    readonly guidelines: string;
    readonly systemMessage?: string;
    readonly chatPrompt?: ChatPrompt;
  };
  readonly now: Date;
  readonly judgeProvider?: Provider;
  readonly evaluatorTemplateOverride?: string;
  readonly evaluator?: EvaluatorConfig;
}

export interface EvaluationScore {
  readonly score: number;
  readonly verdict: EvaluationVerdict;
  readonly hits: readonly string[];
  readonly misses: readonly string[];
  readonly expectedAspectCount: number;
  readonly reasoning?: string;
  readonly rawAspects?: readonly string[];
  readonly evaluatorRawRequest?: JsonObject;
}

export interface Evaluator {
  readonly kind: string;
  evaluate(context: EvaluationContext): Promise<EvaluationScore> | EvaluationScore;
}

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
        context.evalCase.expected_segments,
        null,
        2,
      ),
      [TEMPLATE_VARIABLES.CANDIDATE_ANSWER]: context.candidate.trim(),
      [TEMPLATE_VARIABLES.REFERENCE_ANSWER]: (context.evalCase.reference_answer ?? '').trim(),
      [TEMPLATE_VARIABLES.EXPECTED_OUTCOME]: context.evalCase.expected_outcome.trim(),
      [TEMPLATE_VARIABLES.QUESTION]: formattedQuestion.trim(),
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
      const { data, providerResponse } = await this.runWithRetry({
        context,
        judgeProvider,
        systemPrompt,
        userPrompt,
        schema: freeformEvaluationSchema,
      });

      const score = clampScore(data.score);
      const hits = Array.isArray(data.hits) ? data.hits.filter(isNonEmptyString).slice(0, 4) : [];
      const misses = Array.isArray(data.misses)
        ? data.misses.filter(isNonEmptyString).slice(0, 4)
        : [];
      const reasoning = data.reasoning ?? providerResponse?.reasoning;
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
      parts.push(`- [${rubric.id}]${requiredLabel}${weightLabel}: ${rubric.description}`);
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

        const data = schema.parse(parseJsonFromText(response.text ?? ''));
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
function buildOutputSchema(): string {
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

function scoreToVerdict(score: number): EvaluationVerdict {
  if (score >= 0.8) {
    return 'pass';
  }
  if (score >= 0.6) {
    return 'borderline';
  }
  return 'fail';
}

function clampScore(value: number): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function extractJsonBlob(text: string): string | undefined {
  const match = text.match(/\{[\s\S]*\}/);
  return match?.[0];
}

function parseJsonFromText(text: string): unknown {
  const cleaned = typeof text === 'string' ? text.replace(/```json\n?|```/g, '').trim() : '';
  const blob = extractJsonBlob(cleaned) ?? cleaned;
  return JSON.parse(blob);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

// Code Evaluator

export interface CodeEvaluatorOptions {
  readonly script: string;
  readonly cwd?: string;
  readonly agentTimeoutMs?: number;
}

export class CodeEvaluator implements Evaluator {
  readonly kind = 'code';

  private readonly script: string;
  private readonly cwd?: string;
  private readonly agentTimeoutMs?: number;

  constructor(options: CodeEvaluatorOptions) {
    this.script = options.script;
    this.cwd = options.cwd;
    this.agentTimeoutMs = options.agentTimeoutMs;
  }

  async evaluate(context: EvaluationContext): Promise<EvaluationScore> {
    const inputPayload = JSON.stringify(
      {
        question: context.evalCase.question,
        expected_outcome: context.evalCase.expected_outcome,
        reference_answer: context.evalCase.reference_answer,
        candidate_answer: context.candidate,
        guideline_paths: context.evalCase.guideline_paths,
        input_files: context.evalCase.file_paths,
        input_segments: context.evalCase.input_segments,
      },
      null,
      2,
    );

    try {
      const stdout = await executeScript(this.script, inputPayload, this.agentTimeoutMs, this.cwd);
      const parsed = parseJsonSafe(stdout);
      const score = clampScore(typeof parsed?.score === 'number' ? parsed.score : 0);
      const hits = Array.isArray(parsed?.hits) ? parsed.hits.filter(isNonEmptyString) : [];
      const misses = Array.isArray(parsed?.misses) ? parsed.misses.filter(isNonEmptyString) : [];
      const reasoning = typeof parsed?.reasoning === 'string' ? parsed.reasoning : undefined;

      return {
        score,
        verdict: scoreToVerdict(score),
        hits,
        misses,
        expectedAspectCount: hits.length + misses.length || 1,
        reasoning,
        evaluatorRawRequest: {
          script: this.script,
          ...(this.cwd ? { cwd: this.cwd } : {}),
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        score: 0,
        verdict: 'fail',
        hits: [],
        misses: [`Code evaluator failed: ${message}`],
        expectedAspectCount: 1,
        reasoning: message,
        evaluatorRawRequest: {
          script: this.script,
          ...(this.cwd ? { cwd: this.cwd } : {}),
          error: message,
        },
      };
    }
  }
}

function calculateRubricScore(
  result: z.infer<typeof rubricEvaluationSchema>,
  rubrics: readonly RubricItem[],
): {
  score: number;
  verdict: EvaluationVerdict;
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
      hits.push(`[${rubric.id}] ${rubric.description}: ${check.reasoning}`);
    } else {
      misses.push(`[${rubric.id}] ${rubric.description}: ${check.reasoning}`);
      if (rubric.required) {
        failedRequired = true;
      }
    }
  }

  const score = totalWeight > 0 ? Math.min(1, Math.max(0, earnedWeight / totalWeight)) : 0;
  const verdict = failedRequired ? 'fail' : scoreToVerdict(score);
  return { score, verdict, hits, misses };
}

// Helper functions for CodeEvaluator

async function executeScript(
  scriptPath: string,
  input: string,
  agentTimeoutMs?: number,
  cwd?: string,
): Promise<string> {
  const { spawn } = await import('node:child_process');

  return await new Promise<string>((resolve, reject) => {
    const child = spawn(scriptPath, {
      shell: true,
      cwd,
    });

    let stdout = '';
    let stderr = '';

    const timeout = agentTimeoutMs
      ? setTimeout(() => {
          child.kill();
          reject(new Error(`Code evaluator timed out after ${agentTimeoutMs}ms`));
        }, agentTimeoutMs)
      : undefined;

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });
    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });
    child.on('error', (error) => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      reject(error);
    });
    child.on('exit', (code) => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      if (code && code !== 0 && stderr.length > 0) {
        reject(new Error(`Code evaluator exited with code ${code}: ${stderr.trim()}`));
        return;
      }
      resolve(stdout.trim());
    });

    child.stdin?.write(input);
    child.stdin?.end();
  });
}

function parseJsonSafe(payload: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function substituteVariables(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, varName) => {
    return variables[varName] ?? match;
  });
}
