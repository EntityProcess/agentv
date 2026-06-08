import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  type EvalSourceReference,
  type EvalTest,
  type TargetDefinition,
  parseYamlValue,
} from '@agentv/core';
import { stringify as stringifyYaml } from 'yaml';

import { toSnakeCaseDeep } from '../../utils/case-conversion.js';

const TASK_DIRNAME = 'task';
const TASK_EVAL_FILENAME = 'EVAL.yaml';
const TASK_TARGETS_FILENAME = 'targets.yaml';
const TASK_FILES_DIRNAME = 'files';
const TASK_GRADERS_DIRNAME = 'graders';
const REDACTED_SOURCE_VALUE = '[redacted]';
const SECRET_KEY_PATTERN =
  /(?:api[_-]?key|authorization|bearer|credential|password|private[_-]?key|secret|token)/i;
const SOURCE_SECRET_LINE_PATTERN =
  /^(\s*[\w.-]*(?:api[_-]?key|authorization|bearer|credential|password|private[_-]?key|secret|token)[\w.-]*\s*:\s*).+$/gim;
const SOURCE_SECRET_ASSIGNMENT_PATTERN =
  /^((?:--?)?[\w.-]*(?:api[_-]?key|authorization|bearer|credential|password|private[_-]?key|secret|token)[\w.-]*[=:]).+$/i;
const SOURCE_SECRET_FLAG_PATTERN =
  /^--?[\w.-]*(?:api[_-]?key|authorization|bearer|credential|password|private[_-]?key|secret|token)[\w.-]*$/i;
const SECRET_PATH_SEGMENT_PATTERN =
  /(^|[/\\._-])(?:\.env(?:\..*)?|id_rsa|id_dsa|id_ecdsa|id_ed25519|oauth|credentials?|secrets?|tokens?|private[_-]?key)(?:$|[/\\._-])/i;
const SKIPPED_DIR_NAMES = new Set([
  '.git',
  'node_modules',
  '.agentv',
  '.ntm',
  '.beads',
  '.DS_Store',
]);

export interface TaskBundleTargetSelection {
  readonly evalFileAbsolutePath?: string;
  readonly targetName: string;
  readonly resolvedTargetName?: string;
  readonly definitions: readonly TargetDefinition[];
}

export interface MaterializeTaskBundleOptions {
  readonly test: EvalTest;
  readonly targetName: string;
  readonly targetDefinitions: readonly TargetDefinition[];
  readonly outputDir: string;
  readonly cwd?: string;
  readonly repoRoot?: string;
}

export interface MaterializedTaskBundlePaths {
  readonly taskDir: string;
  readonly evalPath: string;
  readonly targetsPath: string;
  readonly filesPath?: string;
  readonly gradersPath?: string;
}

interface CopiedReference {
  readonly reference: EvalSourceReference;
  readonly localPath: string;
  readonly destinationPath: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toPortableRelativePath(root: string | undefined, candidate: string): string | undefined {
  if (!root) {
    return undefined;
  }
  const relative = path.relative(root, candidate);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    return relative.split(path.sep).join('/');
  }
  return undefined;
}

function safeRelativePath(value: string): string | undefined {
  const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = normalized.split('/').filter((segment) => segment && segment !== '.');
  if (segments.length === 0 || segments.some((segment) => segment === '..')) {
    return undefined;
  }
  return segments.join('/');
}

function hashedExternalPath(resolvedPath: string): string {
  const hash = createHash('sha256').update(path.resolve(resolvedPath)).digest('hex').slice(0, 10);
  const basename = path.basename(resolvedPath) || 'asset';
  return `external/${hash}-${basename}`;
}

function relativeReferencePath(
  reference: EvalSourceReference,
  options: Pick<MaterializeTaskBundleOptions, 'cwd' | 'repoRoot'>,
): string | undefined {
  if (reference.resolvedPath) {
    const resolved = path.resolve(reference.resolvedPath);
    const portable =
      toPortableRelativePath(options.repoRoot, resolved) ??
      toPortableRelativePath(options.cwd, resolved);
    return safeRelativePath(portable ?? hashedExternalPath(resolved));
  }
  return safeRelativePath(reference.displayPath);
}

