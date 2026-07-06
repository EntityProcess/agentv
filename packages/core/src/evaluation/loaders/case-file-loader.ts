import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import fg from 'fast-glob';

import { execFileWithStdin } from '../../runtime/exec.js';
import { interpolateEnv } from '../interpolation.js';
import type { JsonObject, JsonValue } from '../types.js';
import { isJsonObject } from '../types.js';
import { parseYamlValue } from '../yaml-loader.js';

const ANSI_YELLOW = '\u001b[33m';
const ANSI_RESET = '\u001b[0m';

const FILE_PROTOCOL = 'file://';
const DATASET_SCRIPT_TIMEOUT_MS = 30_000;
const DEFAULT_THRESHOLD = 0.75;
const THRESHOLD_ASSERTION_TYPES = new Set(['starts-with']);
const SUPPORTED_ASSERTION_TYPES = new Set([
  'contains',
  'contains-any',
  'contains-all',
  'icontains',
  'icontains-any',
  'icontains-all',
  'starts-with',
  'ends-with',
  'regex',
  'is-json',
  'equals',
  'latency',
  'cost',
]);

/**
 * Check if a value in the tests array is a file:// reference string.
 */
export function isFileReference(value: JsonValue): value is string {
  return typeof value === 'string' && value.startsWith(FILE_PROTOCOL);
}

/**
 * Extract the path portion from a file:// reference.
 */
function extractFilePath(ref: string): string {
  return ref.slice(FILE_PROTOCOL.length);
}

function stripFileProtocol(value: string): string {
  return value.startsWith(FILE_PROTOCOL) ? extractFilePath(value) : value;
}

/**
 * Check if a path contains glob pattern characters.
 */
function isGlobPattern(filePath: string): boolean {
  return filePath.includes('*') || filePath.includes('?') || filePath.includes('{');
}

/**
 * Parse test objects from a YAML file.
 * Expects the file to contain an array of test objects.
 */
function parseYamlCases(content: string, filePath: string): JsonObject[] {
  const raw = parseYamlValue(content);
  const parsed = interpolateEnv(raw, process.env);
  if (!Array.isArray(parsed)) {
    throw new Error(
      `External test file must contain a YAML array, got ${typeof parsed}: ${filePath}`,
    );
  }
  const results: JsonObject[] = [];
  for (const item of parsed) {
    if (!isJsonObject(item)) {
      throw new Error(`External test file contains non-object entry: ${filePath}`);
    }
    results.push(item);
  }
  return results;
}

/**
 * Parse test objects from a JSONL file.
 * Each non-empty line must be a valid JSON object.
 */
function parseJsonlCases(content: string, filePath: string): JsonObject[] {
  const lines = content.split('\n');
  const results: JsonObject[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue;

    try {
      const raw = JSON.parse(line) as unknown;
      const parsed = interpolateEnv(raw, process.env);
      if (!isJsonObject(parsed)) {
        throw new Error('Expected JSON object');
      }
      results.push(parsed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Malformed JSONL at line ${i + 1}: ${message}\n  File: ${filePath}`);
    }
  }

  return results;
}

function assertJsonCases(value: unknown, filePath: string): JsonObject[] {
  const parsed = interpolateEnv(value, process.env);
  const rawCases = Array.isArray(parsed)
    ? parsed
    : isJsonObject(parsed) && Array.isArray(parsed.tests)
      ? parsed.tests
      : undefined;
  if (!rawCases) {
    throw new Error(`External test file must contain an array of test objects: ${filePath}`);
  }
  return rawCases.map((item, index) => {
    if (!isJsonObject(item)) {
      throw new Error(
        `External test file contains non-object entry at index ${index}: ${filePath}`,
      );
    }
    return item;
  });
}

function parseJsonCases(content: string, filePath: string): JsonObject[] {
  try {
    return assertJsonCases(JSON.parse(content) as unknown, filePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Malformed JSON test file: ${message}\n  File: ${filePath}`);
  }
}

function parseCsvRows(content: string, filePath: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let rowStart = true;
  const source = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;

  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        index++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"' && cell === '') {
      inQuotes = true;
      rowStart = false;
      continue;
    }
    if (char === ',') {
      row.push(cell);
      cell = '';
      rowStart = false;
      continue;
    }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && next === '\n') {
        index++;
      }
      row.push(cell);
      if (!rowStart || row.some((value) => value.length > 0)) {
        rows.push(row);
      }
      row = [];
      cell = '';
      rowStart = true;
      continue;
    }
    cell += char;
    rowStart = false;
  }

  if (inQuotes) {
    throw new Error(`Malformed CSV test file: unterminated quoted cell\n  File: ${filePath}`);
  }
  if (!rowStart || cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((values) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (header.length > 0) {
        record[header] = values[index] ?? '';
      }
    });
    return record;
  });
}

