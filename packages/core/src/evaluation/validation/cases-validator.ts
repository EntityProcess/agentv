import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { parseYamlValue } from '../yaml-loader.js';
import type { ValidationError, ValidationResult } from './types.js';

type JsonValue = string | number | boolean | null | JsonObject | JsonArray;
type JsonObject = { readonly [key: string]: JsonValue };
type JsonArray = readonly JsonValue[];

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate a cases file — a YAML file whose root is an array of test case objects.
 *
 * Cases files are referenced from eval files via `tests: path/to/cases.yaml` or
 * `file://cases/accuracy.yaml` entries in the tests array. Each item must have
 * at least an `id` (non-empty string) and an `input` (string or array).
 */
export async function validateCasesFile(filePath: string): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  const absolutePath = path.resolve(filePath);

  let parsed: unknown;
  try {
    const content = await readFile(absolutePath, 'utf8');
    parsed = parseYamlValue(content);
  } catch (error) {
    errors.push({
      severity: 'error',
      filePath: absolutePath,
      message: `Failed to parse YAML: ${(error as Error).message}`,
    });
    return { valid: false, filePath: absolutePath, fileType: 'cases', errors };
  }

  if (!Array.isArray(parsed)) {
    errors.push({
      severity: 'error',
      filePath: absolutePath,
      message: 'Cases file must contain a YAML array of test case objects',
    });
    return { valid: false, filePath: absolutePath, fileType: 'cases', errors };
  }

  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i];
    const location = `[${i}]`;

    if (!isObject(item)) {
      errors.push({
        severity: 'error',
        filePath: absolutePath,
        location,
        message: 'Each test case must be an object',
      });
      continue;
    }

    // Required: id
    const id = item.id;
    if (typeof id !== 'string' || id.trim().length === 0) {
      errors.push({
        severity: 'error',
        filePath: absolutePath,
        location: `${location}.id`,
        message: "Missing or invalid 'id' field (must be a non-empty string)",
      });
    }

    // Required: input
    const input = item.input;
    if (input === undefined) {
      errors.push({
        severity: 'error',
        filePath: absolutePath,
        location: `${location}.input`,
        message: "Missing 'input' field (must be a string or array of messages)",
      });
    } else if (typeof input !== 'string' && !Array.isArray(input)) {
      errors.push({
        severity: 'error',
        filePath: absolutePath,
        location: `${location}.input`,
        message: "Invalid 'input' field (must be a string or array of messages)",
      });
    }
  }

  return {
    valid: errors.filter((e) => e.severity === 'error').length === 0,
    filePath: absolutePath,
    fileType: 'cases',
    errors,
  };
}