function referenceBucket(reference: EvalSourceReference): 'files' | 'graders' {
  return reference.kind === 'input_file' ? TASK_FILES_DIRNAME : TASK_GRADERS_DIRNAME;
}

function isLikelyBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, Math.min(buffer.length, 8000)).includes(0);
}

function redactSecretLikeLines(content: string): string {
  return content.replace(SOURCE_SECRET_LINE_PATTERN, `$1${REDACTED_SOURCE_VALUE}`);
}

function isSecretLikePath(filePath: string): boolean {
  return SECRET_PATH_SEGMENT_PATTERN.test(filePath.replace(/\\/g, '/'));
}

function preservesPlaceholder(value: string): boolean {
  return value.includes('${{');
}

function sanitizeSecretString(value: string, keyHint?: string): string {
  if (preservesPlaceholder(value)) {
    return value;
  }
  if (keyHint && SECRET_KEY_PATTERN.test(keyHint)) {
    return REDACTED_SOURCE_VALUE;
  }
  if (SOURCE_SECRET_ASSIGNMENT_PATTERN.test(value)) {
    return value.replace(SOURCE_SECRET_ASSIGNMENT_PATTERN, `$1${REDACTED_SOURCE_VALUE}`);
  }
  return value;
}

function sanitizeBundleValue(value: unknown, keyHint?: string): unknown {
  if (typeof value === 'string') {
    return sanitizeSecretString(value, keyHint);
  }
  if (Array.isArray(value)) {
    let redactNext = false;
    return value.map((item) => {
      if (typeof item !== 'string') {
        return sanitizeBundleValue(item);
      }
      if (redactNext) {
        redactNext = false;
        return preservesPlaceholder(item) ? item : REDACTED_SOURCE_VALUE;
      }
      if (SOURCE_SECRET_FLAG_PATTERN.test(item)) {
        redactNext = true;
        return item;
      }
      return sanitizeSecretString(item);
    });
  }
  if (isRecord(value)) {
    const sanitized: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      sanitized[key] = sanitizeBundleValue(child, key);
    }
    return sanitized;
  }
  return value;
}

async function copyFileRedactingText(
  sourcePath: string,
  destinationPath: string,
): Promise<boolean> {
  await mkdir(path.dirname(destinationPath), { recursive: true });
  if (isSecretLikePath(sourcePath)) {
    await writeFile(destinationPath, `${REDACTED_SOURCE_VALUE}\n`, 'utf8');
    return true;
  }

  const content = await readFile(sourcePath);
  if (isLikelyBinary(content)) {
    await writeFile(destinationPath, content);
    return true;
  }

  const redacted = redactSecretLikeLines(content.toString('utf8').replace(/\r\n/g, '\n'));
  await writeFile(destinationPath, redacted, 'utf8');
  return true;
}

async function copyDirectory(sourcePath: string, destinationPath: string): Promise<boolean> {
  if (isSecretLikePath(sourcePath)) {
    return false;
  }

  await mkdir(destinationPath, { recursive: true });
  let copiedAny = false;
  const entries = await readdir(sourcePath, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIPPED_DIR_NAMES.has(entry.name) || isSecretLikePath(entry.name)) {
      continue;
    }
    const sourceChild = path.join(sourcePath, entry.name);
    const destinationChild = path.join(destinationPath, entry.name);
    if (entry.isDirectory()) {
      copiedAny = (await copyDirectory(sourceChild, destinationChild)) || copiedAny;
    } else if (entry.isFile()) {
      copiedAny = (await copyFileRedactingText(sourceChild, destinationChild)) || copiedAny;
    }
  }
  return copiedAny;
}

function shouldCopyDirectory(reference: EvalSourceReference): boolean {
  if (reference.kind !== 'code_grader_cwd') {
    return true;
  }
  return !path.isAbsolute(reference.displayPath);
}

