import { readFile } from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';

import { interpolateEnv } from '../interpolation.js';
import type { JsonObject, JsonValue } from '../types.js';
import { isJsonObject } from '../types.js';
import { parseYamlValue } from '../yaml-loader.js';

const ANSI_YELLOW = '\u001b[33m';
const ANSI_RESET = '\u001b[0m';
const FILE_PROTOCOL = 'file://';

export function isScenarioFileReference(value: JsonValue): value is string {
  return typeof value === 'string' && value.startsWith(FILE_PROTOCOL);
}

function stripFileProtocol(value: string): string {
  return value.startsWith(FILE_PROTOCOL) ? value.slice(FILE_PROTOCOL.length) : value;
}

function isGlobPattern(filePath: string): boolean {
  return filePath.includes('*') || filePath.includes('?') || filePath.includes('{');
}

function parseScenarioFileValue(value: unknown, filePath: string): JsonObject[] {
  const parsed = interpolateEnv(value, process.env);
  const rawScenarios = Array.isArray(parsed)
    ? parsed
    : isJsonObject(parsed) && Array.isArray(parsed.scenarios)
      ? parsed.scenarios
      : undefined;

  if (!rawScenarios) {
    throw new Error(
      `External scenario file must contain a scenario array or an object with a scenarios array: ${filePath}`,
    );
  }

  return rawScenarios.map((scenario, index) => {
    if (!isJsonObject(scenario)) {
      throw new Error(
        `External scenario file contains non-object entry at index ${index}: ${filePath}`,
      );
    }
    return scenario;
  });
}

export async function loadScenariosFromFile(filePath: string): Promise<JsonObject[]> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read external scenario file: ${filePath}\n  ${message}`);
  }

  if (content.trim() === '') {
    console.warn(
      `${ANSI_YELLOW}Warning: External scenario file is empty, skipping: ${filePath}${ANSI_RESET}`,
    );
    return [];
  }

  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.yaml' || ext === '.yml') {
    return parseScenarioFileValue(parseYamlValue(content), filePath);
  }
  if (ext === '.json') {
    try {
      return parseScenarioFileValue(JSON.parse(content) as unknown, filePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Malformed JSON scenario file: ${message}\n  File: ${filePath}`);
    }
  }

  throw new Error(
    `Unsupported external scenario file format '${ext}': ${filePath}. Supported: .json, .yaml, .yml`,
  );
}

export async function resolveScenarioFileReference(
  ref: string,
  evalFileDir: string,
): Promise<JsonObject[]> {
  const rawPath = stripFileProtocol(ref);
  const absolutePattern = path.resolve(evalFileDir, rawPath);

  if (isGlobPattern(rawPath)) {
    const matches = (
      await fg(absolutePattern.replaceAll('\\', '/'), {
        onlyFiles: true,
        absolute: true,
      })
    ).sort();

    if (matches.length === 0) {
      console.warn(
        `${ANSI_YELLOW}Warning: Glob pattern matched no scenario files: ${ref} (resolved to ${absolutePattern})${ANSI_RESET}`,
      );
      return [];
    }

    const scenarios: JsonObject[] = [];
    for (const match of matches) {
      scenarios.push(...(await loadScenariosFromFile(match)));
    }
    return scenarios;
  }

  return loadScenariosFromFile(absolutePattern);
}

export async function expandScenarioReferences(
  scenarios: readonly JsonValue[],
  evalFileDir: string,
): Promise<JsonValue[]> {
  const expanded: JsonValue[] = [];
  for (const scenario of scenarios) {
    if (isScenarioFileReference(scenario)) {
      expanded.push(...(await resolveScenarioFileReference(scenario, evalFileDir)));
    } else {
      expanded.push(scenario);
    }
  }
  return expanded;
}
