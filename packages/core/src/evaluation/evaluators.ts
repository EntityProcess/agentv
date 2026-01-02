import { generateText } from 'ai';
import { z } from 'zod';

import { execShellWithStdin } from '../runtime/exec.js';
import { toSnakeCaseDeep } from './case-conversion.js';
import type { ResolvedTarget } from './providers/targets.js';
import {
  type ChatPrompt,
  type OutputMessage,
  type Provider,
  type ProviderResponse,
  extractLastAssistantContent,
} from './providers/types.js';
import { TEMPLATE_VARIABLES } from './template-variables.js';
import type {
  ToolTrajectoryEvaluatorConfig,
  ToolTrajectoryExpectedItem,
  TraceSummary,
} from './trace.js';
import type {
  CostEvaluatorConfig,
  EvalCase,
  EvaluationVerdict,
  EvaluatorConfig,
  FieldAccuracyEvaluatorConfig,
  FieldConfig,
  JsonObject,
  LatencyEvaluatorConfig,
  RubricItem,
  TokenUsageEvaluatorConfig,
} from './types.js';

export type { EvaluationVerdict };

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
  /** Output messages from agent execution (primary source for tool trajectory) */
  readonly outputMessages?: readonly OutputMessage[];
  /** Lightweight summary of trace events (if available) */
  readonly traceSummary?: TraceSummary;
}

export interface EvaluationScore {
  readonly score: number;
  readonly verdict: EvaluationVerdict;
  readonly hits: readonly string[];
  readonly misses: readonly string[];
  readonly expectedAspectCount: number;
  readonly reasoning?: string;
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
        context.evalCase.expected_messages,
        null,
        2,
      ),
      [TEMPLATE_VARIABLES.OUTPUT_MESSAGES]: JSON.stringify(context.outputMessages ?? [], null, 2),
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
  /** Pass-through configuration from YAML (any unrecognized properties) */
  readonly config?: Record<string, unknown>;
}

export class CodeEvaluator implements Evaluator {
  readonly kind = 'code';

  private readonly script: string;
  private readonly cwd?: string;
  private readonly agentTimeoutMs?: number;
  private readonly config?: Record<string, unknown>;

  constructor(options: CodeEvaluatorOptions) {
    this.script = options.script;
    this.cwd = options.cwd;
    this.agentTimeoutMs = options.agentTimeoutMs;
    this.config = options.config;
  }

