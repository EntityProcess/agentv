import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { execFileWithStdin, execShellWithStdin } from '../../runtime/exec.js';
import {
  DEFAULT_MAX_CALLS,
  type TargetProxyUsageMetadata,
  createTargetProxy,
} from '../../runtime/target-proxy.js';
import { serializeSnakeCaseBoundaryPayload } from '../case-conversion.js';
import { type ContentImage, isContentArray } from '../content.js';
import type {
  AssertionEntry,
  GraderCheckResult,
  JsonObject,
  TargetAccessConfig,
} from '../types.js';
import { getRepoCheckoutTargets } from '../workspace/repo-checkout.js';
import { clampScore, isNonEmptyString, parseJsonSafe, scoreToVerdict } from './scoring.js';
import type { EvaluationContext, EvaluationScore, Grader } from './types.js';

/** Threshold in bytes above which output is written to a temp file instead of inlined. */
const FILE_BACKED_OUTPUT_THRESHOLD = 50_000;

/** Regex matching `data:<mediaType>;base64,<data>` URIs. */
const DATA_URI_RE = /^data:([^;]+);base64,(.+)$/s;

interface ScriptProtocolResult {
  readonly pass: boolean;
  readonly score: number;
  readonly reason?: string;
  readonly checks: readonly GraderCheckResult[];
  readonly details?: JsonObject;
}

interface ScriptProtocolCheckRecord extends Record<string, unknown> {
  readonly text: string;
  readonly pass: boolean;
  readonly reason: string;
}

/**
 * Convert ContentImage blocks in message arrays for script grader consumption.
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

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function optionalScore(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' ? clampScore(value) : undefined;
}

function parseScriptChecks(value: unknown): readonly GraderCheckResult[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((check): check is ScriptProtocolCheckRecord => {
      if (typeof check !== 'object' || check === null || Array.isArray(check)) {
        return false;
      }
      const record = check as Record<string, unknown>;
      return (
        typeof record.text === 'string' &&
        typeof record.pass === 'boolean' &&
        typeof record.reason === 'string'
      );
    })
    .map((check) => ({
      ...(typeof check.id === 'string' ? { id: check.id } : {}),
      text: check.text,
      pass: check.pass,
      ...(typeof check.score === 'number' ? { score: clampScore(check.score) } : {}),
      reason: check.reason,
      ...(typeof check.evidence === 'string' ? { evidence: check.evidence } : {}),
    }));
}

function checksToAssertions(checks: readonly GraderCheckResult[]): AssertionEntry[] {
  return checks.map((check) => ({
    text: check.text,
    passed: check.pass,
    ...(check.evidence !== undefined ? { evidence: check.evidence } : {}),
  }));
}

function normalizeScriptProtocol(parsed: Record<string, unknown>): ScriptProtocolResult {
  const checks = parseScriptChecks(parsed.checks);
  const score =
    optionalScore(parsed, 'score') ??
    (checks.length > 0
      ? checks.reduce((sum, check) => sum + (check.score ?? (check.pass ? 1 : 0)), 0) /
        checks.length
      : typeof parsed.pass === 'boolean'
        ? parsed.pass
          ? 1
          : 0
        : 0);
  const pass = typeof parsed.pass === 'boolean' ? parsed.pass : scoreToVerdict(score) === 'pass';
  const reason = optionalString(parsed, 'reason');
  const details =
    parsed.details && typeof parsed.details === 'object' && !Array.isArray(parsed.details)
      ? (parsed.details as JsonObject)
      : undefined;

  if (typeof parsed.pass !== 'boolean' && typeof parsed.score !== 'number' && checks.length === 0) {
    throw new Error('Script evaluator JSON must include pass, score, or checks[]');
  }

  return { pass, score, reason, checks, details };
}

export interface ScriptGraderOptions {
  readonly command: readonly string[];
  readonly cwd?: string;
  readonly agentTimeoutMs?: number;
  /** Pass-through configuration from YAML (any unrecognized properties) */
  readonly config?: Record<string, unknown>;
  /** Target access config - when present, enables target invocation */
  readonly target?: TargetAccessConfig;
}

