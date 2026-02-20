import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';

import { isEvaluatorKind } from '../types.js';
import type { ValidationError, ValidationResult } from './types.js';

type JsonValue = string | number | boolean | null | JsonObject | JsonArray;
type JsonObject = { readonly [key: string]: JsonValue };
type JsonArray = readonly JsonValue[];

/** Assertion evaluator types that require a `value` field. */
const ASSERTION_TYPES_WITH_VALUE = new Set(['contains', 'equals', 'regex']);

/** Valid file extensions for external test files. */
const VALID_TEST_FILE_EXTENSIONS = new Set(['.yaml', '.yml', '.jsonl']);

/** Name field pattern: lowercase alphanumeric with hyphens. */
const NAME_PATTERN = /^[a-z0-9-]+$/;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate an eval file (agentv-eval-v2 schema).
 */
export async function validateEvalFile(filePath: string): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  const absolutePath = path.resolve(filePath);

  let parsed: unknown;
  try {
    const content = await readFile(absolutePath, 'utf8');
    parsed = parse(content);
  } catch (error) {
    errors.push({
      severity: 'error',
      filePath: absolutePath,
      message: `Failed to parse YAML: ${(error as Error).message}`,
    });
    return {
      valid: false,
      filePath: absolutePath,
      fileType: 'eval',
      errors,
    };
  }

  if (!isObject(parsed)) {
    errors.push({
      severity: 'error',
      filePath: absolutePath,
      message: 'File must contain a YAML object',
    });
    return {
      valid: false,
      filePath: absolutePath,
      fileType: 'eval',
      errors,
    };
  }

  // Validate metadata fields
  validateMetadata(parsed, absolutePath, errors);

  // Resolve tests with backward-compat aliases
  let cases: JsonValue | undefined = parsed.tests;
  if (cases === undefined && 'eval_cases' in parsed) {
    cases = parsed.eval_cases;
    errors.push({
      severity: 'warning',
      filePath: absolutePath,
      location: 'eval_cases',
      message: "'eval_cases' is deprecated. Use 'tests' instead.",
    });
  }
  if (cases === undefined && 'evalcases' in parsed) {
    cases = parsed.evalcases;
    errors.push({
      severity: 'warning',
      filePath: absolutePath,
      location: 'evalcases',
      message: "'evalcases' is deprecated. Use 'tests' instead.",
    });
  }

  // tests can be a string path (external file reference) or an array
  if (typeof cases === 'string') {
    validateTestsStringPath(cases, absolutePath, errors);
    return {
      valid: errors.filter((e) => e.severity === 'error').length === 0,
      filePath: absolutePath,
      fileType: 'eval',
      errors,
    };
  }

  if (!Array.isArray(cases)) {
    errors.push({
      severity: 'error',
      filePath: absolutePath,
      location: 'tests',
      message: "Missing or invalid 'tests' field (must be an array or a file path string)",
    });
    return {
      valid: errors.length === 0,
      filePath: absolutePath,
      fileType: 'eval',
      errors,
    };
  }

  // Validate each eval case
  for (let i = 0; i < cases.length; i++) {
    const evalCase = cases[i];
    const location = `tests[${i}]`;

    if (!isObject(evalCase)) {
      errors.push({
        severity: 'error',
        filePath: absolutePath,
        location,
        message: 'Eval case must be an object',
      });
      continue;
    }

    // Required fields: id, input
    const id = evalCase.id;
    if (typeof id !== 'string' || id.trim().length === 0) {
      errors.push({
        severity: 'error',
        filePath: absolutePath,
        location: `${location}.id`,
        message: "Missing or invalid 'id' field (must be a non-empty string)",
      });
    }

    // Optional: criteria (with backward-compat alias expected_outcome)
    let criteria: JsonValue | undefined = evalCase.criteria;
    if (criteria === undefined && 'expected_outcome' in evalCase) {
      criteria = evalCase.expected_outcome;
      errors.push({
        severity: 'warning',
        filePath: absolutePath,
        location: `${location}.expected_outcome`,
        message: "'expected_outcome' is deprecated. Use 'criteria' instead.",
      });
    }
    if (criteria !== undefined && (typeof criteria !== 'string' || criteria.trim().length === 0)) {
      errors.push({
        severity: 'error',
        filePath: absolutePath,
        location: `${location}.criteria`,
        message: "Invalid 'criteria' field (must be a non-empty string if provided)",
      });
    }

    // input field (string shorthand or message array)
    const inputField = evalCase.input;
    if (inputField !== undefined) {
      if (typeof inputField === 'string') {
        // String shorthand is valid - no further validation needed
      } else if (Array.isArray(inputField)) {
        validateMessages(inputField, `${location}.input`, absolutePath, errors);
      } else {
        errors.push({
          severity: 'error',
          filePath: absolutePath,
          location: `${location}.input`,
          message: "Invalid 'input' field (must be a string or array of messages)",
        });
      }
    } else {
      errors.push({
        severity: 'error',
        filePath: absolutePath,
        location: `${location}.input`,
        message: "Missing 'input' field (must be a string or array of messages)",
      });
    }

    // expected_output field (string/object shorthand or message array)
    const expectedOutputField = evalCase.expected_output;
    if (expectedOutputField !== undefined) {
      if (typeof expectedOutputField === 'string') {
        // String shorthand is valid - no further validation needed
      } else if (Array.isArray(expectedOutputField)) {
        // Check if it looks like a message array (first element has 'role')
        if (
          expectedOutputField.length > 0 &&
          isObject(expectedOutputField[0]) &&
          'role' in expectedOutputField[0]
        ) {
          validateMessages(
            expectedOutputField,
            `${location}.expected_output`,
            absolutePath,
            errors,
          );
        }
        // Otherwise it's treated as structured array content - valid
      } else if (isObject(expectedOutputField)) {
        // Object shorthand or single message - both are valid
      } else {
        errors.push({
          severity: 'error',
          filePath: absolutePath,
          location: `${location}.expected_output`,
          message: "Invalid 'expected_output' field (must be a string, object, or array)",
        });
      }
    }

    // assert field (array of assertion objects)
    const assertField = evalCase.assert;
    if (assertField !== undefined) {
      validateAssertArray(assertField, location, absolutePath, errors);
    }
  }

  return {
    valid: errors.filter((e) => e.severity === 'error').length === 0,
    filePath: absolutePath,
    fileType: 'eval',
    errors,
  };
}

