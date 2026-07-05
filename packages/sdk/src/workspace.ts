/**
 * Workspace grader helpers for deterministic file checks.
 *
 * `defineWorkspaceGrader()` wraps the script-grader runtime with a small
 * workspace object so graders can read files and return check arrays
 * without hand-rolling stdin parsing, workspace path fallback, file reads, or
 * score aggregation.
 */
import { readFile, stat } from 'node:fs/promises';
import nodePath from 'node:path';

import { runScriptGrader } from './runtime.js';
import {
  type ScriptGraderCheck,
  type ScriptGraderInput,
  type ScriptGraderResult,
  ScriptGraderResultSchema,
} from './schemas.js';

export interface WorkspaceCheck {
  readonly text: string;
  readonly pass: boolean;
  readonly score?: number;
  readonly reason: string;
  readonly evidence?: string;
}

/** @deprecated Use WorkspaceCheck. */
export type WorkspaceAssertion = WorkspaceCheck;

type Awaitable<T> = T | Promise<T>;

export type WorkspaceGraderReturn =
  | ScriptGraderResult
  | WorkspaceCheck
  | readonly Awaitable<WorkspaceCheck>[];

export interface WorkspaceFileAssertionOptions {
  readonly text?: string;
}

export interface WorkspaceFile {
  readonly path: string;
  readonly absolutePath?: string;
  readText(): Promise<string>;
  exists(options?: WorkspaceFileAssertionOptions): Promise<WorkspaceCheck>;
  contains(expected: string, options?: WorkspaceFileAssertionOptions): Promise<WorkspaceCheck>;
  notContains(expected: string, options?: WorkspaceFileAssertionOptions): Promise<WorkspaceCheck>;
  matches(pattern: RegExp, options?: WorkspaceFileAssertionOptions): Promise<WorkspaceCheck>;
  notMatches(pattern: RegExp, options?: WorkspaceFileAssertionOptions): Promise<WorkspaceCheck>;
}

export interface Workspace {
  readonly path?: string;
  file(relativePath: string): WorkspaceFile;
  readText(relativePath: string): Promise<string>;
}

export type WorkspaceGraderContext = ScriptGraderInput & {
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

function workspacePathFrom(input: ScriptGraderInput): string | undefined {
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

function check(text: string, pass: boolean, reason: string, evidence?: string): WorkspaceCheck {
  return {
    text,
    pass,
    reason,
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

function isScriptGraderResult(value: WorkspaceGraderReturn): value is ScriptGraderResult {
  return !Array.isArray(value) && typeof value === 'object' && value !== null && 'score' in value;
}

export function createWorkspace(input: ScriptGraderInput): Workspace {
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
          return check(text, false, resolved.error);
        }

        try {
          const fileStat = await stat(resolved.absolutePath as string);
          if (fileStat.isFile()) {
            return check(text, true, `${label} exists.`);
          }
          return check(text, false, `${label} exists but is not a file.`);
        } catch {
          return check(text, false, `${label} does not exist.`);
        }
      },

      async contains(expected: string, options: WorkspaceFileAssertionOptions = {}) {
        const text = options.text ?? `${label} contains ${quote(expected)}`;
        const content = await readFileForAssertion(this);
        if ('error' in content) {
          return check(text, false, content.error);
        }

        const pass = content.content.includes(expected);
        return check(
          text,
          pass,
          pass
            ? `${label} contains ${quote(expected)}.`
            : `${label} is missing ${quote(expected)}.`,
        );
      },

      async notContains(expected: string, options: WorkspaceFileAssertionOptions = {}) {
        const text = options.text ?? `${label} does not contain ${quote(expected)}`;
        const content = await readFileForAssertion(this);
        if ('error' in content) {
          return check(text, false, content.error);
        }

        const pass = !content.content.includes(expected);
        return check(
          text,
          pass,
          pass
            ? `${label} does not contain ${quote(expected)}.`
            : `${label} contains unexpected text ${quote(expected)}.`,
        );
      },

      async matches(pattern: RegExp, options: WorkspaceFileAssertionOptions = {}) {
        const text = options.text ?? `${label} matches ${regexLabel(pattern)}`;
        const content = await readFileForAssertion(this);
        if ('error' in content) {
          return check(text, false, content.error);
        }

        pattern.lastIndex = 0;
        const pass = pattern.test(content.content);
        return check(
          text,
          pass,
          pass
            ? `${label} matches ${regexLabel(pattern)}.`
            : `${label} does not match ${regexLabel(pattern)}.`,
        );
      },

      async notMatches(pattern: RegExp, options: WorkspaceFileAssertionOptions = {}) {
        const text = options.text ?? `${label} does not match ${regexLabel(pattern)}`;
        const content = await readFileForAssertion(this);
        if ('error' in content) {
          return check(text, false, content.error);
        }

        pattern.lastIndex = 0;
        const pass = !pattern.test(content.content);
        return check(
          text,
          pass,
          pass
            ? `${label} does not match ${regexLabel(pattern)}.`
            : `${label} matches unexpected pattern ${regexLabel(pattern)}.`,
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
): Promise<ScriptGraderResult> {
  if (isScriptGraderResult(result)) {
    return ScriptGraderResultSchema.parse(result);
  }

  const checks = Array.isArray(result) ? await Promise.all(result) : [result];
  const passed = checks.filter((item) => item.pass).length;
  const score =
    checks.length > 0
      ? checks.reduce((sum, item) => sum + (item.score ?? (item.pass ? 1 : 0)), 0) / checks.length
      : 0;

  return ScriptGraderResultSchema.parse({
    pass: checks.length > 0 && passed === checks.length,
    score,
    reason: checks.length > 0 ? `${passed}/${checks.length} checks passed.` : 'No checks ran.',
    checks: checks satisfies readonly ScriptGraderCheck[],
  });
}

export async function runWorkspaceGrader(
  handler: WorkspaceGraderHandler,
  input: ScriptGraderInput,
): Promise<ScriptGraderResult> {
  return normalizeWorkspaceGraderResult(
    await handler({
      ...input,
      workspace: createWorkspace(input),
    }),
  );
}

export function defineWorkspaceGrader(handler: WorkspaceGraderHandler): void {
  runScriptGrader((input) => runWorkspaceGrader(handler, input));
}
