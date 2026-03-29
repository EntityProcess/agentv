/**
 * Shared utilities for the pi-coding-agent provider.
 *
 * Provides helpers for extracting text content from Pi's message format
 * and safe numeric conversions.
 */

import type { Content } from '../content.js';

/**
 * Extract text content from Pi's content array format.
 * Pi uses: content: [{ type: "text", text: "..." }, ...]
 */
export function extractPiTextContent(content: unknown): string | undefined {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return undefined;
  }

  const textParts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') {
      continue;
    }
    const p = part as Record<string, unknown>;
    if (p.type === 'text' && typeof p.text === 'string') {
      textParts.push(p.text);
    }
  }

  return textParts.length > 0 ? textParts.join('\n') : undefined;
}

/**
 * Convert Pi's content array to `Content[]`, preserving non-text blocks.
 *
 * Returns `undefined` when content is a plain string or contains only text
 * blocks — callers should fall back to the text-only string representation.
 */
export function toPiContentArray(content: unknown): Content[] | undefined {
  if (!Array.isArray(content)) return undefined;

  let hasNonText = false;
  const blocks: Content[] = [];

  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const p = part as Record<string, unknown>;

    if (p.type === 'text' && typeof p.text === 'string') {
      blocks.push({ type: 'text', text: p.text });
    } else if (p.type === 'image') {
      const mediaType =
        typeof p.media_type === 'string' ? p.media_type : 'application/octet-stream';

      let source = '';
      if (typeof p.source === 'object' && p.source !== null) {
        const src = p.source as Record<string, unknown>;
        const srcMediaType = typeof src.media_type === 'string' ? src.media_type : mediaType;
        source = typeof src.data === 'string' ? `data:${srcMediaType};base64,${src.data}` : '';
      }
      if (!source && typeof p.url === 'string') {
        source = p.url;
      }

      if (source) {
        blocks.push({ type: 'image', media_type: mediaType, source });
        hasNonText = true;
      }
    } else if (p.type === 'tool_use' || p.type === 'tool_result') {
      // Handled separately — skip
    }
  }

  return hasNonText && blocks.length > 0 ? blocks : undefined;
}

/**
 * Safely convert an unknown value to a finite number, or undefined.
 */
export function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return undefined;
}