function validateMessages(
  messages: JsonArray,
  location: string,
  filePath: string,
  errors: ValidationError[],
): void {
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const msgLocation = `${location}[${i}]`;

    if (!isObject(message)) {
      errors.push({
        severity: 'error',
        filePath,
        location: msgLocation,
        message: 'Message must be an object',
      });
      continue;
    }

    // Validate role field
    const role = message.role;
    const validRoles = ['system', 'user', 'assistant'];
    if (!validRoles.includes(role as string)) {
      errors.push({
        severity: 'error',
        filePath,
        location: `${msgLocation}.role`,
        message: `Invalid role '${role}'. Must be one of: ${validRoles.join(', ')}`,
      });
    }

    // Validate content field (can be string or array)
    const content = message.content;
    if (typeof content === 'string') {
      validateContentForRoleMarkers(content, `${msgLocation}.content`, filePath, errors);
    } else if (Array.isArray(content)) {
      // Array content - validate each element
      for (let j = 0; j < content.length; j++) {
        const contentItem = content[j];
        const contentLocation = `${msgLocation}.content[${j}]`;

        if (typeof contentItem === 'string') {
          validateContentForRoleMarkers(contentItem, contentLocation, filePath, errors);
        } else if (isObject(contentItem)) {
          const type = contentItem.type;
          if (typeof type !== 'string') {
            errors.push({
              severity: 'error',
              filePath,
              location: `${contentLocation}.type`,
              message: "Content object must have a 'type' field",
            });
          }

          // For 'file' type, we'll validate existence later in file-reference-validator
          // For 'text' type, require 'value' field
          if (type === 'text') {
            const value = contentItem.value;
            if (typeof value !== 'string') {
              errors.push({
                severity: 'error',
                filePath,
                location: `${contentLocation}.value`,
                message: "Content with type 'text' must have a 'value' field",
              });
            } else {
              validateContentForRoleMarkers(value, `${contentLocation}.value`, filePath, errors);
            }
          }
        } else {
          errors.push({
            severity: 'error',
            filePath,
            location: contentLocation,
            message: 'Content array items must be strings or objects',
          });
        }
      }
    } else {
      errors.push({
        severity: 'error',
        filePath,
        location: `${msgLocation}.content`,
        message: "Missing or invalid 'content' field (must be a string or array)",
      });
    }
  }
}