  async evaluate(context: EvaluationContext): Promise<EvaluationScore> {
    // Build payload object with snake_case keys
    const payload = {
      question: context.evalCase.question,
      expected_outcome: context.evalCase.expected_outcome,
      expected_messages: context.evalCase.expected_messages,
      reference_answer: context.evalCase.reference_answer,
      candidate_answer: context.candidate,
      output_messages: context.outputMessages ?? null,
      guideline_files: context.evalCase.guideline_paths,
      input_files: context.evalCase.file_paths.filter(
        (path) => !context.evalCase.guideline_paths.includes(path),
      ),
      input_messages: context.evalCase.input_messages,
      trace_summary: context.traceSummary ?? null,
      // Pass-through config from YAML (any unrecognized properties)
      config: this.config ?? null,
    };

    // Recursively convert all nested objects to snake_case for Python compatibility
    const inputPayload = JSON.stringify(toSnakeCaseDeep(payload), null, 2);

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
  const { stdout, stderr, exitCode } = await execShellWithStdin(scriptPath, input, {
    cwd,
    timeoutMs: agentTimeoutMs,
  });

  if (exitCode !== 0) {
    const trimmedErr = stderr.trim();
    throw new Error(
      trimmedErr.length > 0
        ? `Code evaluator exited with code ${exitCode}: ${trimmedErr}`
        : `Code evaluator exited with code ${exitCode}`,
    );
  }

  return stdout.trim();
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

/** Extracted tool call with optional arguments */
interface ExtractedToolCall {
  readonly name: string;
  readonly args?: Record<string, unknown>;
}

/**
 * Deep equality check for two values.
 * Handles primitives, arrays, and plain objects.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return a === b;

  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((val, i) => deepEqual(val, b[i]));
  }

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => Object.hasOwn(bObj, key) && deepEqual(aObj[key], bObj[key]));
}

/**
 * Check if actual args match expected args.
 * - 'any' → always matches
 * - object → partial match (only specified keys, deep equality)
 */
function argsMatch(
  expected: ToolTrajectoryExpectedItem['args'],
  actual: Record<string, unknown> | undefined,
): boolean {
  // No args constraint means match
  if (expected === undefined) return true;
  // 'any' means skip validation
  if (expected === 'any') return true;
  // Partial match: check only specified keys
  if (actual === undefined) return false;
  for (const key of Object.keys(expected)) {
    if (!Object.hasOwn(actual, key)) return false;
    if (!deepEqual(expected[key], actual[key])) return false;
  }
  return true;
}

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
    const { outputMessages, traceSummary } = context;

    // Extract tool calls from outputMessages (primary source)
    const toolCalls = this.extractToolCallsFromMessages(outputMessages);

    // Handle missing tool calls
    if (toolCalls.length === 0 && !traceSummary) {
      return {
        score: 0,
        verdict: 'fail',
        hits: [],
        misses: ['No trace available for evaluation'],
        expectedAspectCount: 1,
      };
    }

    // Build summary from tool calls if available, otherwise use provided summary
    const summary = toolCalls.length > 0 ? this.buildSummary(toolCalls) : traceSummary;

    if (!summary) {
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
        return this.evaluateAnyOrder(summary);
      case 'in_order':
        return this.evaluateInOrder(toolCalls);
      case 'exact':
        return this.evaluateExact(toolCalls);
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

  /**
   * Extract tool calls from output messages.
   */
  private extractToolCallsFromMessages(
    messages: readonly OutputMessage[] | undefined,
  ): readonly ExtractedToolCall[] {
    if (!messages) {
      return [];
    }

    const toolCalls: ExtractedToolCall[] = [];
    for (const message of messages) {
      if (message.toolCalls) {
        for (const call of message.toolCalls) {
          toolCalls.push({
            name: call.tool,
            args: call.input as Record<string, unknown> | undefined,
          });
        }
      }
    }
    return toolCalls;
  }

  /**
   * Build a summary from extracted tool calls.
   */
  private buildSummary(toolCalls: readonly ExtractedToolCall[]): TraceSummary {
    const toolCallsByName: Record<string, number> = {};
    for (const call of toolCalls) {
      toolCallsByName[call.name] = (toolCallsByName[call.name] ?? 0) + 1;
    }
    const toolNames = Object.keys(toolCallsByName).sort();
    return {
      eventCount: toolCalls.length,
      toolNames,
      toolCallsByName,
      errorCount: 0,
    };
  }

  private evaluateAnyOrder(summary: TraceSummary): EvaluationScore {
    const minimums = this.config.minimums ?? {};
    const toolNames = Object.keys(minimums);

    if (toolNames.length === 0) {
      return {
        score: 1,
        verdict: 'pass',
        hits: ['No tool requirements specified'],
        misses: [],
        expectedAspectCount: 0,
      };
    }

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

    const score = hits.length / toolNames.length;

    return {
      score,
      verdict: scoreToVerdict(score),
      hits,
      misses,
      expectedAspectCount: toolNames.length,
    };
  }

  private evaluateInOrder(toolCalls: readonly ExtractedToolCall[]): EvaluationScore {
    const expected = this.config.expected ?? [];

    if (expected.length === 0) {
      return {
        score: 1,
        verdict: 'pass',
        hits: ['No tool sequence specified'],
        misses: [],
        expectedAspectCount: 0,
      };
    }

    const hits: string[] = [];
    const misses: string[] = [];
    let actualIndex = 0;

    for (let i = 0; i < expected.length; i++) {
      const expectedItem = expected[i];
      const expectedTool = expectedItem.tool;
      let found = false;
      let argsMismatch = false;

      while (actualIndex < toolCalls.length) {
        const actualCall = toolCalls[actualIndex];
        if (actualCall.name === expectedTool) {
          // Tool name matches, check args if specified
          if (argsMatch(expectedItem.args, actualCall.args)) {
            hits.push(`Found ${expectedTool} at position ${actualIndex}`);
            actualIndex++;
            found = true;
            break;
          }
          // Tool name matches but args don't - this is a miss for this expected item
          misses.push(
            `Expected ${expectedTool} at position ${i}: tool found at ${actualIndex} but args mismatch`,
          );
          actualIndex++;
          argsMismatch = true;
          break;
        }
        actualIndex++;
      }

      if (!found && !argsMismatch) {
        misses.push(`Expected ${expectedTool} at position ${i}, not found in remaining trace`);
      }
    }

    const score = hits.length / expected.length;

    return {
      score,
      verdict: scoreToVerdict(score),
      hits,
      misses,
      expectedAspectCount: expected.length,
    };
  }

  private evaluateExact(toolCalls: readonly ExtractedToolCall[]): EvaluationScore {
    const expected = this.config.expected ?? [];

    if (expected.length === 0) {
      return {
        score: 1,
        verdict: 'pass',
        hits: ['No tool sequence specified'],
        misses: [],
        expectedAspectCount: 0,
      };
    }

    const hits: string[] = [];
    const misses: string[] = [];

    if (toolCalls.length !== expected.length) {
      misses.push(`Expected ${expected.length} tool calls, got ${toolCalls.length}`);
    }

    const checkLength = Math.min(expected.length, toolCalls.length);
    for (let i = 0; i < checkLength; i++) {
      const expectedItem = expected[i];
      const expectedTool = expectedItem.tool;
      const actualCall = toolCalls[i];
      const actualTool = actualCall.name;
      if (actualTool === expectedTool) {
        // Tool name matches, check args if specified
        if (argsMatch(expectedItem.args, actualCall.args)) {
          hits.push(`Position ${i}: ${expectedTool}`);
        } else {
          misses.push(`Position ${i}: ${expectedTool} args mismatch`);
        }
      } else {
        misses.push(`Position ${i}: expected ${expectedTool}, got ${actualTool}`);
      }
    }

    for (let i = checkLength; i < expected.length; i++) {
      misses.push(`Position ${i}: expected ${expected[i].tool}, got nothing`);
    }

    const score = hits.length / expected.length;

    return {
      score,
      verdict: scoreToVerdict(score),
      hits,
      misses,
      expectedAspectCount: expected.length,
    };
  }
}

// Field Accuracy Evaluator

export interface FieldAccuracyEvaluatorOptions {
  readonly config: FieldAccuracyEvaluatorConfig;
}

/** Result from evaluating a single field */
interface FieldResult {
  readonly path: string;
  readonly score: number;
  readonly weight: number;
  readonly hit: boolean;
  readonly message: string;
}

/**
 * Default date formats to try when parsing dates.
 * Ordered from most specific to least specific.
 */
const DEFAULT_DATE_FORMATS = [
  'YYYY-MM-DDTHH:mm:ssZ', // ISO with timezone
  'YYYY-MM-DDTHH:mm:ss', // ISO with time
  'YYYY-MM-DD', // ISO date
  'DD-MMM-YYYY', // Localized (e.g., "15-JAN-2025")
  'MM/DD/YYYY', // US format
  'DD/MM/YYYY', // EU format
  'MM-DD-YYYY', // US with dashes
  'DD-MM-YYYY', // EU with dashes
];

/**
 * Month name mappings for parsing localized dates.
 */
const MONTH_NAMES: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

/**
 * FieldAccuracyEvaluator compares extracted structured data against expected values
 * with configurable matching strategies (exact, fuzzy, numeric_tolerance, date).
 */
export class FieldAccuracyEvaluator implements Evaluator {
  readonly kind = 'field_accuracy';

  private readonly config: FieldAccuracyEvaluatorConfig;

  constructor(options: FieldAccuracyEvaluatorOptions) {
    this.config = options.config;
  }

  evaluate(context: EvaluationContext): EvaluationScore {
    const { evalCase, candidate } = context;

    // Parse candidate answer as JSON
    let candidateData: Record<string, unknown>;
    try {
      candidateData = parseJsonFromTextSafe(candidate);
    } catch {
      return {
        score: 0,
        verdict: 'fail',
        hits: [],
        misses: ['Failed to parse candidate answer as JSON'],
        expectedAspectCount: this.config.fields.length,
        reasoning: 'Candidate answer is not valid JSON',
      };
    }

    // Extract expected data from expected_messages
    const expectedData = this.extractExpectedData(evalCase.expected_messages);
    if (!expectedData) {
      return {
        score: 0,
        verdict: 'fail',
        hits: [],
        misses: ['No expected data found in expected_messages'],
        expectedAspectCount: this.config.fields.length,
        reasoning: 'Could not extract expected data from expected_messages',
      };
    }

    // Evaluate each field
    const fieldResults: FieldResult[] = [];
    for (const fieldConfig of this.config.fields) {
      const result = this.evaluateField(fieldConfig, candidateData, expectedData);
      fieldResults.push(result);
    }

    // Aggregate results
    return this.aggregateResults(fieldResults);
  }

  /**
   * Extract expected data from expected_messages array.
   * Looks for the last assistant message with content.
   */
  private extractExpectedData(
    expectedMessages: readonly JsonObject[],
  ): Record<string, unknown> | undefined {
    // Find the last assistant message with content
    for (let i = expectedMessages.length - 1; i >= 0; i--) {
      const message = expectedMessages[i];
      if (message.role === 'assistant' && message.content) {
        if (typeof message.content === 'object' && message.content !== null) {
          return message.content as Record<string, unknown>;
        }
        // If content is a string, try to parse it as JSON
        if (typeof message.content === 'string') {
          try {
            return parseJsonFromTextSafe(message.content);
          } catch {
            // Parsing failed, continue to next message
          }
        }
      }
    }
    return undefined;
  }

  /**
   * Evaluate a single field against the expected value.
   */
  private evaluateField(
    fieldConfig: FieldConfig,
    candidateData: Record<string, unknown>,
    expectedData: Record<string, unknown>,
  ): FieldResult {
    const { path, match, required = true, weight = 1.0 } = fieldConfig;

    const candidateValue = resolvePath(candidateData, path);
    const expectedValue = resolvePath(expectedData, path);

    // Handle missing expected value
    if (expectedValue === undefined) {
      // If the expected value is missing, we can't compare
      return {
        path,
        score: 1.0, // No expected value means no comparison needed
        weight,
        hit: true,
        message: `${path}: no expected value`,
      };
    }

    // Handle missing candidate value
    if (candidateValue === undefined) {
      if (required) {
        return {
          path,
          score: 0,
          weight,
          hit: false,
          message: `${path} (required, missing)`,
        };
      }
      // Optional field missing - don't count in aggregation
      return {
        path,
        score: 1.0, // Don't penalize missing optional fields
        weight: 0, // Zero weight means it won't affect the score
        hit: true,
        message: `${path}: optional field missing`,
      };
    }

    // Compare based on match type
    switch (match) {
      case 'exact':
        return this.compareExact(path, candidateValue, expectedValue, weight);
      case 'numeric_tolerance':
        return this.compareNumericTolerance(
          path,
          candidateValue,
          expectedValue,
          fieldConfig,
          weight,
        );
      case 'date':
        return this.compareDate(path, candidateValue, expectedValue, fieldConfig, weight);
      default:
        return {
          path,
          score: 0,
          weight,
          hit: false,
          message: `${path}: unknown match type "${match}"`,
        };
    }
  }

  /**
   * Exact equality comparison.
   */
  private compareExact(
    path: string,
    candidateValue: unknown,
    expectedValue: unknown,
    weight: number,
  ): FieldResult {
    // Deep equality for objects and arrays
    if (deepEqual(candidateValue, expectedValue)) {
      return {
        path,
        score: 1.0,
        weight,
        hit: true,
        message: path,
      };
    }

    // Type mismatch
    if (typeof candidateValue !== typeof expectedValue) {
      return {
        path,
        score: 0,
        weight,
        hit: false,
        message: `${path} (type mismatch: got ${typeof candidateValue}, expected ${typeof expectedValue})`,
      };
    }

    return {
      path,
      score: 0,
      weight,
      hit: false,
      message: `${path} (value mismatch)`,
    };
  }

  /**
   * Numeric comparison with absolute or relative tolerance.
   */
  private compareNumericTolerance(
    path: string,
    candidateValue: unknown,
    expectedValue: unknown,
    fieldConfig: FieldConfig,
    weight: number,
  ): FieldResult {
    const { tolerance = 0, relative = false } = fieldConfig;

    const candidateNum = toNumber(candidateValue);
    const expectedNum = toNumber(expectedValue);

    if (candidateNum === null || expectedNum === null) {
      return {
        path,
        score: 0,
        weight,
        hit: false,
        message: `${path} (non-numeric value)`,
      };
    }

    if (!Number.isFinite(candidateNum) || !Number.isFinite(expectedNum)) {
      return {
        path,
        score: 0,
        weight,
        hit: false,
        message: `${path} (invalid numeric value)`,
      };
    }

    const diff = Math.abs(candidateNum - expectedNum);
    let withinTolerance: boolean;

    if (relative) {
      // Relative tolerance: |actual - expected| / |expected| <= tolerance
      // Handle division by zero for expected === 0
      const relativeDiff = expectedNum === 0 ? diff : diff / Math.abs(expectedNum);
      withinTolerance = relativeDiff <= tolerance;
    } else {
      // Absolute tolerance: |actual - expected| <= tolerance
      withinTolerance = diff <= tolerance;
    }

    if (withinTolerance) {
      return {
        path,
        score: 1.0,
        weight,
        hit: true,
        message: `${path} (within tolerance: diff=${diff.toFixed(2)})`,
      };
    }

    return {
      path,
      score: 0,
      weight,
      hit: false,
      message: `${path} (outside tolerance: diff=${diff.toFixed(2)}, tolerance=${tolerance})`,
    };
  }

  /**
   * Date comparison with format normalization.
   */
  private compareDate(
    path: string,
    candidateValue: unknown,
    expectedValue: unknown,
    fieldConfig: FieldConfig,
    weight: number,
  ): FieldResult {
    const formats = fieldConfig.formats ?? DEFAULT_DATE_FORMATS;

    const candidateDate = parseDate(String(candidateValue), formats);
    const expectedDate = parseDate(String(expectedValue), formats);

    if (candidateDate === null) {
      return {
        path,
        score: 0,
        weight,
        hit: false,
        message: `${path} (unparseable candidate date)`,
      };
    }

    if (expectedDate === null) {
      return {
        path,
        score: 0,
        weight,
        hit: false,
        message: `${path} (unparseable expected date)`,
      };
    }

    // Compare dates by year, month, and day (ignore time component)
    if (
      candidateDate.getFullYear() === expectedDate.getFullYear() &&
      candidateDate.getMonth() === expectedDate.getMonth() &&
      candidateDate.getDate() === expectedDate.getDate()
    ) {
      return {
        path,
        score: 1.0,
        weight,
        hit: true,
        message: path,
      };
    }

    return {
      path,
      score: 0,
      weight,
      hit: false,
      message: `${path} (date mismatch: got ${formatDateISO(candidateDate)}, expected ${formatDateISO(expectedDate)})`,
    };
  }

  /**
   * Aggregate field results using configured strategy.
   */
  private aggregateResults(results: readonly FieldResult[]): EvaluationScore {
    const aggregation = this.config.aggregation ?? 'weighted_average';
    const hits: string[] = [];
    const misses: string[] = [];

    for (const result of results) {
      if (result.hit) {
        hits.push(result.message);
      } else {
        misses.push(result.message);
      }
    }

    let score: number;
    if (aggregation === 'all_or_nothing') {
      // All fields must pass for score 1.0
      score = misses.length === 0 ? 1.0 : 0.0;
    } else {
      // weighted_average (default)
      const totalWeight = results.reduce((sum, r) => sum + r.weight, 0);
      if (totalWeight === 0) {
        score = results.length === 0 ? 1.0 : 0.0;
      } else {
        const weightedSum = results.reduce((sum, r) => sum + r.score * r.weight, 0);
        score = weightedSum / totalWeight;
      }
    }

    const reasoning = `${hits.length}/${results.length} fields matched`;

    return {
      score: clampScore(score),
      verdict: scoreToVerdict(score),
      hits: hits.slice(0, 4),
      misses: misses.slice(0, 4),
      expectedAspectCount: results.length,
      reasoning,
    };
  }
}

/**
 * Resolve a dot-notation path (with array indexing) to a value.
 * Example: "invoice.line_items[0].amount"
 */
function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  if (!path || !obj) {
    return undefined;
  }

  // Split on dots and array brackets
  const parts = path.split(/\.|\[|\]/).filter((p) => p.length > 0);
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }

