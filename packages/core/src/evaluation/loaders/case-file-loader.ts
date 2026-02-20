import { readFile } from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import { parse as parseYaml } from 'yaml';

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
  const parsed = parseYaml(content) as unknown;
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
      const parsed = JSON.parse(line) as unknown;
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
    const matches = await fg(absolutePattern, {
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
