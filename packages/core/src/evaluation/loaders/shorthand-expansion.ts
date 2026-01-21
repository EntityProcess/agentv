/**
 * Shorthand expansion utilities for input/expected_output aliases.
 *
 * Supports:
 * - `input` as alias for `input_messages` with string shorthand
 * - `expected_output` as alias for `expected_messages` with string/object shorthand
 */

import type { JsonObject, JsonValue, TestMessage } from '../types.js';
import { isJsonObject, isTestMessage } from '../types.js';

/**
 * Expand the `input` shorthand/alias into the canonical `input_messages` format.
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
 * Expand the `expected_output` shorthand/alias into canonical `expected_messages` format.
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
 * Resolve input_messages from raw eval case data, supporting the `input` alias.
 *
 * Precedence: input_messages (canonical) > input (alias)
 *
 * @param raw Raw eval case object from YAML/JSONL
 * @returns Resolved input messages array or undefined if none found
 */
export function resolveInputMessages(raw: JsonObject): TestMessage[] | undefined {
  // Canonical name takes precedence
  if (raw.input_messages !== undefined) {
    if (Array.isArray(raw.input_messages)) {
      const messages = raw.input_messages.filter((msg): msg is TestMessage => isTestMessage(msg));
      return messages.length > 0 ? messages : undefined;
    }
    return undefined;
  }

  // Fall back to alias with shorthand expansion
  return expandInputShorthand(raw.input);
}

/**
 * Resolve expected_messages from raw eval case data, supporting the `expected_output` alias.
 *
 * Precedence: expected_messages (canonical) > expected_output (alias)
 *
 * @param raw Raw eval case object from YAML/JSONL
 * @returns Resolved expected messages array or undefined if none found
 */
export function resolveExpectedMessages(raw: JsonObject): TestMessage[] | undefined {
  // Canonical name takes precedence
  if (raw.expected_messages !== undefined) {
    if (Array.isArray(raw.expected_messages)) {
      const messages = raw.expected_messages.filter((msg): msg is TestMessage =>
        isTestMessage(msg),
      );
      return messages.length > 0 ? messages : undefined;
    }
    return undefined;
  }

  // Fall back to alias with shorthand expansion
  return expandExpectedOutputShorthand(raw.expected_output);
}
