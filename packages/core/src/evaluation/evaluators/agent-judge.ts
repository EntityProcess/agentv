import fs from 'node:fs/promises';
import path from 'node:path';

import { generateText, stepCountIs, tool } from 'ai';
import { z } from 'zod';

import { extractLastAssistantContent } from '../providers/types.js';
import type { Provider } from '../providers/types.js';
import { TEMPLATE_VARIABLES } from '../template-variables.js';
import type { JsonObject, RubricItem } from '../types.js';
import {
  buildOutputSchema,
  buildRubricOutputSchema,
  calculateRubricScore,
  freeformEvaluationSchema,
  rubricEvaluationSchema,
  substituteVariables,
} from './llm-judge.js';
import { clampScore, isNonEmptyString, parseJsonFromText, scoreToVerdict } from './scoring.js';
import type { EvaluationContext, EvaluationScore, Evaluator } from './types.js';

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

export interface AgentJudgeEvaluatorOptions {
  readonly resolveJudgeProvider: (ctx: EvaluationContext) => Promise<Provider | undefined>;
  readonly maxSteps?: number;
  readonly temperature?: number;
  readonly evaluatorTemplate?: string;
  readonly judgeTargetProvider?: Provider;
}

export class AgentJudgeEvaluator implements Evaluator {
  readonly kind = 'agent_judge';

  private readonly resolveJudgeProvider: (ctx: EvaluationContext) => Promise<Provider | undefined>;
  private readonly maxSteps: number;
  private readonly temperature: number;
  private readonly evaluatorTemplate?: string;
  private readonly judgeTargetProvider?: Provider;

  constructor(options: AgentJudgeEvaluatorOptions) {
    this.resolveJudgeProvider = options.resolveJudgeProvider;
    this.maxSteps = Math.min(options.maxSteps ?? DEFAULT_MAX_STEPS, MAX_STEPS_LIMIT);
    this.temperature = options.temperature ?? 0;
    this.evaluatorTemplate = options.evaluatorTemplate;
    this.judgeTargetProvider = options.judgeTargetProvider;
  }

  async evaluate(context: EvaluationContext): Promise<EvaluationScore> {
    if (this.judgeTargetProvider) {
      return this.evaluateWithJudgeTarget(context);
    }
    return this.evaluateBuiltIn(context);
  }

