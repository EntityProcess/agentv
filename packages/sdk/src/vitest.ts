/**
 * Vitest workspace verifier adapter.
 *
 * This module keeps deterministic workspace verification in familiar Vitest
 * tests while translating the JSON reporter output into AgentV's code-grader
 * result contract.
 */
import { spawn } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';

import { runCodeGrader } from './runtime.js';
import { type CodeGraderInput, type CodeGraderResult, CodeGraderResultSchema } from './schemas.js';

export interface VitestWorkspaceGraderOptions {
  /**
   * Vitest verifier file(s). By default these are relative to the prepared
   * workspace. When `copyTestFilesToWorkspace` is true, relative paths resolve
   * from `testFileRoot` instead.
   *
   * When provided without `command`, the adapter runs
   * `bunx vitest run <testFile> --reporter=json --outputFile <tmp>`.
   */
  readonly testFile?: string | readonly string[];
  /**
   * Copy `testFile` entries into a temporary directory inside the workspace
   * before running Vitest. Use this for hidden verifier files that live beside
   * the eval instead of inside the prepared workspace.
   */
  readonly copyTestFilesToWorkspace?: boolean;
  /**
   * Base directory for copied `testFile` entries. Defaults to `process.cwd()`.
   */
  readonly testFileRoot?: string;
  /**
   * Full command to run. Use this for package scripts such as
   * `["bun", "run", "verify:workspace"]`.
   */
  readonly command?: readonly string[];
  /**
   * Base Vitest command used with `testFile`. Defaults to
   * `["bunx", "vitest", "run"]`.
   */
  readonly vitestCommand?: readonly string[];
  /** Workspace-relative directory to run the command in. Defaults to workspace root. */
  readonly cwd?: string;
  /** Append `--reporter=json --outputFile <tmp>` to the command. Defaults to true for testFile mode. */
  readonly appendReporterArgs?: boolean;
  /** Read Vitest JSON from this path instead of stdout. Relative paths resolve under `cwd`. */
  readonly outputFile?: string;
  readonly timeoutMs?: number;
  readonly env?: Readonly<Record<string, string>>;
  readonly passWithNoTests?: boolean;
}

interface CommandResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

interface VitestAssertionResult {
  readonly ancestorTitles?: readonly string[];
  readonly fullName?: string;
  readonly title?: string;
  readonly status?: string;
  readonly failureMessages?: readonly string[];
  readonly duration?: number;
}

interface VitestFileResult {
  readonly name?: string;
  readonly assertionResults?: readonly VitestAssertionResult[];
}

interface VitestJsonReport {
  readonly success?: boolean;
  readonly numTotalTests?: number;
  readonly numPassedTests?: number;
  readonly numFailedTests?: number;
  readonly numPendingTests?: number;
  readonly numTodoTests?: number;
  readonly testResults?: readonly VitestFileResult[];
}

function workspacePathFrom(input: CodeGraderInput): string | undefined {
  const workspacePath = input.workspacePath ?? process.env.AGENTV_WORKSPACE_PATH;
  return workspacePath?.trim() ? workspacePath : undefined;
}

