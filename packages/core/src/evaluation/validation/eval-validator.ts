import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';

import type { ValidationError, ValidationResult } from './types.js';

type JsonValue = string | number | boolean | null | JsonObject | JsonArray;
type JsonObject = { readonly [key: string]: JsonValue };
type JsonArray = readonly JsonValue[];

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

  // Validate evalcases array
  const evalcases = parsed.evalcases;
  if (!Array.isArray(evalcases)) {
    errors.push({
      severity: 'error',
      filePath: absolutePath,
      location: 'evalcases',
      message: "Missing or invalid 'evalcases' field (must be an array)",
    });
    return {
      valid: errors.length === 0,
      filePath: absolutePath,
      fileType: 'eval',
      errors,
    };
  }

  // Validate each eval case
  for (let i = 0; i < evalcases.length; i++) {
    const evalCase = evalcases[i];
    const location = `evalcases[${i}]`;

    if (!isObject(evalCase)) {
      errors.push({
        severity: 'error',
        filePath: absolutePath,
        location,
        message: 'Eval case must be an object',
      });
      continue;
    }

    // Required fields: id, input_messages, expected_messages
    const id = evalCase.id;
    if (typeof id !== 'string' || id.trim().length === 0) {
      errors.push({
        severity: 'error',
        filePath: absolutePath,
        location: `${location}.id`,
        message: "Missing or invalid 'id' field (must be a non-empty string)",
      });
    }

    // Optional: expected_outcome or outcome for backward compatibility
    const expectedOutcome = evalCase.expected_outcome ?? evalCase.outcome;
    if (
      expectedOutcome !== undefined &&
      (typeof expectedOutcome !== 'string' || expectedOutcome.trim().length === 0)
    ) {
      errors.push({
        severity: 'error',
        filePath: absolutePath,
        location: `${location}.expected_outcome`,
        message:
          "Invalid 'expected_outcome' or 'outcome' field (must be a non-empty string if provided)",
      });
    }

    const inputMessages = evalCase.input_messages;
    if (!Array.isArray(inputMessages)) {
      errors.push({
        severity: 'error',
        filePath: absolutePath,
        location: `${location}.input_messages`,
        message: "Missing or invalid 'input_messages' field (must be an array)",
      });
    } else {
      validateMessages(inputMessages, `${location}.input_messages`, absolutePath, errors);
    }

    // expected_messages is optional - for outcome-only evaluation
    const expectedMessages = evalCase.expected_messages;
    if (expectedMessages !== undefined && !Array.isArray(expectedMessages)) {
      errors.push({
        severity: 'error',
        filePath: absolutePath,
        location: `${location}.expected_messages`,
        message: "Invalid 'expected_messages' field (must be an array if provided)",
      });
    } else if (Array.isArray(expectedMessages)) {
      validateMessages(expectedMessages, `${location}.expected_messages`, absolutePath, errors);
    }
  }

  return {
    valid: errors.length === 0,
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