  /**
   * Built-in mode: Uses Vercel AI SDK generateText() with sandboxed filesystem tools.
   */
  private async evaluateBuiltIn(context: EvaluationContext): Promise<EvaluationScore> {
    const judgeProvider = await this.resolveJudgeProvider(context);
    if (!judgeProvider) {
      throw new Error('No judge provider available for agent_judge evaluation');
    }

    const model = judgeProvider.asLanguageModel?.();
    if (!model) {
      throw new Error(
        `Judge provider '${judgeProvider.targetName}' does not support asLanguageModel() — required for built-in agent_judge mode`,
      );
    }

    const workspacePath = context.workspacePath;
    if (!workspacePath) {
      throw new Error(
        'agent_judge evaluator requires a workspace_template target (workspacePath is not set)',
      );
    }

    const systemPrompt = this.buildSystemPrompt(context);
    const userPrompt = this.buildUserPrompt(context);

    const config = context.evaluator;
    const rubrics = config?.type === 'agent_judge' ? config.rubrics : undefined;

    const fsTools = createFilesystemTools(workspacePath);

    const evaluatorRawRequest: JsonObject = {
      mode: 'built-in',
      systemPrompt,
      userPrompt,
      target: judgeProvider.targetName,
      maxSteps: this.maxSteps,
    };

    try {
      const { text, steps } = await generateText({
        model,
        system: systemPrompt,
        prompt: userPrompt,
        tools: fsTools,
        stopWhen: stepCountIs(this.maxSteps),
        temperature: this.temperature,
      });

      const toolCallCount = steps.reduce((count, step) => count + (step.toolCalls?.length ?? 0), 0);

      const details: JsonObject = {
        mode: 'built-in',
        steps: steps.length,
        tool_calls: toolCallCount,
      };

      return this.parseResult(text, rubrics, evaluatorRawRequest, details);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        score: 0,
        verdict: 'fail',
        hits: [],
        misses: [`agent_judge built-in evaluation failed: ${message}`],
        expectedAspectCount: 1,
        evaluatorRawRequest,
        details: { mode: 'built-in', error: message },
      };
    }
  }

  /**
   * Judge target mode: Delegates to an external agent provider via Provider.invoke().
   */
  private async evaluateWithJudgeTarget(context: EvaluationContext): Promise<EvaluationScore> {
    const provider = this.judgeTargetProvider as Provider;

    const workspacePath = context.workspacePath;
    const prompt = this.buildDelegatedPrompt(context);

    const evaluatorRawRequest: JsonObject = {
      mode: 'judge_target',
      judge_target: provider.targetName,
      prompt,
    };

    try {
      const response = await provider.invoke({
        question: prompt,
        cwd: workspacePath,
        evalCaseId: context.evalCase.id,
        attempt: context.attempt,
      });

      const assistantContent = extractLastAssistantContent(response.outputMessages);
      if (!assistantContent) {
        return {
          score: 0,
          verdict: 'fail',
          hits: [],
          misses: ['agent_judge judge_target returned no assistant response'],
          expectedAspectCount: 1,
          evaluatorRawRequest,
          details: { mode: 'judge_target', judge_target: provider.targetName },
        };
      }

      const config = context.evaluator;
      const rubrics = config?.type === 'agent_judge' ? config.rubrics : undefined;

      const details: JsonObject = {
        mode: 'judge_target',
        judge_target: provider.targetName,
      };

      return this.parseResult(assistantContent, rubrics, evaluatorRawRequest, details);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        score: 0,
        verdict: 'fail',
        hits: [],
        misses: [`agent_judge judge_target evaluation failed: ${message}`],
        expectedAspectCount: 1,
        evaluatorRawRequest,
        details: {
          mode: 'judge_target',
          judge_target: provider.targetName,
          error: message,
        },
      };
    }
  }

  /**
   * Parse the agent's response text into an EvaluationScore.
   * Supports both freeform and rubric modes.
   */
  private parseResult(
    text: string,
    rubrics: readonly RubricItem[] | undefined,
    evaluatorRawRequest: JsonObject,
    details: JsonObject,
  ): EvaluationScore {
    try {
      const parsed = parseJsonFromText(text);

      if (rubrics && rubrics.length > 0) {
        const data = rubricEvaluationSchema.parse(parsed);
        const { score, verdict, hits, misses } = calculateRubricScore(data, rubrics);
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

      const data = freeformEvaluationSchema.parse(parsed);
      const score = clampScore(data.score);
      const hits = Array.isArray(data.hits) ? data.hits.filter(isNonEmptyString).slice(0, 4) : [];
      const misses = Array.isArray(data.misses)
        ? data.misses.filter(isNonEmptyString).slice(0, 4)
        : [];

      return {
        score,
        verdict: scoreToVerdict(score),
        hits,
        misses,
        expectedAspectCount: Math.max(hits.length + misses.length, 1),
        reasoning: data.reasoning,
        evaluatorRawRequest,
        details,
      };
    } catch {
      return {
        score: 0,
        verdict: 'fail',
        hits: [],
        misses: ['Failed to parse agent_judge response as valid evaluation JSON'],
        expectedAspectCount: 1,
        evaluatorRawRequest,
        details,
      };
    }
  }

  /**
   * Build system prompt for built-in mode.
   * Includes output format instructions.
   */
  private buildSystemPrompt(context: EvaluationContext): string {
    const config = context.evaluator;
    const rubrics = config?.type === 'agent_judge' ? config.rubrics : undefined;

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
   * Build user prompt for built-in mode.
   * Uses custom template if provided, otherwise builds default prompt.
   */
  private buildUserPrompt(context: EvaluationContext): string {
    const formattedQuestion =
      context.promptInputs.question && context.promptInputs.question.trim().length > 0
        ? context.promptInputs.question
        : context.evalCase.question;

    const variables: Record<string, string> = {
      [TEMPLATE_VARIABLES.CANDIDATE_ANSWER]: context.candidate.trim(),
      [TEMPLATE_VARIABLES.REFERENCE_ANSWER]: (context.evalCase.reference_answer ?? '').trim(),
      [TEMPLATE_VARIABLES.CRITERIA]: context.evalCase.criteria.trim(),
      [TEMPLATE_VARIABLES.QUESTION]: formattedQuestion.trim(),
      [TEMPLATE_VARIABLES.FILE_CHANGES]: context.fileChanges ?? '',
    };

    if (this.evaluatorTemplate) {
      return substituteVariables(this.evaluatorTemplate, variables);
    }

    const config = context.evaluator;
    const rubrics = config?.type === 'agent_judge' ? config.rubrics : undefined;

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

    parts.push('[[ ## candidate_answer ## ]]', context.candidate, '');

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
   * Build the full evaluation prompt for judge target mode (delegation).
   * Combines task context, criteria, candidate info, and output format instructions.
   */
  private buildDelegatedPrompt(context: EvaluationContext): string {
    const formattedQuestion =
      context.promptInputs.question && context.promptInputs.question.trim().length > 0
        ? context.promptInputs.question
        : context.evalCase.question;

    const config = context.evaluator;
    const rubrics = config?.type === 'agent_judge' ? config.rubrics : undefined;

    if (this.evaluatorTemplate) {
      const variables: Record<string, string> = {
        [TEMPLATE_VARIABLES.CANDIDATE_ANSWER]: context.candidate.trim(),
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

    parts.push('[[ ## candidate_answer ## ]]', context.candidate, '');

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
}

// ---------------------------------------------------------------------------
// Sandboxed filesystem tools for built-in mode
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
          const regex = new RegExp(input.pattern, 'gi');
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
