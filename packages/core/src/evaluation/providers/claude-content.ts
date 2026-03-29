/**
 * Shared content-mapping utilities for Claude-based providers.
 *
 * Converts Claude's raw content array format (Anthropic API) into the AgentV
 * Content[] union so that non-text blocks (images) flow through the pipeline
 * without lossy flattening.
 *
 * Used by: claude-cli, claude-sdk, claude (legacy).
 *
 * ## Claude content format
 *
 * Claude responses use:
 * ```json
 * { "content": [
 *     { "type": "text", "text": "..." },
 *     { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "..." } },
 *     { "type": "tool_use", "name": "...", "input": {...}, "id": "..." }
 * ]}
 * ```
 *
 * `toContentArray` maps text and image blocks to `Content[]`.
 * `tool_use` and `tool_result` blocks are handled separately as `ToolCall`.
 */

import type { Content } from '../content.js';

/**
 * Convert Claude's raw content array to `Content[]`, preserving non-text blocks.
 *
 * Returns `undefined` when the content is a plain string or contains only text
 * blocks — callers should fall back to the text-only string representation in
 * that case (no benefit from wrapping plain text in `Content[]`).
 */
export function toContentArray(content: unknown): Content[] | undefined {
  if (!Array.isArray(content)) return undefined;

  let hasNonText = false;
  const blocks: Content[] = [];

  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const p = part as Record<string, unknown>;

    if (p.type === 'text' && typeof p.text === 'string') {
      blocks.push({ type: 'text', text: p.text });
    } else if (p.type === 'image' && typeof p.source === 'object' && p.source !== null) {
      const src = p.source as Record<string, unknown>;
      const mediaType =
        typeof p.media_type === 'string'
          ? p.media_type
          : typeof src.media_type === 'string'
            ? src.media_type
            : 'application/octet-stream';
      const data =
        typeof src.data === 'string' && src.data !== ''
          ? `data:${mediaType};base64,${src.data}`
          : typeof p.url === 'string' && p.url !== ''
            ? (p.url as string)
            : '';
      if (!data) continue;
      blocks.push({ type: 'image', media_type: mediaType, source: data });
      hasNonText = true;
    } else if (p.type === 'tool_use') {
      // tool_use blocks are handled separately as ToolCall — skip
    } else if (p.type === 'tool_result') {
      // tool_result blocks are not user content — skip
    }
  }

  return hasNonText && blocks.length > 0 ? blocks : undefined;
}

/**
 * Extract text content from Claude's content array format.
 * Returns joined text from all `type: 'text'` blocks (newline-separated).
 */
export function extractTextContent(content: unknown): string | undefined {
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