function parseAssertionFromString(expected: string, sourceFilePath: string): JsonObject {
  if (expected.startsWith('grade:') || expected.startsWith('llm-rubric:')) {
    const value = expected.slice(expected.startsWith('grade:') ? 6 : 11).trim();
    return {
      type: 'llm-grader',
      rubrics: [{ id: 'rubric', outcome: value, weight: 1 }],
    };
  }
  const functionPrefixes = ['javascript:', 'fn:', 'eval:'];
  const functionPrefix = functionPrefixes.find((prefix) => expected.startsWith(prefix));
  if (functionPrefix) {
    return {
      type: 'inline-assert',
      code: expected.slice(functionPrefix.length).trim(),
    };
  }
  if (expected.startsWith('python:')) {
    return {
      type: 'script',
      command: ['uv', 'run', 'python', expected.slice('python:'.length).trim()],
    };
  }
  if (expected.startsWith(FILE_PROTOCOL)) {
    const filePath = stripFileProtocol(expected).trim();
    if (!filePath.endsWith('.py')) {
      throw new Error(
        `Unsupported promptfoo __expected file assertion "${expected}". Only file://*.py script graders are supported.`,
      );
    }
    const commandPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(path.dirname(sourceFilePath), filePath);
    return {
      type: 'script',
      command: ['uv', 'run', 'python', commandPath],
    };
  }

  const regexMatch = expected.match(
    /^((?:not-)?[a-z][a-z0-9-]*)(?:\((\d+(?:\.\d+)?)\))?(?::([\s\S]*))?$/,
  );
  if (regexMatch) {
    const [, rawType, thresholdText, rawValue] = regexMatch;
    const negate = rawType.startsWith('not-');
    const type = negate ? rawType.slice('not-'.length) : rawType;
    const value = rawValue?.trim();
    const parsedThreshold = thresholdText ? Number.parseFloat(thresholdText) : undefined;
    const threshold =
      parsedThreshold !== undefined && Number.isFinite(parsedThreshold)
        ? parsedThreshold
        : THRESHOLD_ASSERTION_TYPES.has(type)
          ? DEFAULT_THRESHOLD
          : undefined;
    if (!SUPPORTED_ASSERTION_TYPES.has(type)) {
      if (rawValue !== undefined || thresholdText !== undefined) {
        throw new Error(
          `Unsupported promptfoo __expected assertion "${type}". Supported assertion types: ${[
            ...SUPPORTED_ASSERTION_TYPES,
          ].join(', ')}`,
        );
      }
      return { type: 'equals', value: expected };
    }
    if ((type === 'latency' || type === 'cost') && threshold === undefined) {
      throw new Error(
        `promptfoo __expected ${type} assertion requires a numeric limit, e.g. ${type}(1)`,
      );
    }
    const assertion: Record<string, JsonValue> = {
      type,
    };
    if (negate) {
      assertion.negate = true;
    }
    if (
      type === 'contains-any' ||
      type === 'contains-all' ||
      type === 'icontains-any' ||
      type === 'icontains-all'
    ) {
      assertion.value = value ? value.split(',').map((item) => item.trim()) : [];
    } else if (value !== undefined) {
      assertion.value = value;
    }
    if (type === 'latency' && threshold !== undefined) {
      assertion.threshold = threshold;
    } else if (type === 'cost' && threshold !== undefined) {
      assertion.budget = threshold;
    } else if (threshold !== undefined) {
      assertion.min_score = threshold;
    }
    return assertion;
  }

  return { type: 'equals', value: expected };
}

function parseMetadataValue(key: string, value: string): JsonValue | undefined {
  if (value.trim() === '') {
    return undefined;
  }
  if (key.endsWith('[]')) {
    return value
      .split(/(?<!\\),/)
      .map((item) => item.trim().replaceAll('\\,', ','))
      .filter((item) => item.length > 0);
  }
  return value;
}

