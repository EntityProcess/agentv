import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import { parse as parseYaml } from 'yaml';

import { interpolateEnv } from '../interpolation.js';
import type { JsonObject, JsonValue } from '../types.js';
import { isJsonObject } from '../types.js';

const ANSI_YELLOW = '\u001b[33m';
const ANSI_RESET = '\u001b[0m';

const FILE_PROTOCOL = 'file://';

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
  const raw = parseYaml(content) as unknown;
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

/**
 * Load test objects from a single external file (YAML or JSONL).
 */
export async function loadCasesFromFile(filePath: string): Promise<JsonObject[]> {
  const ext = path.extname(filePath).toLowerCase();
  let content: string;

  try {
    content = await readFile(filePath, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read external test file: ${filePath}\n  ${message}`);
  }

  if (content.trim() === '') {
    console.warn(
      `${ANSI_YELLOW}Warning: External test file is empty, skipping: ${filePath}${ANSI_RESET}`,
    );
    return [];
  }

  if (ext === '.yaml' || ext === '.yml') {
    return parseYamlCases(content, filePath);
  }
  if (ext === '.jsonl') {
    return parseJsonlCases(content, filePath);
  }

  throw new Error(
    `Unsupported external test file format '${ext}': ${filePath}. Supported: .yaml, .yml, .jsonl`,
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
  const rawPath = extractFilePath(ref);
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
  const subdirs = entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));

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

    const raw = parseYaml(content) as unknown;
    const parsed = interpolateEnv(raw, process.env);
    if (!isJsonObject(parsed)) {
      throw new Error(
        `Case file must contain a YAML object, got ${typeof parsed}: ${caseFilePath}`,
      );
    }

    const caseObj = { ...parsed };

    // Inject id from directory name if not specified
    if (!caseObj.id) {
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
