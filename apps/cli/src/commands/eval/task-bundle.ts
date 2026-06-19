import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  type EvalSourceReference,
  type EvalTest,
  type JsonObject,
  type TargetDefinition,
  type TestMessage,
  type WorkspaceConfig,
  parseYamlValue,
} from '@agentv/core';
import { stringify as stringifyYaml } from 'yaml';

import { toSnakeCaseDeep } from '../../utils/case-conversion.js';

const TASK_DIRNAME = 'task';
const TASK_EVAL_FILENAME = 'EVAL.yaml';
const TASK_TARGETS_FILENAME = 'targets.yaml';
const TASK_FILES_DIRNAME = 'files';
const TASK_GRADERS_DIRNAME = 'graders';
const BUNDLE_EVALS_DIRNAME = 'evals';
const BUNDLE_MANIFEST_FILENAME = 'agentv_bundle.json';
const BUNDLE_TARGETS_FILENAME = 'targets.yaml';
const BUNDLE_WORKSPACES_DIRNAME = 'workspaces';
const BUNDLE_SCRIPTS_DIRNAME = 'scripts';
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

export interface MaterializeEvalBundleOptions {
  readonly evalFilePath: string;
  readonly tests: readonly EvalTest[];
  readonly targetSelections: readonly TaskBundleTargetSelection[];
  readonly outputDir: string;
  readonly cwd?: string;
  readonly repoRoot?: string;
  readonly execution?: Record<string, unknown>;
  readonly now?: () => Date;
}

export interface MaterializedEvalBundlePaths {
  readonly bundleDir: string;
  readonly evalsDir: string;
  readonly evalPath: string;
  readonly targetsPath: string;
  readonly manifestPath: string;
  readonly filesPath?: string;
  readonly gradersPath?: string;
  readonly workspacesPath?: string;
  readonly scriptsPath?: string;
}

type BundleReferenceKind =
  | EvalSourceReference['kind']
  | 'expected_output_file'
  | 'workspace_template'
  | 'workspace_hook_command';

interface BundleSourceReference extends Omit<EvalSourceReference, 'kind'> {
  readonly kind: BundleReferenceKind;
  readonly location?: string;
}

interface CopiedReference {
  readonly reference: BundleSourceReference;
  readonly localPath: string;
  readonly destinationPath: string;
}