function assignCsvVar(vars: Record<string, JsonValue>, key: string, value: string): void {
  if (!key.startsWith('vars.')) {
    vars[key] = value;
    return;
  }

  const path = key
    .slice('vars.'.length)
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (path.length === 0) {
    vars[key] = value;
    return;
  }

  let current: Record<string, JsonValue> = vars;
  for (const segment of path.slice(0, -1)) {
    const existing = current[segment];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, JsonValue>;
  }
  current[path[path.length - 1] as string] = value;
}

function parseCsvCases(content: string, filePath: string): JsonObject[] {
  return parseCsvRows(content, filePath).map((row, rowIndex) => {
    const vars: Record<string, JsonValue> = {};
    const metadata: Record<string, JsonValue> = {};
    const assertions: JsonObject[] = [];
    const assertionConfigs = new Map<number, Record<string, JsonValue>>();
    let id: string | undefined;
    let input: string | undefined;
    let prefix = '';
    let suffix = '';
    let criteria: string | undefined;
    let metric: string | undefined;
    let threshold: number | undefined;

    for (const [rawKey, rawValue] of Object.entries(row)) {
      const key = rawKey.trim();
      const value = rawValue;
      if (key === 'id') {
        id = value;
      } else if (key === 'input') {
        input = value;
      } else if (key.startsWith('__expected')) {
        if (value.trim() !== '') {
          assertions.push(parseAssertionFromString(value.trim(), filePath));
        }
      } else if (key === '__prefix') {
        prefix = value;
      } else if (key === '__suffix') {
        suffix = value;
      } else if (key === '__description') {
        criteria = value;
      } else if (key === '__provider_output' || key === '__providerOutput') {
        throw new Error(
          `${key} has been removed from CSV imports. Use an explicit deterministic target such as provider: cli for fixed outputs, or use a replay/fixture target for captured provider responses.`,
        );
      } else if (key === '__metric') {
        metric = value;
      } else if (key === '__threshold') {
        const parsedThreshold = Number.parseFloat(value);
        if (Number.isFinite(parsedThreshold)) {
          threshold = parsedThreshold;
        }
      } else if (key.startsWith('__metadata:')) {
        const metadataKey = key.slice('__metadata:'.length);
        const parsed = parseMetadataValue(metadataKey, value);
        if (parsed !== undefined) {
          metadata[metadataKey.endsWith('[]') ? metadataKey.slice(0, -2) : metadataKey] = parsed;
        }
      } else if (key.startsWith('__config:')) {
        const [expectedKey, configKey] = key.slice('__config:'.length).split(':');
        if (configKey !== 'threshold') {
          throw new Error(`Invalid config key "${configKey}" in __config column: ${filePath}`);
        }
        const targetIndex =
          expectedKey === '__expected'
            ? 0
            : /^__expected\d+$/.test(expectedKey)
              ? Number.parseInt(expectedKey.slice('__expected'.length), 10) - 1
              : undefined;
        if (targetIndex === undefined || targetIndex < 0) {
          throw new Error(`Invalid expected key "${expectedKey}" in __config column: ${filePath}`);
        }
        const parsedThreshold = Number.parseFloat(value);
        if (!Number.isFinite(parsedThreshold)) {
          throw new Error(`Invalid numeric value for ${configKey} in __config column: ${filePath}`);
        }
        assertionConfigs.set(targetIndex, { [configKey]: parsedThreshold });
      } else if (key.length > 0) {
        assignCsvVar(vars, key, value);
      }
    }

    const caseInput = input !== undefined ? `${prefix}${input}${suffix}` : undefined;
    assertions.forEach((assertion, index) => {
      if (metric) {
        (assertion as Record<string, JsonValue>).metric = metric;
        (assertion as Record<string, JsonValue>).name =
          assertions.length === 1 ? metric : `${metric}-${index + 1}`;
      }
      const config = assertionConfigs.get(index);
      if (config?.threshold !== undefined) {
        (assertion as Record<string, JsonValue>).min_score = config.threshold;
        metadata.threshold = config.threshold;
      }
    });

    return {
      id: id && id.trim() !== '' ? id : `row-${rowIndex + 1}`,
      ...(caseInput !== undefined ? { input: caseInput } : {}),
      ...(criteria ? { criteria } : {}),
      ...(assertions.length > 0 ? { assert: assertions } : {}),
      ...(threshold !== undefined ? { threshold } : {}),
      ...(threshold !== undefined ? { execution: { threshold } } : {}),
      ...(Object.keys(vars).length > 0 ? { vars } : {}),
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    };
  });
}

