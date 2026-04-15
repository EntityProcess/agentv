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
import { type ContentImage, isContentArray } from '../content.js';
import type { AssertionEntry, JsonObject, TargetAccessConfig } from '../types.js';
import { getRepoCheckoutTargets } from '../workspace/repo-checkout.js';
import { clampScore, isNonEmptyString, parseJsonSafe, scoreToVerdict } from './scoring.js';
import type { EvaluationContext, EvaluationScore, Grader } from './types.js';

/** Threshold in bytes above which output is written to a temp file instead of inlined. */
const FILE_BACKED_OUTPUT_THRESHOLD = 50_000;

/** Regex matching `data:<mediaType>;base64,<data>` URIs. */
const DATA_URI_RE = /^data:([^;]+);base64,(.+)$/s;

/**
 * Convert ContentImage blocks in message arrays for code grader consumption.
 *
 * - Data URI images (`data:image/png;base64,...`) → decoded, written to temp file, replaced with file path.
 * - Non-URI images (already a path or URL) → `source` carried through as `path`.
 * - ContentText, ContentFile blocks → passed through unchanged.
 * - Messages with plain string content → passed through unchanged.
 *
 * Returns the original array when no image blocks exist (zero-copy fast path).
 */
export async function materializeContentForGrader(
  messages: readonly Record<string, unknown>[] | null | undefined,
  getWorkDir: () => Promise<string>,
): Promise<readonly Record<string, unknown>[] | null> {
  if (!messages || messages.length === 0) return messages ?? null;

  // Fast path: skip if no image blocks exist
  let hasAnyImage = false;
  for (const msg of messages) {
    if (isContentArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'image') {
          hasAnyImage = true;
          break;
        }
      }
    }
    if (hasAnyImage) break;
  }
  if (!hasAnyImage) return messages;

  let counter = 0;
  const result: Record<string, unknown>[] = [];

  for (const msg of messages) {
    if (!isContentArray(msg.content)) {
      result.push(msg);
      continue;
    }

    if (!msg.content.some((b) => b.type === 'image')) {
      result.push(msg);
      continue;
    }

    const blocks: Record<string, unknown>[] = [];
    for (const block of msg.content) {
      if (block.type !== 'image') {
        blocks.push({ ...block });
        continue;
      }

      const img = block as ContentImage;
      const match = DATA_URI_RE.exec(img.source);

      if (match) {
        const [, mediaType, base64Data] = match;
        const ext = mediaType.split('/')[1] === 'jpeg' ? 'jpg' : (mediaType.split('/')[1] ?? 'bin');
        const dir = await getWorkDir();
        const filePath = join(dir, `img-${counter++}.${ext}`);
        await writeFile(filePath, Buffer.from(base64Data, 'base64'));
        blocks.push({ type: 'image', media_type: img.media_type, path: filePath });
      } else {
        // Already a path or URL → carry through as path
        blocks.push({ type: 'image', media_type: img.media_type, path: img.source });
      }
    }

    result.push({ ...msg, content: blocks });
  }

  return result;
}

export interface CodeGraderOptions {
  readonly command: readonly string[];
  /** @deprecated Use `command` instead */
  readonly script?: readonly string[];
  readonly cwd?: string;
  readonly agentTimeoutMs?: number;
  /** Pass-through configuration from YAML (any unrecognized properties) */
  readonly config?: Record<string, unknown>;
  /** Target access config - when present, enables target invocation */
  readonly target?: TargetAccessConfig;
}

export class CodeGrader implements Grader {
  readonly kind = 'code-grader';

  private readonly command: readonly string[];
  private readonly cwd?: string;
  private readonly agentTimeoutMs?: number;
  private readonly config?: Record<string, unknown>;
  private readonly target?: TargetAccessConfig;

  constructor(options: CodeGraderOptions) {
    this.command = options.command ?? options.script ?? [];
    this.cwd = options.cwd;
    this.agentTimeoutMs = options.agentTimeoutMs;
    this.config = options.config;
    this.target = options.target;
  }