    if (typeof current !== 'object') {
      return undefined;
    }

    const isIndex = /^\d+$/.test(part);
    if (isIndex && Array.isArray(current)) {
      current = current[Number.parseInt(part, 10)];
    } else {
      current = (current as Record<string, unknown>)[part];
    }
  }

  return current;
}

/**
 * Convert a value to a number, returning null if not possible.
 */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const num = Number.parseFloat(value);
    return Number.isNaN(num) ? null : num;
  }
  return null;
}

/**
 * Parse a date string using the specified formats.
 * Returns null if parsing fails.
 *
 * Date format disambiguation:
 * - If only US formats (MM/DD/YYYY) are specified, parses as US
 * - If only EU formats (DD/MM/YYYY) are specified, parses as EU
 * - If both or neither are specified, attempts to infer from values:
 *   - If first number > 12, assumes EU format (day first)
 *   - If second number > 12, assumes US format (month first)
 *   - If ambiguous (both <= 12), defaults to US format (MM/DD/YYYY)
 */
function parseDate(dateStr: string, formats: readonly string[]): Date | null {
  if (!dateStr) return null;

  const trimmed = dateStr.trim();

  // Try ISO format first (JavaScript native)
  const isoDate = new Date(trimmed);
  if (!Number.isNaN(isoDate.getTime())) {
    return isoDate;
  }

  // Try localized format (DD-MMM-YYYY)
  const localizedMatch = trimmed.match(/^(\d{1,2})-([A-Za-z]{3,9})-(\d{4})$/);
  if (localizedMatch) {
    const day = Number.parseInt(localizedMatch[1], 10);
    const monthName = localizedMatch[2].toLowerCase();
    const year = Number.parseInt(localizedMatch[3], 10);
    const month = MONTH_NAMES[monthName];
    if (month !== undefined) {
      return new Date(year, month, day);
    }
  }

  // Try US format (MM/DD/YYYY or MM-DD-YYYY)
  const usMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (usMatch) {
    // Check if first or second number is likely the month
    // Assume MM/DD/YYYY for formats array containing "MM/DD/YYYY" or "MM-DD-YYYY"
    const hasUSFormat = formats.some((f) => f.includes('MM/DD') || f.includes('MM-DD'));
    const hasEUFormat = formats.some((f) => f.includes('DD/MM') || f.includes('DD-MM'));

    if (hasUSFormat && !hasEUFormat) {
      const month = Number.parseInt(usMatch[1], 10) - 1;
      const day = Number.parseInt(usMatch[2], 10);
      const year = Number.parseInt(usMatch[3], 10);
      if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
        return new Date(year, month, day);
      }
    } else if (hasEUFormat && !hasUSFormat) {
      const day = Number.parseInt(usMatch[1], 10);
      const month = Number.parseInt(usMatch[2], 10) - 1;
      const year = Number.parseInt(usMatch[3], 10);
      if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
        return new Date(year, month, day);
      }
    } else {
      // Ambiguous - try to infer from values
      const num1 = Number.parseInt(usMatch[1], 10);
      const num2 = Number.parseInt(usMatch[2], 10);
      const year = Number.parseInt(usMatch[3], 10);

      // If first number > 12, it must be day (EU format)
      if (num1 > 12 && num2 <= 12) {
        return new Date(year, num2 - 1, num1);
      }
      // If second number > 12, it must be day (US format)
      if (num2 > 12 && num1 <= 12) {
        return new Date(year, num1 - 1, num2);
      }
      // Default to US format
      if (num1 <= 12 && num2 <= 31) {
        return new Date(year, num1 - 1, num2);
      }
    }
  }

  return null;
}