interface BundleReferenceFailure {
  readonly reference: BundleSourceReference;
  readonly reason: string;
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
  reference: BundleSourceReference,
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

function referenceBucket(
  reference: BundleSourceReference,
): 'files' | 'graders' | 'workspaces' | 'scripts' {
  if (reference.kind === 'input_file' || reference.kind === 'expected_output_file') {
    return TASK_FILES_DIRNAME;
  }
  if (reference.kind === 'workspace_template') {
    return BUNDLE_WORKSPACES_DIRNAME;
  }
  if (reference.kind === 'workspace_hook_command') {
    return BUNDLE_SCRIPTS_DIRNAME;
  }
  return TASK_GRADERS_DIRNAME;
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

function shouldCopyDirectory(reference: BundleSourceReference): boolean {
  if (reference.kind !== 'code_grader_cwd') {
    return true;
  }
  return !path.isAbsolute(reference.displayPath);
}

async function copyReferenceWithFailure(
  reference: BundleSourceReference,
  taskDir: string,
  options: Pick<MaterializeTaskBundleOptions, 'cwd' | 'repoRoot'>,
): Promise<{ copied?: CopiedReference; failure?: BundleReferenceFailure }> {
  if (!reference.resolvedPath) {
    return {
      failure: {
        reference,
        reason: `${reference.location ?? reference.kind} has no resolved path: ${reference.displayPath}`,
      },
    };
  }

  const relPath = relativeReferencePath(reference, options);
  if (!relPath) {
    return {
      failure: {
        reference,
        reason: `${reference.location ?? reference.kind} could not be assigned a portable path: ${reference.displayPath}`,
      },
    };
  }

  const bucket = referenceBucket(reference);
  const localPath = `${bucket}/${relPath}`;
  const destinationPath = path.join(taskDir, localPath);
  const sourcePath = path.resolve(reference.resolvedPath);
  const sourceStat = await stat(sourcePath).catch(() => undefined);
  if (!sourceStat) {
    return {
      failure: {
        reference,
        reason: `${reference.location ?? reference.kind} not found: ${reference.displayPath} (resolved to ${sourcePath})`,
      },
    };
  }

  if (sourceStat.isDirectory()) {
    if (!shouldCopyDirectory(reference)) {
      return {
        failure: {
          reference,
          reason: `${reference.location ?? reference.kind} uses an absolute directory that is not safe to copy automatically: ${reference.displayPath}`,
        },
      };
    }
    if (!(await copyDirectory(sourcePath, destinationPath))) {
      return {
        failure: {
          reference,
          reason: `${reference.location ?? reference.kind} directory contained no bundleable files: ${reference.displayPath}`,
        },
      };
    }
  } else if (sourceStat.isFile()) {
    if (!(await copyFileRedactingText(sourcePath, destinationPath))) {
      return {
        failure: {
          reference,
          reason: `${reference.location ?? reference.kind} could not be copied: ${reference.displayPath}`,
        },
      };
    }
  } else {
    return {
      failure: {
        reference,
        reason: `${reference.location ?? reference.kind} is not a regular file or directory: ${reference.displayPath}`,
      },
    };
  }

  return { copied: { reference, localPath: localPath.split(path.sep).join('/'), destinationPath } };
}

async function copyReference(
  reference: BundleSourceReference,
  taskDir: string,
  options: Pick<MaterializeTaskBundleOptions, 'cwd' | 'repoRoot'>,
): Promise<CopiedReference | undefined> {
  return (await copyReferenceWithFailure(reference, taskDir, options)).copied;
}

async function copyReferences(
  references: readonly BundleSourceReference[],
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

async function copyReferencesStrict(
  references: readonly BundleSourceReference[],
  taskDir: string,
  options: Pick<MaterializeEvalBundleOptions, 'cwd' | 'repoRoot'>,
): Promise<{
  readonly copied: readonly CopiedReference[];
  readonly failures: readonly BundleReferenceFailure[];
}> {
  const copied: CopiedReference[] = [];
  const failures: BundleReferenceFailure[] = [];
  const seenDestinations = new Set<string>();
  const seenFailures = new Set<string>();

  for (const reference of references) {
    const result = await copyReferenceWithFailure(reference, taskDir, options);
    if (result.copied) {
      if (seenDestinations.has(result.copied.destinationPath)) {
        continue;
      }
      seenDestinations.add(result.copied.destinationPath);
      copied.push(result.copied);
      continue;
    }

    if (result.failure) {
      const key = `${result.failure.reference.kind}:${result.failure.reference.displayPath}:${result.failure.reason}`;
      if (!seenFailures.has(key)) {
        seenFailures.add(key);
        failures.push(result.failure);
      }
    }
  }

  return { copied, failures };
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

function hasCopiedBucket(
  copied: readonly CopiedReference[],
  bucket: 'files' | 'graders' | 'workspaces' | 'scripts',
): boolean {
  return copied.some((entry) => entry.localPath.startsWith(`${bucket}/`));
}

function bundledEvalFileName(evalFilePath: string): string {
  const basename = path.basename(evalFilePath);
  const withoutKnownExtension = basename
    .replace(/\.eval\.[cm]?ts$/i, '')
    .replace(/\.eval\.ya?ml$/i, '')
    .replace(/\.[cm]?ts$/i, '')
    .replace(/\.ya?ml$/i, '')
    .replace(/\.jsonl?$/i, '');
  const safeName = withoutKnownExtension
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${safeName || 'bundle'}.eval.yaml`;
}

function uniqueTargetDefinitions(
  selections: readonly TaskBundleTargetSelection[],
): readonly TargetDefinition[] {
  const selected: TargetDefinition[] = [];
  const seen = new Set<string>();

  for (const selection of selections) {
    for (const definition of selectTargetDefinitions(selection.targetName, selection.definitions)) {
      if (seen.has(definition.name)) {
        continue;
      }
      seen.add(definition.name);
      selected.push(definition);
    }
  }

  return selected;
}

function uniqueTargetNames(selections: readonly TaskBundleTargetSelection[]): readonly string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const selection of selections) {
    if (seen.has(selection.targetName)) {
      continue;
    }
    seen.add(selection.targetName);
    names.push(selection.targetName);
  }
  return names;
}

function rewritePathString(value: string, rewrites: ReadonlyMap<string, string>): string {
  const direct = rewrites.get(value);
  if (direct) {
    return direct.startsWith('file://') ? direct.slice('file://'.length) : direct;
  }
  const fileUrl = rewrites.get(`file://${value}`);
  if (fileUrl) {
    return fileUrl.startsWith('file://') ? fileUrl.slice('file://'.length) : fileUrl;
  }
  return value;
}

function serializeContentValue(value: unknown, rewrites: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeContentItem(item, rewrites));
  }

  if (isRecord(value)) {
    return rewritePathsDeep(value, rewrites);
  }

  return value;
}

function serializeContentItem(value: unknown, rewrites: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') {
    return value;
  }
  if (!isRecord(value)) {
    return value;
  }

  const type = value.type;
  if (type === 'text') {
    const text = typeof value.value === 'string' ? value.value : value.text;
    return { type: 'text', value: typeof text === 'string' ? text : '' };
  }

  if (type === 'file') {
    const source =
      typeof value.value === 'string'
        ? value.value
        : typeof value.path === 'string'
          ? value.path
          : typeof value.resolvedPath === 'string'
            ? value.resolvedPath
            : undefined;
    return source
      ? { type: 'file', value: rewritePathString(source, rewrites) }
      : { type: 'file', value: '' };
  }

  if (type === 'image') {
    const source =
      typeof value.value === 'string'
        ? value.value
        : typeof value.path === 'string'
          ? value.path
          : typeof value.resolvedPath === 'string'
            ? value.resolvedPath
            : undefined;
    if (source) {
      return { type: 'image', value: rewritePathString(source, rewrites) };
    }
  }

  return rewritePathsDeep(value, rewrites);
}

function serializeMessage(
  message: TestMessage,
  rewrites: ReadonlyMap<string, string>,
): Record<string, unknown> {
  return {
    role: message.role,
    content: serializeContentValue(message.content, rewrites),
  };
}

function serializeExpectedMessage(
  message: JsonObject,
  rewrites: ReadonlyMap<string, string>,
): Record<string, unknown> {
  const serialized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(message)) {
    serialized[key] = key === 'content' ? serializeContentValue(value, rewrites) : value;
  }
  return rewritePathsDeep(serialized, rewrites) as Record<string, unknown>;
}

