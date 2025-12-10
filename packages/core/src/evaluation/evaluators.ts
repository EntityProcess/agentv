import type { ResolvedTarget } from "./providers/targets.js";
import type { Provider, ProviderResponse, ChatPrompt } from "./providers/types.js";
import { TEMPLATE_VARIABLES } from "./template-variables.js";
import type { EvaluatorConfig, JsonObject, EvalCase } from "./types.js";

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

export class LlmJudgeEvaluator implements Evaluator {
  readonly kind = "llm_judge";

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
      throw new Error("No judge provider available for LLM grading");
    }

    return this.evaluateWithPrompt(context, judgeProvider);
  }

  private async evaluateWithPrompt(
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
      [TEMPLATE_VARIABLES.EXPECTED_MESSAGES]: JSON.stringify(context.evalCase.expected_segments, null, 2),
      [TEMPLATE_VARIABLES.CANDIDATE_ANSWER]: context.candidate.trim(),
      [TEMPLATE_VARIABLES.REFERENCE_ANSWER]: (context.evalCase.reference_answer ?? "").trim(),
      [TEMPLATE_VARIABLES.EXPECTED_OUTCOME]: context.evalCase.expected_outcome.trim(),
      [TEMPLATE_VARIABLES.QUESTION]: formattedQuestion.trim(),
    };
    
    // Build system prompt (only the mandatory output schema)
    const systemPrompt = buildOutputSchema();
    
    // Build user prompt based on custom template or default template
    const evaluatorTemplate = context.evaluatorTemplateOverride ?? this.evaluatorTemplate ?? DEFAULT_EVALUATOR_TEMPLATE;
    const userPrompt = substituteVariables(evaluatorTemplate, variables);

    const response = await judgeProvider.invoke({
      question: userPrompt,
      systemPrompt,
      evalCaseId: context.evalCase.id,
      attempt: context.attempt,
      maxOutputTokens: this.maxOutputTokens,
      temperature: this.temperature,
    });

    const parsed = parseQualityResponse(response);
    const score = clampScore(parsed.score ?? 0);
    const hits = Array.isArray(parsed.hits)
      ? parsed.hits.filter(isNonEmptyString).slice(0, 4)
      : [];
    const misses = Array.isArray(parsed.misses)
      ? parsed.misses.filter(isNonEmptyString).slice(0, 4)
      : [];
    const reasoning = parsed.reasoning ?? response.reasoning;
    const expectedAspectCount = Math.max(hits.length + misses.length, 1);

    const evaluatorRawRequest: JsonObject = {
      userPrompt,
      systemPrompt,
      target: judgeProvider.targetName,
    };

    return {
      score,
      hits,
      misses,
      expectedAspectCount,
      reasoning,
      evaluatorRawRequest,
    };
  }
}

/**
 * Build the mandatory output schema that all evaluators must follow.
 * This schema is always appended to the evaluator template.
 */
function buildOutputSchema(): string {
  return [
    "You must respond with a single JSON object matching this schema:",
    "",
    "{",
    '  "score": <number between 0.0 and 1.0>,',
    '  "hits": [<array of strings, max 4 items, brief specific achievements>],',
    '  "misses": [<array of strings, max 4 items, brief specific failures or omissions, empty if none>],',
    '  "reasoning": "<string, concise explanation for the score, 1-2 sentences max>"',
    "}",
  ].join("\n");
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

function parseQualityResponse(response: ProviderResponse): {
  readonly score?: number;
  readonly hits?: unknown;
  readonly misses?: unknown;
  readonly reasoning?: string;
} {
  const text = typeof response.text === "string" ? response.text.trim() : "";
  if (text.length === 0) {
    return {};
  }

  // Try parsing JSON directly
  const direct = attemptParseJson(text);
  if (direct && validateQualityJson(direct)) {
    return direct;
  }

  // Try extracting JSON from markdown code blocks or surrounding text
  const extracted = extractJsonBlob(text);
  if (extracted) {
    const parsed = attemptParseJson(extracted);
    if (parsed && validateQualityJson(parsed)) {
      return parsed;
    }
  }

  return {};
}

function attemptParseJson(text: string):
  | {
      readonly score?: number;
      readonly hits?: unknown;
      readonly misses?: unknown;
      readonly reasoning?: string;
    }
  | undefined {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const score = typeof parsed.score === "number" ? parsed.score : undefined;
    const hits = parsed.hits;
    const misses = parsed.misses;
    const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning : undefined;
    return { score, hits, misses, reasoning };
  } catch {
    return undefined;
  }
}

function validateQualityJson(parsed: {
  readonly score?: number;
  readonly hits?: unknown;
  readonly misses?: unknown;
  readonly reasoning?: string;
}): boolean {
  // Validate score is present and in valid range [0.0, 1.0]
  if (typeof parsed.score !== "number") {
    return false;
  }
  if (Number.isNaN(parsed.score) || !Number.isFinite(parsed.score)) {
    return false;
  }
  if (parsed.score < 0 || parsed.score > 1) {
    return false;
  }

  // Validate hits is an array of strings (max 4 will be enforced during extraction)
  if (parsed.hits !== undefined) {
    if (!Array.isArray(parsed.hits)) {
      return false;
    }
    if (!parsed.hits.every((item) => typeof item === "string")) {
      return false;
    }
  }

  // Validate misses is an array of strings (max 4 will be enforced during extraction)
  if (parsed.misses !== undefined) {
    if (!Array.isArray(parsed.misses)) {
      return false;
    }
    if (!parsed.misses.every((item) => typeof item === "string")) {
      return false;
    }
  }

  // Validate reasoning is a string if present
  if (parsed.reasoning !== undefined && typeof parsed.reasoning !== "string") {
    return false;
  }

  return true;
}

function extractJsonBlob(text: string): string | undefined {
  const match = text.match(/\{[\s\S]*\}/);
  return match?.[0];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// Code Evaluator

export interface CodeEvaluatorOptions {
  readonly script: string;
  readonly cwd?: string;
  readonly agentTimeoutMs?: number;
}

export class CodeEvaluator implements Evaluator {
  readonly kind = "code";

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
      const score = clampScore(typeof parsed?.score === "number" ? parsed.score : 0);
      const hits = Array.isArray(parsed?.hits) ? parsed.hits.filter(isNonEmptyString) : [];
      const misses = Array.isArray(parsed?.misses) ? parsed.misses.filter(isNonEmptyString) : [];
      const reasoning = typeof parsed?.reasoning === "string" ? parsed.reasoning : undefined;

      return {
        score,
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

// Helper functions for CodeEvaluator

async function executeScript(
  scriptPath: string,
  input: string,
  agentTimeoutMs?: number,
  cwd?: string,
): Promise<string> {
  const { spawn } = await import("node:child_process");
  
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(scriptPath, {
      shell: true,
      cwd,
    });

    let stdout = "";
    let stderr = "";

    const timeout = agentTimeoutMs
      ? setTimeout(() => {
          child.kill();
          reject(new Error(`Code evaluator timed out after ${agentTimeoutMs}ms`));
        }, agentTimeoutMs)
      : undefined;

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });
    child.on("error", (error) => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      reject(error);
    });
    child.on("exit", (code) => {
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
  return template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (match, varName) => {
    return variables[varName] ?? match;
  });
}