function parseDatasetFunctionReference(filePath: string): {
  readonly scriptPath: string;
  readonly functionName?: string;
} {
  const extensionMatch = filePath.match(/\.(?:mjs|cjs|js|py)(?::([^/\\:]+))?$/i);
  if (!extensionMatch) {
    return { scriptPath: filePath };
  }
  return {
    scriptPath: filePath.slice(
      0,
      filePath.length - (extensionMatch[1]?.length ?? 0) - (extensionMatch[1] ? 1 : 0),
    ),
    ...(extensionMatch[1] ? { functionName: extensionMatch[1] } : {}),
  };
}

async function loadCasesFromJavaScriptFunction(
  scriptPath: string,
  functionName: string | undefined,
): Promise<JsonObject[]> {
  const module = (await import(pathToFileURL(scriptPath).href)) as Record<string, unknown>;
  const candidate = functionName ? module[functionName] : (module.default ?? module.createTests);
  if (typeof candidate !== 'function') {
    throw new Error(
      `JavaScript dataset file must export function '${functionName ?? 'default or createTests'}': ${scriptPath}`,
    );
  }
  return assertJsonCases(await candidate(), scriptPath);
}

async function loadCasesFromPythonFunction(
  scriptPath: string,
  functionName: string | undefined,
): Promise<JsonObject[]> {
  const harness = [
    'import importlib.util, json, pathlib, sys',
    'script_path = pathlib.Path(sys.argv[1]).resolve()',
    'function_name = sys.argv[2]',
    'spec = importlib.util.spec_from_file_location("agentv_dataset_module", script_path)',
    'module = importlib.util.module_from_spec(spec)',
    'assert spec and spec.loader',
    'spec.loader.exec_module(module)',
    'fn = getattr(module, function_name)',
    'print(json.dumps(fn()))',
  ].join('\n');
  const { stdout, stderr, exitCode } = await runPythonDatasetHarness(
    harness,
    scriptPath,
    functionName ?? 'create_tests',
  );
  if (exitCode !== 0) {
    throw new Error(`Python dataset function failed: ${scriptPath}\n${stderr.trim()}`);
  }
  return parseJsonCases(stdout, scriptPath);
}

async function runPythonDatasetHarness(
  harness: string,
  scriptPath: string,
  functionName: string,
): Promise<{
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}> {
  const cwd = path.dirname(scriptPath);
  const args = ['-c', harness, scriptPath, functionName];
  const commands = [
    ['uv', 'run', 'python', ...args],
    ['python3', ...args],
    ['python', ...args],
  ];
  let lastMissingError: unknown;

  for (const command of commands) {
    try {
      return await execFileWithStdin(command, '', {
        cwd,
        timeoutMs: DATASET_SCRIPT_TIMEOUT_MS,
      });
    } catch (error) {
      if (!isMissingExecutableError(error)) {
        throw error;
      }
      lastMissingError = error;
    }
  }

  const message =
    lastMissingError instanceof Error ? lastMissingError.message : String(lastMissingError);
  throw new Error(`Python dataset function failed: no Python runner available\n${message}`);
}

function isMissingExecutableError(error: unknown): boolean {
  if (!isJsonObjectLike(error)) {
    return false;
  }
  return error.code === 'ENOENT';
}

function isJsonObjectLike(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null;
}

/**
 * Load test objects from a single external file (YAML or JSONL).
 */
