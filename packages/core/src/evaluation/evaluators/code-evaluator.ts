import { execFileWithStdin, execShellWithStdin } from '../../runtime/exec.js';
import {
  DEFAULT_MAX_CALLS,
  type JudgeProxyUsageMetadata,
  createJudgeProxy,
} from '../../runtime/judge-proxy.js';
import { toSnakeCaseDeep } from '../case-conversion.js';
import type { CodeJudgeConfig, JsonObject } from '../types.js';
import { clampScore, isNonEmptyString, parseJsonSafe, scoreToVerdict } from './scoring.js';
import type { EvaluationContext, EvaluationScore, Evaluator } from './types.js';

export interface CodeEvaluatorOptions {
  readonly script: readonly string[];
  readonly cwd?: string;
  readonly agentTimeoutMs?: number;
  /** Pass-through configuration from YAML (any unrecognized properties) */
  readonly config?: Record<string, unknown>;
  /** Judge proxy config - when present, enables judge access for the script */
  readonly judge?: CodeJudgeConfig;
}

export class CodeEvaluator implements Evaluator {
  readonly kind = 'code';

  private readonly script: readonly string[];
  private readonly cwd?: string;
  private readonly agentTimeoutMs?: number;
  private readonly config?: Record<string, unknown>;
  private readonly judge?: CodeJudgeConfig;

  constructor(options: CodeEvaluatorOptions) {
    this.script = options.script;
    this.cwd = options.cwd;
    this.agentTimeoutMs = options.agentTimeoutMs;
    this.config = options.config;
    this.judge = options.judge;
  }

  async evaluate(context: EvaluationContext): Promise<EvaluationScore> {
    // Build payload (camelCase internally, converted to snake_case for judges)
    const payload = {
      question: context.evalCase.question,
      expectedOutcome: context.evalCase.expected_outcome,
      expectedMessages: context.evalCase.expected_messages,
      referenceAnswer: context.evalCase.reference_answer,
      candidateAnswer: context.candidate,
      outputMessages: context.outputMessages ?? null,
      guidelineFiles: context.evalCase.guideline_paths,
      inputFiles: context.evalCase.file_paths.filter(
        (path) => !context.evalCase.guideline_paths.includes(path),
      ),
      inputMessages: context.evalCase.input_messages,
      traceSummary: context.traceSummary ?? null,
      config: this.config ?? null,
    };

    const inputPayload = JSON.stringify(toSnakeCaseDeep(payload), null, 2);

    // Set up judge proxy if configured and judge provider is available
    let proxyEnv: Record<string, string> | undefined;
    let proxyShutdown: (() => Promise<void>) | undefined;
    let getProxyUsage: (() => JudgeProxyUsageMetadata) | undefined;

    if (this.judge !== undefined && context.judgeProvider) {
      const maxCalls = this.judge.max_calls ?? DEFAULT_MAX_CALLS;
      const proxy = await createJudgeProxy({
        judgeProvider: context.judgeProvider,
        maxCalls,
      });
      proxyEnv = {
        AGENTV_JUDGE_PROXY_URL: proxy.url,
        AGENTV_JUDGE_PROXY_TOKEN: proxy.token,
      };
      proxyShutdown = proxy.shutdown;
      getProxyUsage = proxy.getUsageMetadata;
    }

    try {
      const stdout = await executeScript(
        this.script,
        inputPayload,
        this.agentTimeoutMs,
        this.cwd,
        proxyEnv,
      );
      const parsed = parseJsonSafe(stdout);
      const score = clampScore(typeof parsed?.score === 'number' ? parsed.score : 0);
      const hits = Array.isArray(parsed?.hits) ? parsed.hits.filter(isNonEmptyString) : [];
      const misses = Array.isArray(parsed?.misses) ? parsed.misses.filter(isNonEmptyString) : [];
      const reasoning = typeof parsed?.reasoning === 'string' ? parsed.reasoning : undefined;

      // Build evaluator raw request with proxy metadata if used
      const proxyUsage = getProxyUsage?.();
      const evaluatorRawRequest: JsonObject = {
        script: this.script,
        ...(this.cwd ? { cwd: this.cwd } : {}),
        ...(proxyUsage
          ? {
              judgeProxy: {
                targetName: proxyUsage.targetName,
                callCount: proxyUsage.callCount,
                maxCalls: proxyUsage.maxCalls,
              },
            }
          : {}),
      };

      return {
        score,
        verdict: scoreToVerdict(score),
        hits,
        misses,
        expectedAspectCount: hits.length + misses.length || 1,
        reasoning,
        evaluatorRawRequest,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const proxyUsage = getProxyUsage?.();
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
          ...(proxyUsage
            ? {
                judgeProxy: {
                  targetName: proxyUsage.targetName,
                  callCount: proxyUsage.callCount,
                  maxCalls: proxyUsage.maxCalls,
                },
              }
            : {}),
          error: message,
        },
      };
    } finally {
      // Always shut down the proxy when done
      if (proxyShutdown) {
        await proxyShutdown();
      }
    }
  }
}

export async function executeScript(
  scriptPath: readonly string[] | string,
  input: string,
  agentTimeoutMs?: number,
  cwd?: string,
  env?: Record<string, string>,
): Promise<string> {
  const { stdout, stderr, exitCode } =
    typeof scriptPath === 'string'
      ? await execShellWithStdin(scriptPath, input, { cwd, timeoutMs: agentTimeoutMs, env })
      : await execFileWithStdin(scriptPath, input, { cwd, timeoutMs: agentTimeoutMs, env });

  if (exitCode !== 0) {
    const trimmedErr = formatStderr(stderr);
    throw new Error(
      trimmedErr.length > 0
        ? `Code evaluator exited with code ${exitCode}: ${trimmedErr}`
        : `Code evaluator exited with code ${exitCode}`,
    );
  }

  return stdout.trim();
}

function formatStderr(stderr: string): string {
  const trimmed = stderr.trim();
  const maxLength = 2000;
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  const tail = trimmed.slice(-maxLength);
  return `...(truncated, last ${maxLength} chars)\n${tail}`;
}
