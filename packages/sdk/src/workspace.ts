/**
 * Workspace grader helpers for deterministic file assertions.
 *
 * `defineWorkspaceGrader()` wraps the code-grader runtime with a small
 * workspace object so graders can read files and return assertion arrays
 * without hand-rolling stdin parsing, workspace path fallback, file reads, or
 * score aggregation.
 */
import { readFile, stat } from 'node:fs/promises';
import nodePath from 'node:path';

import { runCodeGrader } from './runtime.js';
import { type CodeGraderInput, type CodeGraderResult, CodeGraderResultSchema } from './schemas.js';

export interface WorkspaceAssertion {
  readonly text: string;
  readonly passed: boolean;
  readonly evidence?: string;
}

type Awaitable<T> = T | Promise<T>;

export type WorkspaceGraderReturn =
  | CodeGraderResult
  | WorkspaceAssertion
  | readonly Awaitable<WorkspaceAssertion>[];

export interface WorkspaceFileAssertionOptions {
  readonly text?: string;
}

export interface WorkspaceFile {
  readonly path: string;
  readonly absolutePath?: string;
  readText(): Promise<string>;
  exists(options?: WorkspaceFileAssertionOptions): Promise<WorkspaceAssertion>;
  contains(expected: string, options?: WorkspaceFileAssertionOptions): Promise<WorkspaceAssertion>;
  notContains(
    expected: string,
    options?: WorkspaceFileAssertionOptions,
  ): Promise<WorkspaceAssertion>;
  matches(pattern: RegExp, options?: WorkspaceFileAssertionOptions): Promise<WorkspaceAssertion>;
  notMatches(pattern: RegExp, options?: WorkspaceFileAssertionOptions): Promise<WorkspaceAssertion>;
}

export interface Workspace {
  readonly path?: string;
  file(relativePath: string): WorkspaceFile;
  readText(relativePath: string): Promise<string>;
}

export type WorkspaceGraderContext = CodeGraderInput & {
  readonly workspace: Workspace;
};

export type WorkspaceGraderHandler = (
  context: WorkspaceGraderContext,
) => WorkspaceGraderReturn | Promise<WorkspaceGraderReturn>;

interface ResolvedWorkspacePath {
  readonly displayPath: string;
  readonly absolutePath?: string;
  readonly error?: string;
}

function workspacePathFrom(input: CodeGraderInput): string | undefined {
  const workspacePath = input.workspacePath ?? process.env.AGENTV_WORKSPACE_PATH;
  if (!workspacePath?.trim()) {
    return undefined;
  }
  return workspacePath;
}

function normalizeDisplayPath(relativePath: string): string {
  return relativePath.split(nodePath.sep).join('/');
}

function resolveWorkspacePath(workspacePath: string | undefined, relativePath: string) {
  const displayPath = normalizeDisplayPath(relativePath);

  if (!workspacePath) {
    return {
      displayPath,
      error: 'Workspace path is not available. Configure workspace in the eval YAML.',
    };
  }

  if (!relativePath.trim()) {
    return { displayPath, error: 'Workspace file path must not be empty.' };
  }

  if (nodePath.isAbsolute(relativePath)) {
    return {
      displayPath,
      error: `Workspace file path must be relative: ${displayPath}`,
    };
  }

  const root = nodePath.resolve(workspacePath);
  const absolutePath = nodePath.resolve(root, relativePath);
  const relativeToRoot = nodePath.relative(root, absolutePath);

  if (
    relativeToRoot === '' ||
    relativeToRoot.startsWith('..') ||
    nodePath.isAbsolute(relativeToRoot)
  ) {
    return {
      displayPath,
      error: `Workspace file path must stay inside the workspace: ${displayPath}`,
    };
  }

  return {
    displayPath: normalizeDisplayPath(relativeToRoot),
    absolutePath,
  };
}