async function copyReference(
  reference: EvalSourceReference,
  taskDir: string,
  options: Pick<MaterializeTaskBundleOptions, 'cwd' | 'repoRoot'>,
): Promise<CopiedReference | undefined> {
  if (!reference.resolvedPath) {
    return undefined;
  }

  const relPath = relativeReferencePath(reference, options);
  if (!relPath) {
    return undefined;
  }

  const bucket = referenceBucket(reference);
  const localPath = `${bucket}/${relPath}`;
  const destinationPath = path.join(taskDir, localPath);
  const sourcePath = path.resolve(reference.resolvedPath);
  const sourceStat = await stat(sourcePath).catch(() => undefined);
  if (!sourceStat) {
    return undefined;
  }

  if (sourceStat.isDirectory()) {
    if (!shouldCopyDirectory(reference)) {
      return undefined;
    }
    if (!(await copyDirectory(sourcePath, destinationPath))) {
      return undefined;
    }
  } else if (sourceStat.isFile()) {
    if (!(await copyFileRedactingText(sourcePath, destinationPath))) {
      return undefined;
    }
  } else {
    return undefined;
  }

  return { reference, localPath: localPath.split(path.sep).join('/'), destinationPath };
}

async function copyReferences(
  references: readonly EvalSourceReference[],
  taskDir: string,
  options: Pick<MaterializeTaskBundleOptions, 'cwd' | 'repoRoot'>,
): Promise<readonly CopiedReference[]> {
  const copied: CopiedReference[] = [];
  const seenDestinations = new Set<string>();
  for (const reference of references) {
    const result = await copyReference(reference, taskDir, options);
    if (!result || seenDestinations.has(result.destinationPath)) {
      continue;
    }
    seenDestinations.add(result.destinationPath);
    copied.push(result);
  }
  return copied;
}

function addRewrite(rewrites: Map<string, string>, from: string | undefined, to: string): void {
  if (!from || from.trim().length === 0) {
    return;
  }
  rewrites.set(from, to);
}

function buildPathRewrites(copiedReferences: readonly CopiedReference[]): Map<string, string> {
  const rewrites = new Map<string, string>();
  for (const { reference, localPath } of copiedReferences) {
    addRewrite(rewrites, reference.displayPath, localPath);
    addRewrite(rewrites, reference.resolvedPath, localPath);
    addRewrite(rewrites, `file://${reference.displayPath}`, `file://${localPath}`);
    if (reference.resolvedPath) {
      addRewrite(rewrites, `file://${reference.resolvedPath}`, `file://${localPath}`);
    }
    for (const arg of reference.command ?? []) {
      if (arg === reference.displayPath || arg === reference.resolvedPath) {
        addRewrite(rewrites, arg, localPath);
      }
    }
  }
  return rewrites;
}

function rewritePathsDeep(value: unknown, rewrites: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') {
    return rewrites.get(value) ?? value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewritePathsDeep(item, rewrites));
  }
  if (isRecord(value)) {
    const rewritten: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      rewritten[key] = rewritePathsDeep(child, rewrites);
    }
    return rewritten;
  }
  return value;
}

function parseSourceTestCase(test: EvalTest): Record<string, unknown> {
  const parsed = test.source ? parseYamlValue(test.source.testSnapshotYaml) : undefined;
  const testCase = isRecord(parsed) ? { ...parsed } : { id: test.id, input: test.question };
  if (typeof testCase.id !== 'string' || testCase.id.length === 0) {
    testCase.id = test.id;
  }
  return testCase;
}

function withoutLegacyAssertionKeys(testCase: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(testCase).filter(([key]) => key !== 'assert' && key !== 'evaluators'),
  );
}