function serializeWorkspace(
  workspace: WorkspaceConfig,
  rewrites: ReadonlyMap<string, string>,
): Record<string, unknown> {
  const {
    workspaceFileDir: _workspaceFileDir,
    path: _path,
    mode,
    ...portableWorkspace
  } = workspace;
  const withoutStaticMode =
    mode === 'static' ? portableWorkspace : { ...portableWorkspace, ...(mode ? { mode } : {}) };
  return rewritePathsDeep(withoutStaticMode, rewrites) as Record<string, unknown>;
}

function buildPortableEvalCase(
  test: EvalTest,
  rewrites: ReadonlyMap<string, string>,
): Record<string, unknown> {
  const testCase = buildEvalCase(test, rewrites);
  testCase.id = test.id;
  testCase.input = test.input.map((message) => serializeMessage(message, rewrites));

  if (test.criteria.trim().length > 0) {
    testCase.criteria = test.criteria;
  }
  if (test.expected_output.length > 0) {
    testCase.expected_output = test.expected_output.map((message) =>
      serializeExpectedMessage(message, rewrites),
    );
  }
  if (test.workspace) {
    testCase.workspace = serializeWorkspace(test.workspace, rewrites);
  }
  if (test.metadata && Object.keys(test.metadata).length > 0) {
    testCase.metadata = rewritePathsDeep(test.metadata, rewrites);
  }
  if (test.conversation_id) {
    testCase.conversation_id = test.conversation_id;
  }
  if (test.targets && test.targets.length > 0) {
    const existingExecution = isRecord(testCase.execution) ? testCase.execution : {};
    testCase.execution = { ...existingExecution, targets: test.targets };
  }
  if (test.threshold !== undefined) {
    const existingExecution = isRecord(testCase.execution) ? testCase.execution : {};
    testCase.execution = { ...existingExecution, threshold: test.threshold };
  }
  if (test.mode) {
    testCase.mode = test.mode;
  }
  if (test.turns && test.turns.length > 0) {
    testCase.turns = rewritePathsDeep(test.turns, rewrites);
  }
  if (test.aggregation) {
    testCase.aggregation = test.aggregation;
  }
  if (test.on_turn_failure) {
    testCase.on_turn_failure = test.on_turn_failure;
  }
  if (test.window_size !== undefined) {
    testCase.window_size = test.window_size;
  }
  if (test.depends_on && test.depends_on.length > 0) {
    testCase.depends_on = test.depends_on;
  }
  if (test.on_dependency_failure) {
    testCase.on_dependency_failure = test.on_dependency_failure;
  }

  return testCase;
}