export async function loadCasesFromFile(filePath: string): Promise<JsonObject[]> {
  const { scriptPath, functionName } = parseDatasetFunctionReference(filePath);
  const ext = path.extname(scriptPath).toLowerCase();
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
    return loadCasesFromJavaScriptFunction(scriptPath, functionName);
  }
  if (ext === '.py') {
    return loadCasesFromPythonFunction(scriptPath, functionName);
  }

  let content: string;

  try {
    content = await readFile(scriptPath, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read external test file: ${scriptPath}\n  ${message}`);
  }

  if (content.trim() === '') {
    console.warn(
      `${ANSI_YELLOW}Warning: External test file is empty, skipping: ${scriptPath}${ANSI_RESET}`,
    );
    return [];
  }

  if (ext === '.yaml' || ext === '.yml') {
    return parseYamlCases(content, scriptPath);
  }
  if (ext === '.jsonl') {
    return parseJsonlCases(content, scriptPath);
  }
  if (ext === '.json') {
    return parseJsonCases(content, scriptPath);
  }
  if (ext === '.csv') {
    return parseCsvCases(content, scriptPath);
  }

  throw new Error(
    `Unsupported external test file format '${ext}': ${scriptPath}. Supported: .csv, .json, .jsonl, .yaml, .yml, .js, .mjs, .cjs, .py`,
  );
}

/**
 * Resolve a file:// reference to test objects.
 * Handles both direct file paths and glob patterns.
 * Paths are resolved relative to the eval file directory.
 */
export async function resolveFileReference(
  ref: string,
  evalFileDir: string,
): Promise<JsonObject[]> {
  const rawPath = stripFileProtocol(ref);
  const absolutePattern = path.resolve(evalFileDir, rawPath);

  if (isGlobPattern(rawPath)) {
    // Glob pattern: resolve matching files
    // fast-glob requires forward slashes, even on Windows
    const matches = await fg(absolutePattern.replaceAll('\\', '/'), {
      onlyFiles: true,
      absolute: true,
    });

    if (matches.length === 0) {
      console.warn(
        `${ANSI_YELLOW}Warning: Glob pattern matched no files: ${ref} (resolved to ${absolutePattern})${ANSI_RESET}`,
      );
      return [];
    }

    // Sort for deterministic order
    matches.sort();

    const allCases: JsonObject[] = [];
    for (const match of matches) {
      const cases = await loadCasesFromFile(match);
      allCases.push(...cases);
    }
    return allCases;
  }

  // Direct file path
  return loadCasesFromFile(absolutePattern);
}

/**
 * Load test cases from a directory structure.
 * Scans immediate subdirectories for case.yaml/case.yml files.
 * Each subdirectory becomes a test case, with the directory name used as `id`
 * if the case file doesn't specify one. A `workspace/` subdirectory in the
 * case directory sets the workspace template automatically.
 */
export async function loadCasesFromDirectory(dirPath: string): Promise<JsonObject[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const subdirs = entries
    .filter((e) => e.isDirectory())
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const results: JsonObject[] = [];
  for (const subdir of subdirs) {
    const subdirPath = path.join(dirPath, subdir.name);

    // Look for case.yaml or case.yml
    let caseFilePath: string | undefined;
    for (const filename of ['case.yaml', 'case.yml']) {
      const candidate = path.join(subdirPath, filename);
      try {
        const s = await stat(candidate);
        if (s.isFile()) {
          caseFilePath = candidate;
          break;
        }
      } catch {
        // File doesn't exist, try next
      }
    }

    if (!caseFilePath) {
      console.warn(
        `${ANSI_YELLOW}Warning: Skipping directory '${subdir.name}' — no case.yaml found${ANSI_RESET}`,
      );
      continue;
    }

    // Parse case.yaml as a single object (not array)
    let content: string;
    try {
      content = await readFile(caseFilePath, 'utf8');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Cannot read case file: ${caseFilePath}\n  ${message}`);
    }

    const raw = parseYamlValue(content);
    const parsed = interpolateEnv(raw, process.env);
    if (!isJsonObject(parsed)) {
      throw new Error(
        `Case file must contain a YAML object, got ${typeof parsed}: ${caseFilePath}`,
      );
    }

    const caseObj = { ...parsed };

    // Inject id from directory name if not specified
    if (caseObj.id === undefined || caseObj.id === null) {
      caseObj.id = subdir.name;
    }

    // Check for workspace/ subdirectory
    if (!caseObj.workspace) {
      const workspaceDirPath = path.join(subdirPath, 'workspace');
      try {
        const s = await stat(workspaceDirPath);
        if (s.isDirectory()) {
          caseObj.workspace = { template: workspaceDirPath };
        }
      } catch {
        // No workspace directory, that's fine
      }
    }

    results.push(caseObj);
  }

  return results;
}

/**
 * Process a tests array, expanding any file:// references into inline test objects.
 * Returns a flat array of JsonValue where all file:// strings are replaced
 * with the test objects loaded from the referenced files.
 */
export async function expandFileReferences(
  tests: readonly JsonValue[],
  evalFileDir: string,
): Promise<JsonValue[]> {
  const expanded: JsonValue[] = [];

  for (const entry of tests) {
    if (isFileReference(entry)) {
      const cases = await resolveFileReference(entry, evalFileDir);
      expanded.push(...cases);
    } else {
      expanded.push(entry);
    }
  }

  return expanded;
}
