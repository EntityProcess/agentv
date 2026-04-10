import type { JsonObject, TestMessage, TestMessageContent } from './types.js';
import { isJsonObject } from './types.js';

/**
 * Flatten enriched input messages into prompt-builder-friendly segments.
 */
export function flattenInputMessages(messages: readonly TestMessage[]): JsonObject[] {
  return messages.flatMap((message) => extractContentSegments(message.content));
}

/**
 * Extract resolved file paths carried on parsed input message segments.
 */
export function collectResolvedInputFilePaths(messages: readonly TestMessage[]): string[] {
  const filePaths: string[] = [];

  for (const message of messages) {
    if (!Array.isArray(message.content)) {
      continue;
    }

    for (const segment of message.content) {
      if (
        isJsonObject(segment) &&
        segment.type === 'file' &&
        typeof segment.resolvedPath === 'string'
      ) {
        filePaths.push(segment.resolvedPath);
      }
    }
  }

  return filePaths;
}

/**
 * Normalize a message content payload into formatted prompt segments.
 */
export function extractContentSegments(content: TestMessageContent): JsonObject[] {
  if (typeof content === 'string') {
    return content.trim().length > 0 ? [{ type: 'text', value: content }] : [];
  }

  if (isJsonObject(content)) {
    const rendered = JSON.stringify(content, null, 2);
    return rendered.trim().length > 0 ? [{ type: 'text', value: rendered }] : [];
  }

  if (!Array.isArray(content)) {
    return [];
  }

  const segments: JsonObject[] = [];

  for (const segment of content) {
    // Plain string items inside a content array are treated as text segments.
    // This matches the validator, which accepts string items in content arrays.
    if (typeof segment === 'string') {
      if (segment.trim().length > 0) {
        segments.push({ type: 'text', value: segment });
      }
      continue;
    }
    if (!isJsonObject(segment)) {
      continue;
    }
    segments.push(cloneJsonObject(segment));
  }

  return segments;
}

export function cloneJsonObject(source: JsonObject): JsonObject {
  const entries = Object.entries(source).map(([key, value]) => [key, cloneJsonValue(value)]);
  return Object.fromEntries(entries) as JsonObject;
}

function cloneJsonValue(value: unknown): unknown {
  if (value === null) {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => cloneJsonValue(item));
  }
  if (typeof value === 'object') {
    return cloneJsonObject(value as JsonObject);
  }
  return value;
}
