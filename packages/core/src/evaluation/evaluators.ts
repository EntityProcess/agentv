import { generateText } from 'ai';
import { z } from 'zod';

import type { ResolvedTarget } from './providers/targets.js';
import type { ChatPrompt, Provider, ProviderResponse } from './providers/types.js';
import { TEMPLATE_VARIABLES } from './template-variables.js';
import type { ToolTrajectoryEvaluatorConfig, TraceEvent, TraceSummary } from './trace.js';
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
  /** Normalized trace events from provider execution (if available) */
  readonly candidateTrace?: readonly TraceEvent[];
  /** Lightweight summary of trace events (if available) */
  readonly candidateTraceSummary?: TraceSummary;
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
  readonly evaluatorResults?: readonly ChildEvaluatorResult[];
}

export interface ChildEvaluatorResult {
  readonly name: string;
  readonly type: string;
  readonly score: number;
  readonly weight?: number;
  readonly verdict: EvaluationVerdict;
  readonly hits: readonly string[];
  readonly misses: readonly string[];
  readonly reasoning?: string;
  readonly evaluatorRawRequest?: JsonObject;
  readonly evaluatorResults?: readonly ChildEvaluatorResult[];
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

// Tool Trajectory Evaluator

export interface ToolTrajectoryEvaluatorOptions {
  readonly config: ToolTrajectoryEvaluatorConfig;
}

export class ToolTrajectoryEvaluator implements Evaluator {
  readonly kind = 'tool_trajectory';

  private readonly config: ToolTrajectoryEvaluatorConfig;

  constructor(options: ToolTrajectoryEvaluatorOptions) {
    this.config = options.config;
  }

  evaluate(context: EvaluationContext): EvaluationScore {
    const { candidateTrace, candidateTraceSummary } = context;

    // Handle missing trace
    if (!candidateTrace || !candidateTraceSummary) {
      return {
        score: 0,
        verdict: 'fail',
        hits: [],
        misses: ['No trace available for evaluation'],
        expectedAspectCount: 1,
      };
    }

    switch (this.config.mode) {
      case 'any_order':
        return this.evaluateAnyOrder(candidateTraceSummary);
      case 'in_order':
        return this.evaluateInOrder(candidateTrace);
      case 'exact':
        return this.evaluateExact(candidateTrace);
      default:
        return {
          score: 0,
          verdict: 'fail',
          hits: [],
          misses: [`Unknown mode: ${this.config.mode}`],
          expectedAspectCount: 1,
        };
    }
  }

  private evaluateAnyOrder(summary: TraceSummary): EvaluationScore {
    const minimums = this.config.minimums ?? {};
    const toolNames = Object.keys(minimums);
    const hits: string[] = [];
    const misses: string[] = [];

    for (const toolName of toolNames) {
      const required = minimums[toolName];
      const actual = summary.toolCallsByName[toolName] ?? 0;
      if (actual >= required) {
        hits.push(`${toolName}: called ${actual} times (required ≥${required})`);
      } else {
        misses.push(`${toolName}: called ${actual} times (required ≥${required})`);
      }
    }

    const totalChecks = toolNames.length || 1;
    const score = hits.length / totalChecks;

    return {
      score,
      verdict: scoreToVerdict(score),
      hits,
      misses,
      expectedAspectCount: totalChecks,
    };
  }

  private evaluateInOrder(trace: readonly TraceEvent[]): EvaluationScore {
    const expected = this.config.expected ?? [];
    const actualToolCalls = trace.filter((e) => e.type === 'tool_call' && e.name);

    const hits: string[] = [];
    const misses: string[] = [];
    let actualIndex = 0;

    for (let i = 0; i < expected.length; i++) {
      const expectedTool = expected[i].tool;
      let found = false;

      // Search forward in actual trace for the expected tool
      while (actualIndex < actualToolCalls.length) {
        if (actualToolCalls[actualIndex].name === expectedTool) {
          hits.push(`Found ${expectedTool} at position ${actualIndex}`);
          actualIndex++;
          found = true;
          break;
        }
        actualIndex++;
      }

      if (!found) {
        misses.push(`Expected ${expectedTool} at position ${i}, not found in remaining trace`);
      }
    }

    const totalChecks = expected.length || 1;
    const score = hits.length / totalChecks;

    return {
      score,
      verdict: scoreToVerdict(score),
      hits,
      misses,
      expectedAspectCount: totalChecks,
    };
  }

  private evaluateExact(trace: readonly TraceEvent[]): EvaluationScore {
    const expected = this.config.expected ?? [];
    const actualToolCalls = trace.filter((e) => e.type === 'tool_call' && e.name);

    const hits: string[] = [];
    const misses: string[] = [];

    // Check length match
    if (actualToolCalls.length !== expected.length) {
      misses.push(`Expected ${expected.length} tool calls, got ${actualToolCalls.length}`);
    }

    // Check each position
    const checkLength = Math.min(expected.length, actualToolCalls.length);
    for (let i = 0; i < checkLength; i++) {
      const expectedTool = expected[i].tool;
      const actualTool = actualToolCalls[i].name;
      if (actualTool === expectedTool) {
        hits.push(`Position ${i}: ${expectedTool} ✓`);
      } else {
        misses.push(`Position ${i}: expected ${expectedTool}, got ${actualTool}`);
      }
    }

    // Report extra expected tools not in trace
    for (let i = checkLength; i < expected.length; i++) {
      misses.push(`Position ${i}: expected ${expected[i].tool}, got nothing`);
    }

    const totalChecks = expected.length || 1;
    const score = hits.length / totalChecks;

    return {
      score,
      verdict: scoreToVerdict(score),
      hits,
      misses,
      expectedAspectCount: totalChecks,
    };
  }
}

// Expected Messages Tool Calls Evaluator

/**
 * Evaluator that validates tool_calls in expected_messages against the actual trace.
 * Extracts tool_calls from assistant messages in expected_messages and compares them
 * sequentially against tool_call events in the trace.
 */
export class ExpectedMessagesEvaluator implements Evaluator {
  readonly kind = 'expected_messages';