function validateMetadata(parsed: JsonObject, filePath: string, errors: ValidationError[]): void {
  const name = parsed.name;
  if (name !== undefined) {
    if (typeof name === 'string') {
      if (!NAME_PATTERN.test(name)) {
        errors.push({
          severity: 'warning',
          filePath,
          location: 'name',
          message: `Invalid 'name' format '${name}'. Must match pattern /^[a-z0-9-]+$/ (lowercase alphanumeric with hyphens).`,
        });
      }
    }

    // Warn if name is present but description is missing
    if (!('description' in parsed) || parsed.description === undefined) {
      errors.push({
        severity: 'warning',
        filePath,
        location: 'name',
        message: "When 'name' is present, 'description' should also be provided.",
      });
    }
  }
}

function validateTestsStringPath(
  testsPath: string,
  filePath: string,
  errors: ValidationError[],
): void {
  const ext = path.extname(testsPath);
  if (!VALID_TEST_FILE_EXTENSIONS.has(ext)) {
    errors.push({
      severity: 'warning',
      filePath,
      location: 'tests',
      message: `Unsupported file extension '${ext}' for tests path '${testsPath}'. Supported extensions: ${[...VALID_TEST_FILE_EXTENSIONS].join(', ')}`,
    });
  }
}

function validateAssertArray(
  assertField: JsonValue,
  parentLocation: string,
  filePath: string,
  errors: ValidationError[],
): void {
  if (!Array.isArray(assertField)) {
    errors.push({
      severity: 'warning',
      filePath,
      location: `${parentLocation}.assert`,
      message: "'assert' must be an array of assertion objects.",
    });
    return;
  }

  for (let i = 0; i < assertField.length; i++) {
    const item = assertField[i];
    const location = `${parentLocation}.assert[${i}]`;

    if (!isObject(item)) {
      errors.push({
        severity: 'warning',
        filePath,
        location,
        message: 'Assertion item must be an object with a type field.',
      });
      continue;
    }

    // Validate type field
    const typeValue = item.type;
    if (typeValue === undefined || typeof typeValue !== 'string') {
      errors.push({
        severity: 'warning',
        filePath,
        location: `${location}.type`,
        message: "Assertion item is missing a 'type' field.",
      });
      continue;
    }

    if (!isEvaluatorKind(typeValue)) {
      errors.push({
        severity: 'warning',
        filePath,
        location: `${location}.type`,
        message: `Unknown assertion type '${typeValue}'.`,
      });
      continue;
    }

    // Validate value field for types that require it
    if (ASSERTION_TYPES_WITH_VALUE.has(typeValue)) {
      const value = item.value;
      if (value === undefined || typeof value !== 'string') {
        errors.push({
          severity: 'warning',
          filePath,
          location: `${location}.value`,
          message: `Assertion type '${typeValue}' requires a 'value' field (string).`,
        });
        continue;
      }

      // For regex type, validate that the pattern is valid
      if (typeValue === 'regex') {
        try {
          new RegExp(value);
        } catch {
          errors.push({
            severity: 'warning',
            filePath,
            location: `${location}.value`,
            message: `Invalid regex pattern '${value}': not a valid regular expression.`,
          });
        }
      }
    }

    // Validate required field if present
    const required = item.required;
    if (required !== undefined) {
      validateRequiredField(required, location, filePath, errors);
    }
  }
}

function validateRequiredField(
  required: JsonValue,
  parentLocation: string,
  filePath: string,
  errors: ValidationError[],
): void {
  if (typeof required === 'boolean') {
    return; // Valid
  }
  if (typeof required === 'number') {
    if (required <= 0 || required > 1) {
      errors.push({
        severity: 'warning',
        filePath,
        location: `${parentLocation}.required`,
        message: `Invalid 'required' value ${required}. When a number, it must be between 0 (exclusive) and 1 (inclusive).`,
      });
    }
    return;
  }
  errors.push({
    severity: 'warning',
    filePath,
    location: `${parentLocation}.required`,
    message: `Invalid 'required' value. Must be a boolean or a number between 0 (exclusive) and 1 (inclusive).`,
  });
}

function validateContentForRoleMarkers(
  content: string,
  location: string,
  filePath: string,
  errors: ValidationError[],
): void {
  // Check for standard role markers that might confuse agentic providers
  const markers = ['@[System]:', '@[User]:', '@[Assistant]:', '@[Tool]:'];
  for (const marker of markers) {
    if (content.toLowerCase().includes(marker.toLowerCase())) {
      errors.push({
        severity: 'warning',
        filePath,
        location,
        message: `Content contains potential role marker '${marker}'. This may confuse agentic providers or cause prompt injection.`,
      });
    }
  }
}