function isLikelyCommandPath(value: string): boolean {
  if (value.trim().length === 0 || value.startsWith('-') || value.includes('${{')) {
    return false;
  }
  return (
    value.startsWith('.') ||
    value.includes('/') ||
    value.includes('\\') ||
    path.extname(value).length > 0
  );
}

async function maybeWorkspaceHookCommandReference(options: {
  readonly arg: string;
  readonly baseDir: string;
  readonly testId: string;
  readonly hookName: string;
}): Promise<BundleSourceReference | undefined> {
  if (!isLikelyCommandPath(options.arg)) {
    return undefined;
  }
  const resolvedPath = path.isAbsolute(options.arg)
    ? path.resolve(options.arg)
    : path.resolve(options.baseDir, options.arg);
  const sourceStat = await stat(resolvedPath).catch(() => undefined);
  if (!sourceStat?.isFile()) {
    return undefined;
  }
  return {
    kind: 'workspace_hook_command',
    displayPath: options.arg,
    resolvedPath,
    location: `workspace.hooks.${options.hookName}.command for test "${options.testId}"`,
  };
}

async function collectWorkspaceReferences(
  tests: readonly EvalTest[],
  evalFileDir: string,
): Promise<{
  readonly references: readonly BundleSourceReference[];
  readonly errors: readonly string[];
}> {
  const references: BundleSourceReference[] = [];
  const errors: string[] = [];

  for (const test of tests) {
    const workspace = test.workspace;
    if (!workspace) {
      continue;
    }

    if (workspace.path || workspace.mode === 'static') {
      errors.push(
        `workspace.path for test "${test.id}" cannot be bundled because it points at an existing static workspace. Use workspace.template, workspace.repos, or workspace.hooks for portable bundles.`,
      );
    }

    if (workspace.template) {
      references.push({
        kind: 'workspace_template',
        displayPath: workspace.template,
        resolvedPath: workspace.template,
        location: `workspace.template for test "${test.id}"`,
      });
    }

    const hooks = workspace.hooks;
    if (!hooks) {
      continue;
    }

    for (const hookName of ['before_all', 'before_each', 'after_each', 'after_all'] as const) {
      const hook = hooks[hookName];
      const command = hook?.command ?? hook?.script;
      if (!command || command.length === 0) {
        continue;
      }
      if (hook?.cwd) {
        errors.push(
          `workspace.hooks.${hookName}.cwd for test "${test.id}" cannot be bundled safely yet: ${hook.cwd}`,
        );
        continue;
      }

      const baseDir = workspace.workspaceFileDir ?? evalFileDir;
      for (const arg of command) {
        const reference = await maybeWorkspaceHookCommandReference({
          arg,
          baseDir,
          testId: test.id,
          hookName,
        });
        if (reference) {
          references.push(reference);
        }
      }
    }
  }

  return { references, errors };
}

function collectExpectedOutputReferences(
  tests: readonly EvalTest[],
): readonly BundleSourceReference[] {
  const references: BundleSourceReference[] = [];
  for (const test of tests) {
    for (const message of test.expected_output) {
      const content = message.content;
      if (!Array.isArray(content)) {
        continue;
      }
      for (const segment of content) {
        if (!isRecord(segment) || segment.type !== 'file') {
          continue;
        }
        const resolvedPath =
          typeof segment.resolvedPath === 'string' ? path.resolve(segment.resolvedPath) : undefined;
        const displayPath =
          typeof segment.path === 'string'
            ? segment.path
            : typeof segment.value === 'string'
              ? segment.value
              : resolvedPath;
        if (!displayPath) {
          continue;
        }
        references.push({
          kind: 'expected_output_file',
          displayPath,
          ...(resolvedPath ? { resolvedPath } : {}),
          location: `expected_output file for test "${test.id}"`,
        });
      }
    }
  }
  return references;
}