/**
 * Format a date as ISO date string (YYYY-MM-DD).
 */
function formatDateISO(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Safely parse JSON from text, handling code blocks.
 */
function parseJsonFromTextSafe(text: string): Record<string, unknown> {
  const cleaned = typeof text === 'string' ? text.replace(/```json\n?|```/g, '').trim() : '';
  const match = cleaned.match(/\{[\s\S]*\}/);
  const blob = match?.[0] ?? cleaned;
  return JSON.parse(blob) as Record<string, unknown>;
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

// ----------------------------------------------------------------------------
// Latency Evaluator
// ----------------------------------------------------------------------------

export interface LatencyEvaluatorOptions {
  readonly config: LatencyEvaluatorConfig;
}

/**
 * Evaluator that checks execution duration against a threshold.
 * Uses traceSummary.durationMs from the evaluation context.
 */
export class LatencyEvaluator implements Evaluator {
  readonly kind = 'latency';

  private readonly config: LatencyEvaluatorConfig;

  constructor(options: LatencyEvaluatorOptions) {
    this.config = options.config;
  }

  evaluate(context: EvaluationContext): EvaluationScore {
    const { threshold } = this.config;
    const durationMs = context.traceSummary?.durationMs;

    // If no duration data available, we can't evaluate
    if (durationMs === undefined) {
      return {
        score: 0,
        verdict: 'fail',
        hits: [],
        misses: ['No duration data available in trace'],
        expectedAspectCount: 1,
        reasoning: 'Execution duration not reported by provider',
        evaluatorRawRequest: {
          type: 'latency',
          threshold,
          durationMs: null,
        },
      };
    }

    const passed = durationMs <= threshold;
    const score = passed ? 1 : 0;

    return {
      score,
      verdict: passed ? 'pass' : 'fail',
      hits: passed ? [`Duration ${durationMs}ms <= ${threshold}ms threshold`] : [],
      misses: passed ? [] : [`Duration ${durationMs}ms > ${threshold}ms threshold`],
      expectedAspectCount: 1,
      reasoning: `Execution took ${durationMs}ms (threshold: ${threshold}ms)`,
      evaluatorRawRequest: {
        type: 'latency',
        threshold,
        durationMs,
      },
    };
  }
}

// ----------------------------------------------------------------------------
// Cost Evaluator
// ----------------------------------------------------------------------------

export interface CostEvaluatorOptions {
  readonly config: CostEvaluatorConfig;
}

/**
 * Evaluator that checks execution cost against a budget.
 * Uses traceSummary.costUsd from the evaluation context.
 */
export class CostEvaluator implements Evaluator {
  readonly kind = 'cost';

  private readonly config: CostEvaluatorConfig;

  constructor(options: CostEvaluatorOptions) {
    this.config = options.config;
  }

  evaluate(context: EvaluationContext): EvaluationScore {
    const { budget } = this.config;
    const costUsd = context.traceSummary?.costUsd;

    // If no cost data available, we can't evaluate
    if (costUsd === undefined) {
      return {
        score: 0,
        verdict: 'fail',
        hits: [],
        misses: ['No cost data available in trace'],
        expectedAspectCount: 1,
        reasoning: 'Execution cost not reported by provider',
        evaluatorRawRequest: {
          type: 'cost',
          budget,
          costUsd: null,
        },
      };
    }

    const passed = costUsd <= budget;
    const score = passed ? 1 : 0;

    // Format cost for display
    const formatCost = (n: number) => `$${n.toFixed(4)}`;

    return {
      score,
      verdict: passed ? 'pass' : 'fail',
      hits: passed ? [`Cost ${formatCost(costUsd)} <= ${formatCost(budget)} budget`] : [],
      misses: passed ? [] : [`Cost ${formatCost(costUsd)} > ${formatCost(budget)} budget`],
      expectedAspectCount: 1,
      reasoning: `Execution cost ${formatCost(costUsd)} (budget: ${formatCost(budget)})`,
      evaluatorRawRequest: {
        type: 'cost',
        budget,
        costUsd,
      },
    };
  }
}

// ----------------------------------------------------------------------------
// Token Usage Evaluator
// ----------------------------------------------------------------------------

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
