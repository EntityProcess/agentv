/**
 * Shorthand expansion utilities for input/expected_output fields.
 *
 * Supports:
 * - `input` with string shorthand or message array
 * - `input_files` shorthand (string input only): expands to type:file + type:text content blocks
 * - `expected_output` with string/object shorthand or message array
 */

import type { JsonObject, JsonValue, TestMessage } from '../types.js';
import { isJsonObject, isTestMessage } from '../types.js';

/**
 * Expand the `input` shorthand into a message array.
 *
 * Supports:
 * - String: "What is 2+2?" -> [{ role: 'user', content: "What is 2+2?" }]
 * - Array of messages: Already in message format, passthrough
 *
 * @param value The raw `input` value from YAML/JSONL
 * @returns Expanded message array or undefined if invalid
 */
export function expandInputShorthand(value: JsonValue | undefined): TestMessage[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  // String shorthand: single user message
  if (typeof value === 'string') {
    return [{ role: 'user', content: value }];
  }

  // Array: should be message array
  if (Array.isArray(value)) {
    const messages = value.filter((msg): msg is TestMessage => isTestMessage(msg));
    return messages.length > 0 ? messages : undefined;
  }

  return undefined;
}

/**
 * Expand the `expected_output` shorthand into a message array.
 *
 * Supports:
 * - String: "Answer" -> [{ role: 'assistant', content: "Answer" }]
 * - Object (without role key): { riskLevel: 'High' } -> [{ role: 'assistant', content: { riskLevel: 'High' } }]
 * - Array of messages: Already in message format, passthrough
 *
 * @param value The raw `expected_output` value from YAML/JSONL
 * @returns Expanded message array or undefined if invalid
 */
export function expandExpectedOutputShorthand(
  value: JsonValue | undefined,
): TestMessage[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  // String shorthand: single assistant message
  if (typeof value === 'string') {
    return [{ role: 'assistant', content: value }];
  }

  // Array: could be message array or other array
  if (Array.isArray(value)) {
    // Check if first element looks like a message (has role property)
    if (value.length > 0 && isJsonObject(value[0]) && 'role' in value[0]) {
      const messages = value.filter((msg): msg is TestMessage => isTestMessage(msg));
      return messages.length > 0 ? messages : undefined;
    }
    // Array that doesn't look like messages - treat as structured content
    return [{ role: 'assistant', content: value as unknown as JsonObject[] }];
  }

  // Object shorthand: single assistant message with structured content
  if (isJsonObject(value)) {
    // Check if it looks like a message (has role property)
    if ('role' in value) {
      return isTestMessage(value) ? [value] : undefined;
    }
    // Structured object -> wrap as assistant message content
    return [{ role: 'assistant', content: value }];
  }

  return undefined;
}

/**
 * Expand `input_files` shorthand combined with a string `input` into a single user message
 * whose content is an array of type:file blocks (one per path) followed by a type:text block.
 *
 * Only supported when `input` is a string. Returns undefined if:
 * - `inputFiles` is undefined/null or not an array of strings
 * - `inputText` is not a string (multi-turn array inputs are not supported in v1)
 *
 * Example YAML:
 * ```yaml
 * input_files:
 *   - evals/files/sales.csv
 * input: "Summarize the monthly trends in this CSV."
 * ```
 *
 * Expands to:
 * ```yaml
 * input:
 *   - role: user
 *     content:
 *       - type: file
 *         value: evals/files/sales.csv
 *       - type: text
 *         value: "Summarize the monthly trends in this CSV."
 * ```
 *
 * @param inputFiles The raw `input_files` value from YAML
 * @param inputText The raw `input` value from YAML (must be a string)
 * @returns Expanded message array or undefined if preconditions not met
 */
export function expandInputFilesShorthand(
  inputFiles: JsonValue | undefined,
  inputText: JsonValue | undefined,
): TestMessage[] | undefined {
  if (inputFiles === undefined || inputFiles === null) {
    return undefined;
  }

  // input_files must be an array of strings
  if (!Array.isArray(inputFiles)) {
    return undefined;
  }

  const filePaths = inputFiles.filter((f): f is string => typeof f === 'string');
  if (filePaths.length === 0) {
    return undefined;
  }

  // input must be a string (multi-turn arrays not supported in v1)
  if (typeof inputText !== 'string') {
    return undefined;
  }

  const contentBlocks: JsonObject[] = [
    ...filePaths.map((filePath): JsonObject => ({ type: 'file', value: filePath })),
    { type: 'text', value: inputText },
  ];

  return [{ role: 'user', content: contentBlocks }];
}

/**
 * Resolve input from raw eval case data, optionally merging suite-level input_files.
 *
 * When `input_files` is present (per-test or suite-level) alongside a string `input`,
 * the shorthand is expanded into a user message with type:file content blocks followed
 * by a type:text block. Per-test `input_files` takes precedence over suite-level.
 * Otherwise, `input` is expanded via the standard shorthand rules.
 *
 * @param raw Raw eval case object from YAML/JSONL
 * @param suiteInputFiles Optional suite-level input_files (used when test has no per-test input_files)
 * @returns Resolved input messages array or undefined if none found
 */
export function resolveInputMessages(
  raw: JsonObject,
  suiteInputFiles?: JsonValue,
): TestMessage[] | undefined {
  // Per-test input_files takes precedence over suite-level
  const effectiveInputFiles = raw.input_files ?? suiteInputFiles;
  if (effectiveInputFiles !== undefined) {
    return expandInputFilesShorthand(effectiveInputFiles, raw.input);
  }
  return expandInputShorthand(raw.input);
}

/**
 * Resolve expected_output from raw eval case data.
 *
 * @param raw Raw eval case object from YAML/JSONL
 * @returns Resolved expected output messages array or undefined if none found
 */
export function resolveExpectedMessages(raw: JsonObject): TestMessage[] | undefined {
  return expandExpectedOutputShorthand(raw.expected_output);
}