function bundleManifest(options: {
  readonly outputDir: string;
  readonly evalFilePath: string;
  readonly evalPath: string;
  readonly targetsPath: string;
  readonly copiedReferences: readonly CopiedReference[];
  readonly tests: readonly EvalTest[];
  readonly targetNames: readonly string[];
  readonly createdAt: string;
}): Record<string, unknown> {
  const relative = (filePath: string) =>
    path.relative(options.outputDir, filePath).split(path.sep).join('/');
  return {
    schema_version: 1,
    created_at: options.createdAt,
    source_eval: options.evalFilePath,
    eval_path: relative(options.evalPath),
    targets_path: relative(options.targetsPath),
    test_count: options.tests.length,
    targets: options.targetNames,
    ...(hasCopiedBucket(options.copiedReferences, 'files') ? { files_path: 'evals/files' } : {}),
    ...(hasCopiedBucket(options.copiedReferences, 'graders')
      ? { graders_path: 'evals/graders' }
      : {}),
    ...(hasCopiedBucket(options.copiedReferences, 'workspaces')
      ? { workspaces_path: 'evals/workspaces' }
      : {}),
    ...(hasCopiedBucket(options.copiedReferences, 'scripts')
      ? { scripts_path: 'evals/scripts' }
      : {}),
  };
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

/**
 * Materialize a whole eval suite as a portable directory.
 *
 * This reuses the same source snapshots, dependency copying, path rewriting,
 * target slicing, and secret redaction used by per-result task bundles. The
 * output eval is intentionally explicit: inherited suite defaults are written
 * onto each bundled test case so the bundle can run without the source tree.
 */
export async function materializeEvalBundle(
  options: MaterializeEvalBundleOptions,
): Promise<MaterializedEvalBundlePaths> {
  if (options.tests.length === 0) {
    throw new Error('Cannot bundle eval with no runnable tests.');
  }
  if (options.targetSelections.length === 0) {
    throw new Error('Cannot bundle eval without a selected target.');
  }

  const missingSource = options.tests.find((test) => !test.source);
  if (missingSource) {
    throw new Error(
      `Cannot bundle test "${missingSource.id}" because it has no source metadata. YAML evals are supported; programmatic evals with inline functions are not portable yet.`,
    );
  }

  const outputDir = path.resolve(options.outputDir);
  const evalsDir = path.join(outputDir, BUNDLE_EVALS_DIRNAME);
  await mkdir(evalsDir, { recursive: true });

  const evalFileDir = path.dirname(path.resolve(options.evalFilePath));
  const workspaceReferences = await collectWorkspaceReferences(options.tests, evalFileDir);
  const references: BundleSourceReference[] = [
    ...options.tests.flatMap((test) => test.source?.references ?? []),
    ...collectExpectedOutputReferences(options.tests),
    ...workspaceReferences.references,
  ];

  const { copied, failures } = await copyReferencesStrict(references, evalsDir, options);
  const errors = [...workspaceReferences.errors, ...failures.map((failure) => failure.reason)];
  if (errors.length > 0) {
    throw new Error(`Cannot bundle eval:\n${errors.map((error) => `- ${error}`).join('\n')}`);
  }

  const rewrites = buildPathRewrites(copied);
  const targetNames = uniqueTargetNames(options.targetSelections);
  const evalPath = path.join(evalsDir, bundledEvalFileName(options.evalFilePath));
  const targetsPath = path.join(outputDir, BUNDLE_TARGETS_FILENAME);
  const manifestPath = path.join(outputDir, BUNDLE_MANIFEST_FILENAME);
  const execution =
    options.execution ??
    (targetNames.length === 1 ? { target: targetNames[0] } : { targets: targetNames });

  await writeYamlFile(evalPath, {
    execution,
    tests: options.tests.map((test) => buildPortableEvalCase(test, rewrites)),
  });
  await writeYamlFile(targetsPath, {
    targets: uniqueTargetDefinitions(options.targetSelections),
  });

  const manifest = bundleManifest({
    outputDir,
    evalFilePath: path.resolve(options.evalFilePath),
    evalPath,
    targetsPath,
    copiedReferences: copied,
    tests: options.tests,
    targetNames,
    createdAt: (options.now ?? (() => new Date()))().toISOString(),
  });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return {
    bundleDir: outputDir,
    evalsDir,
    evalPath,
    targetsPath,
    manifestPath,
    ...(hasCopiedBucket(copied, 'files')
      ? { filesPath: path.join(evalsDir, TASK_FILES_DIRNAME) }
      : {}),
    ...(hasCopiedBucket(copied, 'graders')
      ? { gradersPath: path.join(evalsDir, TASK_GRADERS_DIRNAME) }
      : {}),
    ...(hasCopiedBucket(copied, 'workspaces')
      ? { workspacesPath: path.join(evalsDir, BUNDLE_WORKSPACES_DIRNAME) }
      : {}),
    ...(hasCopiedBucket(copied, 'scripts')
      ? { scriptsPath: path.join(evalsDir, BUNDLE_SCRIPTS_DIRNAME) }
      : {}),
  };
}
