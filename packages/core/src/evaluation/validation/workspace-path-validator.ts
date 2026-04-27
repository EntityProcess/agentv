import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

import { parseYamlValue } from '../yaml-loader.js';
import type { ValidationError } from './types.js';

type JsonValue = string | number | boolean | null | JsonObject | JsonArray;
type JsonObject = { readonly [key: string]: JsonValue };
type JsonArray = readonly JsonValue[];

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate that workspace template and hook script paths in eval files exist.
 *
 * Catches two classes of errors that surface as `setup_error` at runtime but are
 * detectable statically:
 *
 * 1. `workspace.template` — the template path must exist.
 * 2. `workspace.hooks.*.command` — script arguments that look like relative file
 *    paths (start with `./`/`../` or carry a script extension) must resolve to
 *    existing files using the same cwd precedence the runtime uses:
 *    `hook.cwd ?? workspaceFileDir ?? evalDir`
 *
 * When `workspace` is a string path to an external file, that file is also read
 * and its template/hook paths are checked relative to the workspace file's directory.
 * (The workspace file's existence itself is already checked by eval-validator.)
 */
export async function validateWorkspacePaths(
  evalFilePath: string,
): Promise<readonly ValidationError[]> {
  const errors: ValidationError[] = [];
  const absolutePath = path.resolve(evalFilePath);
  const evalDir = path.dirname(absolutePath);

  let parsed: unknown;
  try {
    const content = await readFile(absolutePath, 'utf8');
    parsed = parseYamlValue(content);
  } catch {
    // Parse errors are already caught by eval-validator
    return errors;
  }

  if (!isObject(parsed)) return errors;

  const workspaceRaw = parsed.workspace;
  if (workspaceRaw === undefined || workspaceRaw === null) return errors;

  if (typeof workspaceRaw === 'string') {
    // External workspace file — existence is already checked by eval-validator.
    // Read and check template/hook paths inside the external file.
    const workspaceFilePath = path.resolve(evalDir, workspaceRaw);
    try {
      const wsContent = await readFile(workspaceFilePath, 'utf8');
      const wsParsed = parseYamlValue(wsContent);
      if (isObject(wsParsed)) {
        const wsDir = path.dirname(workspaceFilePath);
        await validateWorkspaceObject(wsParsed, wsDir, absolutePath, 'workspace', errors);
      }
    } catch {
      // File missing or invalid YAML — eval-validator already reports this
    }
  } else if (isObject(workspaceRaw)) {
    await validateWorkspaceObject(workspaceRaw, evalDir, absolutePath, 'workspace', errors);
  }

  return errors;
}

async function validateWorkspaceObject(
  obj: JsonObject,
  baseDir: string,
  evalFilePath: string,
  location: string,
  errors: ValidationError[],
): Promise<void> {
  // Check template path
  const template = obj.template;
  if (typeof template === 'string') {
    const templatePath = path.isAbsolute(template) ? template : path.resolve(baseDir, template);
    if (!(await fileExists(templatePath))) {
      errors.push({
        severity: 'error',
        filePath: evalFilePath,
        location: `${location}.template`,
        message: `Template path not found: ${template} (resolved to ${templatePath})`,
      });
    }
  }

  // Check hook script paths
  const hooks = obj.hooks;
  if (!isObject(hooks)) return;

  for (const hookName of ['before_all', 'before_each', 'after_each', 'after_all'] as const) {
    const hook = hooks[hookName];
    if (!isObject(hook)) continue;

    // Resolve hook cwd the same way yaml-parser does at parse time:
    //   config.cwd (resolved against baseDir) ?? baseDir
    // baseDir = workspaceFileDir for external workspace files, evalDir for inline.
    const hookCwdRaw = typeof hook.cwd === 'string' ? hook.cwd : undefined;
    const hookCwd = hookCwdRaw
      ? path.isAbsolute(hookCwdRaw)
        ? hookCwdRaw
        : path.resolve(baseDir, hookCwdRaw)
      : baseDir;

    // Support both `command` (canonical) and `script` (deprecated alias)
    const command = hook.command ?? hook.script;
    if (!Array.isArray(command)) continue;

    for (let i = 0; i < command.length; i++) {
      const arg = command[i];
      if (typeof arg !== 'string') continue;
      if (!looksLikeFilePath(arg)) continue;

      const resolved = path.isAbsolute(arg) ? arg : path.resolve(hookCwd, arg);
      if (!(await fileExists(resolved))) {
        errors.push({
          severity: 'error',
          filePath: evalFilePath,
          location: `${location}.hooks.${hookName}.command[${i}]`,
          message: `Hook script not found: ${arg} (resolved to ${resolved})`,
        });
      }
    }
  }
}

/**
 * Heuristic: does this command argument look like a file path rather than a
 * system binary name?
 *
 * Detects:
 * - Explicit relative paths: `./foo`, `../bar/baz`
 * - Script-extension arguments: `setup.mjs`, `scripts/init.sh`
 */
function looksLikeFilePath(arg: string): boolean {
  if (arg.startsWith('./') || arg.startsWith('../')) return true;
  const scriptExtensions = [
    '.mjs',
    '.cjs',
    '.js',
    '.ts',
    '.sh',
    '.bash',
    '.zsh',
    '.py',
    '.rb',
    '.pl',
  ];
  return scriptExtensions.some((ext) => arg.endsWith(ext));
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