  async evaluate(context: EvaluationContext): Promise<EvaluationScore> {
    // Lazy temp dir for materialized image files
    let imageTmpDir: string | undefined;
    const getImageDir = async () => {
      if (!imageTmpDir) {
        imageTmpDir = await mkdtemp(join(tmpdir(), 'agentv-img-'));
      }
      return imageTmpDir;
    };

    // Materialize multimodal content (data URIs → temp files, source → path)
    const materializedOutput = await materializeContentForGrader(
      context.output as readonly Record<string, unknown>[] | undefined,
      getImageDir,
    );

    // Determine whether to use file-backed output for large payloads
    let outputForPayload: readonly Record<string, unknown>[] | null = materializedOutput;
    let outputPath: string | undefined;

    if (outputForPayload) {
      const serialized = JSON.stringify(outputForPayload);
      if (serialized.length > FILE_BACKED_OUTPUT_THRESHOLD) {
        const tmpDir = await mkdtemp(join(tmpdir(), 'agentv-grader-'));
        outputPath = join(tmpDir, 'output.json');
        await writeFile(outputPath, serialized);
        outputForPayload = null;
      }
    }

    // Build payload (camelCase internally, converted to snake_case for graders)
    const payload = {
      criteria: context.evalCase.criteria,
      expectedOutput: await materializeContentForGrader(
        context.evalCase.expected_output as readonly Record<string, unknown>[],
        getImageDir,
      ),
      output: outputForPayload,
      outputPath,
      inputFiles: context.evalCase.file_paths,
      input: await materializeContentForGrader(
        context.evalCase.input as readonly Record<string, unknown>[],
        getImageDir,
      ),
      trace: context.trace ?? null,
      tokenUsage: context.tokenUsage ?? null,
      costUsd: context.costUsd ?? null,
      durationMs: context.durationMs ?? null,
      startTime: context.startTime ?? null,
      endTime: context.endTime ?? null,
      fileChanges: context.fileChanges ?? null,
      workspacePath: context.workspacePath ?? null,
      config: this.config ?? null,
    };

    const inputPayload = JSON.stringify(toSnakeCaseDeep(payload), null, 2);

    // Set up target proxy if configured and grader provider is available
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
      let stdout: string;
      if (context.dockerConfig) {
        // Docker execution mode: run grader inside a container
        const { DockerWorkspaceProvider } = await import('../workspace/docker-workspace.js');
        const dockerProvider = new DockerWorkspaceProvider(context.dockerConfig);
        const result = await dockerProvider.runGraderInContainer({
          command: [...this.command],
          stdin: inputPayload,
          repoCheckouts: getRepoCheckoutTargets(context.evalCase.workspace?.repos),
        });
        if (result.exitCode !== 0) {
          const trimmedErr = result.stderr.trim();
          throw new Error(
            trimmedErr.length > 0
              ? `Code evaluator exited with code ${result.exitCode}: ${trimmedErr}`
              : `Code evaluator exited with code ${result.exitCode}`,
          );
        }
        stdout = result.stdout.trim();
      } else {
        stdout = await executeScript(
          this.command,
          inputPayload,
          this.agentTimeoutMs,
          this.cwd,
          env,
        );
      }
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
      // Capture optional structured details from code judge output
      const details =
        parsed?.details && typeof parsed.details === 'object' && !Array.isArray(parsed.details)
          ? (parsed.details as JsonObject)
          : undefined;

      // Build evaluator raw request with proxy metadata if used
      const proxyUsage = getProxyUsage?.();
      const graderRawRequest: JsonObject = {
        command: this.command,
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
        assertions,
        expectedAspectCount: assertions.length || 1,
        graderRawRequest,
        ...(details ? { details } : {}),
        tokenUsage: proxyUsage?.tokenUsage,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const proxyUsage = getProxyUsage?.();
      return {
        score: 0,
        verdict: 'fail',
        assertions: [{ text: `Code evaluator failed: ${message}`, passed: false }],
        expectedAspectCount: 1,
        graderRawRequest: {
          command: this.command,
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
        tokenUsage: proxyUsage?.tokenUsage,
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
      // Clean up temp dir for materialized images
      if (imageTmpDir) {
        await rm(imageTmpDir, { recursive: true, force: true }).catch(() => {});
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