export class ScriptGrader implements Grader {
  readonly kind = 'script';

  private readonly command: readonly string[];
  private readonly cwd?: string;
  private readonly agentTimeoutMs?: number;
  private readonly config?: Record<string, unknown>;
  private readonly target?: TargetAccessConfig;

  constructor(options: ScriptGraderOptions) {
    this.command = options.command;
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

    const transcriptMessages = context.trace?.messages ?? context.output ?? [];

    // Materialize transcript multimodal content (data URIs → temp files, source → path)
    const materializedMessages = await materializeContentForGrader(
      transcriptMessages as unknown as readonly Record<string, unknown>[] | undefined,
      getImageDir,
    );

    // Determine whether to use file-backed output for large final answers
    let outputForPayload: string | null = context.candidate;
    let outputPath: string | undefined;

    if (outputForPayload !== null) {
      const serialized = JSON.stringify(outputForPayload);
      if (serialized.length > FILE_BACKED_OUTPUT_THRESHOLD) {
        const tmpDir = await mkdtemp(join(tmpdir(), 'agentv-grader-'));
        outputPath = join(tmpDir, 'output.json');
        await writeFile(outputPath, serialized);
        outputForPayload = null;
      }
    }

    const traceForPayload = context.trace
      ? {
          ...context.trace,
          messages: materializedMessages ?? context.trace.messages,
        }
      : null;

    // Build payload (camelCase internally, converted to snake_case for graders)
    const payload = {
      criteria: context.evalCase.criteria,
      expectedOutput: await materializeContentForGrader(
        context.evalCase.expected_output as readonly Record<string, unknown>[],
        getImageDir,
      ),
      output: outputForPayload,
      messages: materializedMessages ?? [],
      outputPath,
      inputFiles: context.evalCase.file_paths,
      input: await materializeContentForGrader(
        context.evalCase.input as readonly Record<string, unknown>[],
        getImageDir,
      ),
      metadata: context.evalCase.metadata ?? null,
      trace: traceForPayload,
      traceSummary: context.trace
        ? {
            eventCount: context.trace.eventCount,
            toolCalls: context.trace.toolCalls,
            errorCount: context.trace.errorCount,
            toolDurations: context.trace.toolDurations,
            llmCallCount: context.trace.llmCallCount,
          }
        : null,
      tokenUsage: context.tokenUsage ?? null,
      costUsd: context.costUsd ?? null,
      durationMs: context.durationMs ?? null,
      startTime: context.startTime ?? null,
      endTime: context.endTime ?? null,
      fileChanges: context.fileChanges ?? null,
      workspacePath: context.workspacePath ?? null,
      config: this.config ?? null,
    };

    const inputPayload = JSON.stringify(serializeSnakeCaseBoundaryPayload(payload), null, 2);

    // Set up target proxy if configured and grader provider is available
    let proxyEnv: Record<string, string> | undefined;
    let proxyShutdown: (() => Promise<void>) | undefined;
    let getProxyUsage: (() => TargetProxyUsageMetadata) | undefined;

    if (this.target !== undefined && context.graderProvider) {
      const maxCalls = this.target.max_calls ?? DEFAULT_MAX_CALLS;
      const proxy = await createTargetProxy({
        defaultProvider: context.graderProvider,
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
      let exitCode = 0;
      let execStderr = '';
      if (context.dockerConfig) {
        // Docker execution mode: run grader inside a container
        const { DockerWorkspaceProvider } = await import('../workspace/docker-workspace.js');
        const dockerProvider = new DockerWorkspaceProvider(context.dockerConfig);
        const result = await dockerProvider.runGraderInContainer({
          command: [...this.command],
          stdin: inputPayload,
          repoCheckouts: getRepoCheckoutTargets(context.evalCase.workspace?.repos),
        });
        exitCode = result.exitCode;
        stdout = result.stdout.trim();
        execStderr = result.stderr;
      } else {
        const result = await runScriptRaw(
          this.command,
          inputPayload,
          this.agentTimeoutMs,
          this.cwd,
          env,
        );
        exitCode = result.exitCode;
        stdout = result.stdout.trim();
        execStderr = result.stderr;
      }
      // Non-zero exit with JSON stdout, or with stderr output, is treated as an error
      // (script signaled failure through the protocol or wrote an error message).
      // Non-zero exit with plain stdout and no stderr uses the exit-code convention —
      // score 0 (fail), stdout becomes the assertion text.
      const looksLikeJson = stdout.startsWith('{') || stdout.startsWith('[');
      const hasStderr = execStderr.trim().length > 0;
      if (exitCode !== 0 && (looksLikeJson || hasStderr)) {
        const trimmedErr = formatStderr(execStderr);
        throw new Error(
          trimmedErr.length > 0
            ? `Script evaluator exited with code ${exitCode}: ${trimmedErr}`
            : `Script evaluator exited with code ${exitCode}`,
        );
      }
      const rawParsed = parseJsonSafe(stdout);
      // Only treat stdout as the JSON protocol if it parsed as a plain object.
      // Bare JSON scalars (numbers, booleans, strings) fall through to the plain-text path.
      const parsed =
        rawParsed != null && typeof rawParsed === 'object' && !Array.isArray(rawParsed)
          ? rawParsed
          : undefined;
      // Plain-text fallback: exit code is pass/fail, stdout is the check text.
      // For numeric scores or multi-aspect results, use the JSON protocol instead.
      const passed = exitCode === 0;
      const protocol = parsed != null ? normalizeScriptProtocol(parsed) : undefined;
      const checks = protocol?.checks ?? [];
      const assertions: AssertionEntry[] =
        protocol != null
          ? checksToAssertions(checks)
          : [{ text: stdout.trim() || (passed ? 'exit 0' : `exit ${exitCode}`), passed }];
      const score = protocol?.score ?? (passed ? 1 : 0);
      const verdict = protocol ? (protocol.pass ? 'pass' : 'fail') : scoreToVerdict(score);
      const reason = protocol?.reason;
      const details = protocol?.details;

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
        verdict,
        reason,
        checks,
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
        reason: `Script evaluator failed: ${message}`,
        checks: [
          {
            text: 'Script evaluator execution',
            pass: false,
            score: 0,
            reason: message,
          },
        ],
        assertions: [{ text: `Script evaluator failed: ${message}`, passed: false }],
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

/** Run a script and return raw stdout/stderr/exitCode without throwing. */
async function runScriptRaw(
  scriptPath: readonly string[] | string,
  input: string,
  agentTimeoutMs?: number,
  cwd?: string,
  env?: Record<string, string>,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return typeof scriptPath === 'string'
    ? execShellWithStdin(scriptPath, input, { cwd, timeoutMs: agentTimeoutMs, env })
    : execFileWithStdin(scriptPath, input, { cwd, timeoutMs: agentTimeoutMs, env });
}

export async function executeScript(
  scriptPath: readonly string[] | string,
  input: string,
  agentTimeoutMs?: number,
  cwd?: string,
  env?: Record<string, string>,
): Promise<string> {
  const { stdout, stderr, exitCode } = await runScriptRaw(
    scriptPath,
    input,
    agentTimeoutMs,
    cwd,
    env,
  );

  if (exitCode !== 0) {
    const trimmedErr = formatStderr(stderr);
    throw new Error(
      trimmedErr.length > 0
        ? `Script evaluator exited with code ${exitCode}: ${trimmedErr}`
        : `Script evaluator exited with code ${exitCode}`,
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
