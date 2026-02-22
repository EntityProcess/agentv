import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { execFileWithStdin, execShellWithStdin } from '../../runtime/exec.js';
import {
  DEFAULT_MAX_CALLS,
  type TargetProxyUsageMetadata,
  createTargetProxy,
} from '../../runtime/target-proxy.js';
import { toSnakeCaseDeep } from '../case-conversion.js';
import type { JsonObject, TargetAccessConfig } from '../types.js';
import { clampScore, isNonEmptyString, parseJsonSafe, scoreToVerdict } from './scoring.js';
import type { EvaluationContext, EvaluationScore, Evaluator } from './types.js';

/** Threshold in bytes above which output is written to a temp file instead of inlined. */
const FILE_BACKED_OUTPUT_THRESHOLD = 50_000;

export interface CodeEvaluatorOptions {
  readonly script: readonly string[];
  readonly cwd?: string;
  readonly agentTimeoutMs?: number;
  /** Pass-through configuration from YAML (any unrecognized properties) */
  readonly config?: Record<string, unknown>;
  /** Target access config - when present, enables target invocation for the script */
  readonly target?: TargetAccessConfig;
}

export class CodeEvaluator implements Evaluator {
  readonly kind = 'code';

  private readonly script: readonly string[];
  private readonly cwd?: string;
  private readonly agentTimeoutMs?: number;
  private readonly config?: Record<string, unknown>;
  private readonly target?: TargetAccessConfig;

  constructor(options: CodeEvaluatorOptions) {
    this.script = options.script;
    this.cwd = options.cwd;
    this.agentTimeoutMs = options.agentTimeoutMs;
    this.config = options.config;
    this.target = options.target;
  }

  async evaluate(context: EvaluationContext): Promise<EvaluationScore> {
    // Determine whether to use file-backed output for large payloads
    let outputForPayload = context.output ?? null;
    let outputPath: string | undefined;

    if (outputForPayload) {
      const serialized = JSON.stringify(outputForPayload);
      if (serialized.length > FILE_BACKED_OUTPUT_THRESHOLD) {
        const tmpDir = await mkdtemp(join(tmpdir(), 'agentv-judge-'));
        outputPath = join(tmpDir, 'output.json');
        await writeFile(outputPath, serialized);
        outputForPayload = null;
      }
    }

    // Build payload (camelCase internally, converted to snake_case for judges)
    const payload = {
      question: context.evalCase.question,
      criteria: context.evalCase.criteria,
      expectedOutput: context.evalCase.expected_output,
      referenceAnswer: context.evalCase.reference_answer,
      answer: context.candidate,
      output: outputForPayload,
      outputPath,
      guidelineFiles: context.evalCase.guideline_paths,
      inputFiles: context.evalCase.file_paths.filter(
        (path) => !context.evalCase.guideline_paths.includes(path),
      ),
      input: context.evalCase.input,
      trace: context.trace ?? null,
      fileChanges: context.fileChanges ?? null,
      workspacePath: context.workspacePath ?? null,
      config: this.config ?? null,
    };

    const inputPayload = JSON.stringify(toSnakeCaseDeep(payload), null, 2);

    // Set up target proxy if configured and judge provider is available
    let proxyEnv: Record<string, string> | undefined;
    let proxyShutdown: (() => Promise<void>) | undefined;
    let getProxyUsage: (() => TargetProxyUsageMetadata) | undefined;

    if (this.target !== undefined && context.judgeProvider) {
      const maxCalls = this.target.max_calls ?? DEFAULT_MAX_CALLS;
      const proxy = await createTargetProxy({
        defaultProvider: context.judgeProvider,
        targetResolver: context.targetResolver,
        availableTargets: context.availableTargets,
        maxCalls,
      });
      proxyEnv = {
        AGENTV_TARGET_PROXY_URL: proxy.url,
        AGENTV_TARGET_PROXY_TOKEN: proxy.token,
      };
      proxyShutdown = proxy.shutdown;
      getProxyUsage = proxy.getUsageMetadata;
    }

    // Build workspace env if workspace path is available
    const workspaceEnv = context.workspacePath
      ? { AGENTV_WORKSPACE_PATH: context.workspacePath }
      : undefined;

    // Merge proxy and workspace env vars
    const env = proxyEnv || workspaceEnv ? { ...proxyEnv, ...workspaceEnv } : undefined;

    try {
      const stdout = await executeScript(
        this.script,
        inputPayload,
        this.agentTimeoutMs,
        this.cwd,
        env,
      );
      const parsed = parseJsonSafe(stdout);
      const score = clampScore(typeof parsed?.score === 'number' ? parsed.score : 0);
      const hits = Array.isArray(parsed?.hits) ? parsed.hits.filter(isNonEmptyString) : [];
      const misses = Array.isArray(parsed?.misses) ? parsed.misses.filter(isNonEmptyString) : [];
      const reasoning = typeof parsed?.reasoning === 'string' ? parsed.reasoning : undefined;
      // Capture optional structured details from code judge output
      const details =
        parsed?.details && typeof parsed.details === 'object' && !Array.isArray(parsed.details)
          ? (parsed.details as JsonObject)
          : undefined;

      // Build evaluator raw request with proxy metadata if used
      const proxyUsage = getProxyUsage?.();
      const evaluatorRawRequest: JsonObject = {
        script: this.script,
        ...(this.cwd ? { cwd: this.cwd } : {}),
        ...(proxyUsage
          ? {
              target_proxy: {
                call_count: proxyUsage.callCount,
                max_calls: proxyUsage.maxCalls,
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
        ...(details ? { details } : {}),
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
                target_proxy: {
                  call_count: proxyUsage.callCount,
                  max_calls: proxyUsage.maxCalls,
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
      // Clean up temp file for file-backed output
      if (outputPath) {
        await rm(dirname(outputPath), { recursive: true, force: true }).catch(() => {});
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