  evaluate(context: EvaluationContext): EvaluationScore {
    const { candidateTrace, evalCase } = context;
    const expectedSegments = evalCase.expected_segments;

    // Extract tool_calls from expected_messages (assistant messages only)
    const expectedToolCalls = this.extractExpectedToolCalls(expectedSegments);

    if (expectedToolCalls.length === 0) {
      // No tool_calls to validate - pass by default
      return {
        score: 1,
        verdict: 'pass',
        hits: ['No tool_calls specified in expected_messages'],
        misses: [],
        expectedAspectCount: 1,
      };
    }

    // Handle missing trace
    if (!candidateTrace || candidateTrace.length === 0) {
      return {
        score: 0,
        verdict: 'fail',
        hits: [],
        misses: ['No trace available to validate tool_calls'],
        expectedAspectCount: expectedToolCalls.length,
      };
    }

    // Extract actual tool_call events from trace
    const actualToolCalls = candidateTrace.filter((e) => e.type === 'tool_call');

    // Validate sequentially
    return this.validateToolCalls(expectedToolCalls, actualToolCalls);
  }

  private extractExpectedToolCalls(
    segments: readonly JsonObject[] | undefined,
  ): readonly { tool: string; input?: unknown }[] {
    if (!segments) {
      return [];
    }

    const toolCalls: { tool: string; input?: unknown }[] = [];
    for (const segment of segments) {
      const role = segment.role;
      const segmentToolCalls = segment.tool_calls;
      if (role === 'assistant' && Array.isArray(segmentToolCalls)) {
        for (const tc of segmentToolCalls) {
          if (
            typeof tc === 'object' &&
            tc !== null &&
            typeof (tc as { tool?: unknown }).tool === 'string'
          ) {
            const toolCall = tc as { tool: string; input?: unknown };
            toolCalls.push({ tool: toolCall.tool, input: toolCall.input });
          }
        }
      }
    }
    return toolCalls;
  }

  private validateToolCalls(
    expected: readonly { tool: string; input?: unknown }[],
    actual: readonly TraceEvent[],
  ): EvaluationScore {
    const hits: string[] = [];
    const misses: string[] = [];

    for (let i = 0; i < expected.length; i++) {
      const expectedCall = expected[i];
      const actualCall = actual[i];

      if (!actualCall) {
        misses.push(
          `tool_calls[${i}]: expected ${expectedCall.tool}, but no more tool calls in trace`,
        );
        continue;
      }

      // Check tool name
      if (actualCall.name !== expectedCall.tool) {
        misses.push(
          `tool_calls[${i}]: expected ${expectedCall.tool}, got ${actualCall.name ?? 'unknown'}`,
        );
        continue;
      }

      // Check input if specified
      if (expectedCall.input !== undefined) {
        if (!this.deepEquals(expectedCall.input, actualCall.input)) {
          misses.push(`tool_calls[${i}]: ${expectedCall.tool} input mismatch`);
          continue;
        }
      }

      hits.push(`tool_calls[${i}]: ${expectedCall.tool} matched`);
    }

    const totalChecks = expected.length || 1;
    const score = hits.length / totalChecks;

    return {
      score,
      verdict: score >= 0.8 ? 'pass' : score >= 0.6 ? 'borderline' : 'fail',
      hits,
      misses,
      expectedAspectCount: totalChecks,
    };
  }

  private deepEquals(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (typeof a !== 'object' || a === null || b === null) return false;

    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((val, i) => this.deepEquals(val, b[i]));
    }

    if (Array.isArray(a) || Array.isArray(b)) return false;

    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);

    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => this.deepEquals(aObj[key], bObj[key]));
  }
}

// Composite Evaluator

export interface EvaluatorFactory {
  create(config: EvaluatorConfig, context: EvaluationContext): Evaluator;
}

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
  readonly config: import('./types.js').CompositeEvaluatorConfig;
  readonly evaluatorFactory: EvaluatorFactory;
  readonly cwd?: string;
}

export class CompositeEvaluator implements Evaluator {
  readonly kind = 'composite';

  private readonly config: import('./types.js').CompositeEvaluatorConfig;
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
    config: Extract<import('./types.js').CompositeAggregatorConfig, { type: 'llm_judge' }>,
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

      const data = freeformEvaluationSchema.parse(parseJsonFromText(response.text ?? ''));
      const score = clampScore(data.score);
      const hits = Array.isArray(data.hits) ? data.hits.filter(isNonEmptyString).slice(0, 4) : [];
      const misses = Array.isArray(data.misses)
        ? data.misses.filter(isNonEmptyString).slice(0, 4)
        : [];
      const reasoning = data.reasoning ?? response.reasoning;

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