function truncate(value: string, maxLength = 2000): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}\n...(truncated)`;
}

function resolveInsideWorkspace(
  workspacePath: string,
  relativePath: string,
  label: string,
  options: { readonly allowRoot?: boolean } = {},
): string {
  if (!relativePath.trim()) {
    throw new Error(`${label} must not be empty.`);
  }

  if (nodePath.isAbsolute(relativePath)) {
    throw new Error(`${label} must be relative to the workspace: ${relativePath}`);
  }

  const root = nodePath.resolve(workspacePath);
  const resolvedPath = nodePath.resolve(root, relativePath);
  const relativeToRoot = nodePath.relative(root, resolvedPath);
  if (relativeToRoot === '' && options.allowRoot === true) {
    return resolvedPath;
  }

  if (
    relativeToRoot === '' ||
    relativeToRoot.startsWith('..') ||
    nodePath.isAbsolute(relativeToRoot)
  ) {
    throw new Error(`${label} must stay inside the workspace: ${relativePath}`);
  }

  return resolvedPath;
}

function normalizeTestFiles(testFile: string | readonly string[] | undefined): readonly string[] {
  if (testFile === undefined) {
    return [];
  }
  return typeof testFile === 'string' ? [testFile] : [...testFile];
}

function buildCommand(
  options: VitestWorkspaceGraderOptions,
  testFiles: readonly string[] = normalizeTestFiles(options.testFile),
) {
  if (options.command && options.command.length > 0) {
    return [...options.command];
  }

  const command = [...(options.vitestCommand ?? ['bunx', 'vitest', 'run'])];
  command.push(...testFiles);
  return command;
}

function parseJsonObjectFromText(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error('Vitest output did not contain a JSON object.');
  }
}

function isVitestJsonReport(value: unknown): value is VitestJsonReport {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as VitestJsonReport).testResults)
  );
}

function assertionText(file: VitestFileResult, assertion: VitestAssertionResult): string {
  const title =
    assertion.fullName ??
    [...(assertion.ancestorTitles ?? []), assertion.title].filter(Boolean).join(' ');
  return title || file.name || 'Vitest assertion';
}

export function vitestReportToCodeGraderResult(
  report: VitestJsonReport,
  options: Pick<VitestWorkspaceGraderOptions, 'passWithNoTests'> = {},
): CodeGraderResult {
  const assertions = (report.testResults ?? []).flatMap((file) =>
    (file.assertionResults ?? []).map((item) => {
      const passed = item.status === 'passed';
      const evidence =
        item.failureMessages && item.failureMessages.length > 0
          ? truncate(item.failureMessages.join('\n\n'))
          : undefined;
      return {
        text: assertionText(file, item),
        passed,
        ...(evidence !== undefined ? { evidence } : {}),
      };
    }),
  );

  if (assertions.length === 0) {
    const passed = options.passWithNoTests === true;
    return CodeGraderResultSchema.parse({
      score: passed ? 1 : 0,
      assertions: [{ text: 'Vitest reported no tests', passed }],
      details: {
        vitest_success: report.success ?? false,
        num_total_tests: report.numTotalTests ?? 0,
        num_passed_tests: report.numPassedTests ?? 0,
        num_failed_tests: report.numFailedTests ?? 0,
        num_pending_tests: report.numPendingTests ?? 0,
        num_todo_tests: report.numTodoTests ?? 0,
      },
    });
  }

  const passedCount = assertions.filter((item) => item.passed).length;
  return CodeGraderResultSchema.parse({
    score: passedCount / assertions.length,
    assertions,
    details: {
      vitest_success: report.success ?? passedCount === assertions.length,
      num_total_tests: report.numTotalTests ?? assertions.length,
      num_passed_tests: report.numPassedTests ?? passedCount,
      num_failed_tests: report.numFailedTests ?? assertions.length - passedCount,
      num_pending_tests: report.numPendingTests ?? 0,
      num_todo_tests: report.numTodoTests ?? 0,
    },
  });
}

function runCommand(
  command: readonly string[],
  options: {
    readonly cwd: string;
    readonly timeoutMs?: number;
    readonly env?: Readonly<Record<string, string>>;
  },
): Promise<CommandResult> {
  if (command.length === 0) {
    return Promise.reject(new Error('Vitest command must not be empty.'));
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeout =
      options.timeoutMs !== undefined
        ? setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
          }, options.timeoutMs)
        : undefined;

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (exitCode) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      if (timedOut) {
        reject(new Error(`Vitest command timed out after ${options.timeoutMs}ms.`));
        return;
      }
      resolve({ exitCode, stdout, stderr });
    });
  });
}

function resolveSourceTestFile(testFileRoot: string, testFile: string): string {
  if (!testFile.trim()) {
    throw new Error('testFile entries must not be empty.');
  }

  return nodePath.isAbsolute(testFile)
    ? nodePath.resolve(testFile)
    : nodePath.resolve(testFileRoot, testFile);
}

async function copyTestFilesIntoWorkspace(
  testFiles: readonly string[],
  options: Pick<VitestWorkspaceGraderOptions, 'testFileRoot'>,
  cwd: string,
): Promise<{ readonly testFiles: readonly string[]; readonly tempDir?: string }> {
  if (testFiles.length === 0) {
    return { testFiles };
  }

  const tempDir = await mkdtemp(nodePath.join(cwd, '.agentv-vitest-'));
  const testFileRoot = nodePath.resolve(options.testFileRoot ?? process.cwd());
  const copiedFiles = await Promise.all(
    testFiles.map(async (testFile, index) => {
      const sourcePath = resolveSourceTestFile(testFileRoot, testFile);
      const destinationPath = nodePath.join(tempDir, `${index}-${nodePath.basename(testFile)}`);
      await copyFile(sourcePath, destinationPath);
      return nodePath.relative(cwd, destinationPath);
    }),
  );
  return { testFiles: copiedFiles, tempDir };
}

async function readVitestReport(
  commandResult: CommandResult,
  outputFile: string | undefined,
): Promise<VitestJsonReport> {
  const rawReport =
    outputFile !== undefined ? await readFile(outputFile, 'utf8') : commandResult.stdout;
  const parsed = parseJsonObjectFromText(rawReport);
  if (!isVitestJsonReport(parsed)) {
    throw new Error('Vitest JSON report did not include testResults[].');
  }
  return parsed;
}

export async function runVitestWorkspaceGrader(
  options: VitestWorkspaceGraderOptions,
  input: CodeGraderInput,
): Promise<CodeGraderResult> {
  const workspacePath = workspacePathFrom(input);
  if (!workspacePath) {
    return {
      score: 0,
      assertions: [
        {
          text: 'Vitest workspace verifier requires workspace_path',
          passed: false,
          evidence: 'Configure workspace in the eval YAML so AgentV can pass workspace_path.',
        },
      ],
    };
  }

  const tempDirs: string[] = [];
  try {
    const cwd = options.cwd
      ? resolveInsideWorkspace(workspacePath, options.cwd, 'cwd', { allowRoot: true })
      : workspacePath;
    const testFiles = normalizeTestFiles(options.testFile);
    const preparedTestFiles =
      options.copyTestFilesToWorkspace === true
        ? await copyTestFilesIntoWorkspace(testFiles, options, cwd)
        : { testFiles };
    if (preparedTestFiles.tempDir) {
      tempDirs.push(preparedTestFiles.tempDir);
    }

    const command = buildCommand(options, preparedTestFiles.testFiles);
    const appendReporterArgs = options.appendReporterArgs ?? options.command === undefined;
    let outputFile = options.outputFile
      ? resolveInsideWorkspace(cwd, options.outputFile, 'outputFile')
      : undefined;

    if (appendReporterArgs) {
      const tempDir = await mkdtemp(nodePath.join(tmpdir(), 'agentv-vitest-'));
      tempDirs.push(tempDir);
      outputFile = nodePath.join(tempDir, 'results.json');
      command.push('--reporter=json', `--outputFile=${outputFile}`);
    }

    const result = await runCommand(command, {
      cwd,
      timeoutMs: options.timeoutMs,
      env: {
        AGENTV_WORKSPACE_PATH: workspacePath,
        ...(outputFile !== undefined ? { AGENTV_VITEST_JSON_PATH: outputFile } : {}),
        ...options.env,
      },
    });

    const report = await readVitestReport(result, outputFile);
    return vitestReportToCodeGraderResult(report, options);
  } catch (error) {
    return {
      score: 0,
      assertions: [
        {
          text: 'Vitest workspace verifier failed to run',
          passed: false,
          evidence: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  } finally {
    for (const tempDir of tempDirs.reverse()) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export function defineVitestWorkspaceGrader(options: VitestWorkspaceGraderOptions): void {
  runCodeGrader((input) => runVitestWorkspaceGrader(options, input));
}