function assertion(text: string, passed: boolean, evidence?: string): WorkspaceAssertion {
  return {
    text,
    passed,
    ...(evidence !== undefined ? { evidence } : {}),
  };
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function regexLabel(pattern: RegExp): string {
  return `/${pattern.source}/${pattern.flags}`;
}

async function readFileForAssertion(
  file: WorkspaceFile,
): Promise<{ readonly content: string } | { readonly error: string }> {
  try {
    return { content: await file.readText() };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function isCodeGraderResult(value: WorkspaceGraderReturn): value is CodeGraderResult {
  return !Array.isArray(value) && typeof value === 'object' && value !== null && 'score' in value;
}

export function createWorkspace(input: CodeGraderInput): Workspace {
  const workspacePath = workspacePathFrom(input);
  const textCache = new Map<string, Promise<string>>();

  async function readText(relativePath: string) {
    const resolved = resolveWorkspacePath(workspacePath, relativePath);
    if (resolved.error) {
      throw new Error(resolved.error);
    }

    const absolutePath = resolved.absolutePath;
    if (!absolutePath) {
      throw new Error(`Unable to resolve workspace file: ${resolved.displayPath}`);
    }

    let pendingRead = textCache.get(absolutePath);
    if (!pendingRead) {
      pendingRead = readFile(absolutePath, 'utf8');
      textCache.set(absolutePath, pendingRead);
    }
    return pendingRead;
  }

  function file(relativePath: string): WorkspaceFile {
    const resolved = resolveWorkspacePath(workspacePath, relativePath);
    const label = resolved.displayPath;

    return {
      path: label,
      ...(resolved.absolutePath !== undefined ? { absolutePath: resolved.absolutePath } : {}),

      readText() {
        return readText(relativePath);
      },

      async exists(options: WorkspaceFileAssertionOptions = {}) {
        const text = options.text ?? `${label} exists`;
        if (resolved.error) {
          return assertion(text, false, resolved.error);
        }

        try {
          const fileStat = await stat(resolved.absolutePath as string);
          if (fileStat.isFile()) {
            return assertion(text, true);
          }
          return assertion(text, false, `${label} exists but is not a file.`);
        } catch {
          return assertion(text, false, `${label} does not exist.`);
        }
      },

      async contains(expected: string, options: WorkspaceFileAssertionOptions = {}) {
        const text = options.text ?? `${label} contains ${quote(expected)}`;
        const content = await readFileForAssertion(this);
        if ('error' in content) {
          return assertion(text, false, content.error);
        }

        const passed = content.content.includes(expected);
        return assertion(
          text,
          passed,
          passed ? undefined : `${label} is missing ${quote(expected)}.`,
        );
      },

      async notContains(expected: string, options: WorkspaceFileAssertionOptions = {}) {
        const text = options.text ?? `${label} does not contain ${quote(expected)}`;
        const content = await readFileForAssertion(this);
        if ('error' in content) {
          return assertion(text, false, content.error);
        }

        const passed = !content.content.includes(expected);
        return assertion(
          text,
          passed,
          passed ? undefined : `${label} contains unexpected text ${quote(expected)}.`,
        );
      },

      async matches(pattern: RegExp, options: WorkspaceFileAssertionOptions = {}) {
        const text = options.text ?? `${label} matches ${regexLabel(pattern)}`;
        const content = await readFileForAssertion(this);
        if ('error' in content) {
          return assertion(text, false, content.error);
        }

        pattern.lastIndex = 0;
        const passed = pattern.test(content.content);
        return assertion(
          text,
          passed,
          passed ? undefined : `${label} does not match ${regexLabel(pattern)}.`,
        );
      },

      async notMatches(pattern: RegExp, options: WorkspaceFileAssertionOptions = {}) {
        const text = options.text ?? `${label} does not match ${regexLabel(pattern)}`;
        const content = await readFileForAssertion(this);
        if ('error' in content) {
          return assertion(text, false, content.error);
        }

        pattern.lastIndex = 0;
        const passed = !pattern.test(content.content);
        return assertion(
          text,
          passed,
          passed ? undefined : `${label} matches unexpected pattern ${regexLabel(pattern)}.`,
        );
      },
    };
  }

  return {
    ...(workspacePath !== undefined ? { path: workspacePath } : {}),
    file,
    readText,
  };
}

export async function normalizeWorkspaceGraderResult(
  result: WorkspaceGraderReturn,
): Promise<CodeGraderResult> {
  if (isCodeGraderResult(result)) {
    return CodeGraderResultSchema.parse(result);
  }

  const assertions = Array.isArray(result) ? await Promise.all(result) : [result];
  const passed = assertions.filter((item) => item.passed).length;

  return CodeGraderResultSchema.parse({
    score: assertions.length > 0 ? passed / assertions.length : 0,
    assertions,
  });
}

export async function runWorkspaceGrader(
  handler: WorkspaceGraderHandler,
  input: CodeGraderInput,
): Promise<CodeGraderResult> {
  return normalizeWorkspaceGraderResult(
    await handler({
      ...input,
      workspace: createWorkspace(input),
    }),
  );
}

export function defineWorkspaceGrader(handler: WorkspaceGraderHandler): void {
  runCodeGrader((input) => runWorkspaceGrader(handler, input));
}