function buildEvalCase(
  test: EvalTest,
  rewrites: ReadonlyMap<string, string>,
): Record<string, unknown> {
  const testCase = rewritePathsDeep(parseSourceTestCase(test), rewrites) as Record<string, unknown>;
  const graderDefinitions = test.source?.graderDefinitions ?? [];
  if (graderDefinitions.length > 0) {
    return {
      ...withoutLegacyAssertionKeys(testCase),
      assertions: graderDefinitions.map((grader) =>
        rewritePathsDeep(toSnakeCaseDeep(grader.definition), rewrites),
      ),
    };
  }
  return testCase;
}

function targetReferenceNames(target: TargetDefinition): readonly string[] {
  const references: string[] = [];
  for (const key of ['use_target', 'grader_target', 'judge_target'] as const) {
    const value = target[key];
    if (typeof value === 'string' && value.trim().length > 0 && !value.includes('${{')) {
      references.push(value.trim());
    }
  }

  const fallbackTargets = target.fallback_targets;
  if (Array.isArray(fallbackTargets)) {
    for (const value of fallbackTargets) {
      if (typeof value === 'string' && value.trim().length > 0 && !value.includes('${{')) {
        references.push(value.trim());
      }
    }
  }

  return references;
}

function selectTargetDefinitions(
  targetName: string,
  definitions: readonly TargetDefinition[],
): readonly TargetDefinition[] {
  const byName = new Map(definitions.map((definition) => [definition.name, definition]));
  const selected: TargetDefinition[] = [];
  const seen = new Set<string>();

  function visit(name: string): void {
    if (seen.has(name)) {
      return;
    }
    const definition = byName.get(name);
    if (!definition) {
      return;
    }
    seen.add(name);
    selected.push(definition);
    for (const referenceName of targetReferenceNames(definition)) {
      visit(referenceName);
    }
  }

  visit(targetName);
  return selected;
}

async function writeYamlFile(filePath: string, value: unknown): Promise<void> {
  const yaml = stringifyYaml(toSnakeCaseDeep(sanitizeBundleValue(value)), {
    lineWidth: 0,
  }).trimEnd();
  await writeFile(filePath, `${yaml}\n`, 'utf8');
}

function hasCopiedBucket(copied: readonly CopiedReference[], bucket: 'files' | 'graders'): boolean {
  return copied.some((entry) => entry.localPath.startsWith(`${bucket}/`));
}

/**
 * Materialize the native AgentV task source for one completed result row.
 *
 * The bundle is intentionally just an eval file, a selected targets file, and
 * copied referenced assets. It does not create `.agentv/` under the result
 * artifact directory, so future reruns can choose their output root explicitly.
 */
export async function materializeTaskBundle(
  options: MaterializeTaskBundleOptions,
): Promise<MaterializedTaskBundlePaths | undefined> {
  if (!options.test.source) {
    return undefined;
  }

  const targetDefinitions = selectTargetDefinitions(options.targetName, options.targetDefinitions);
  if (targetDefinitions.length === 0) {
    return undefined;
  }

  const taskDir = path.join(options.outputDir, TASK_DIRNAME);
  await mkdir(taskDir, { recursive: true });

  const copiedReferences = await copyReferences(options.test.source.references, taskDir, options);
  const rewrites = buildPathRewrites(copiedReferences);
  const evalCase = buildEvalCase(options.test, rewrites);
  const evalPath = path.join(taskDir, TASK_EVAL_FILENAME);
  const targetsPath = path.join(taskDir, TASK_TARGETS_FILENAME);

  await writeYamlFile(evalPath, {
    execution: { target: options.targetName },
    tests: [evalCase],
  });
  await writeYamlFile(targetsPath, { targets: targetDefinitions });

  return {
    taskDir,
    evalPath,
    targetsPath,
    ...(hasCopiedBucket(copiedReferences, 'files')
      ? { filesPath: path.join(taskDir, TASK_FILES_DIRNAME) }
      : {}),
    ...(hasCopiedBucket(copiedReferences, 'graders')
      ? { gradersPath: path.join(taskDir, TASK_GRADERS_DIRNAME) }
      : {}),
  };
}
