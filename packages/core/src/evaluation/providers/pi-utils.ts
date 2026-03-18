/**
 * Shared utilities for pi-coding-agent and pi-agent-sdk providers.
 *
 * To add a new utility: export it here and import in both provider files.
 */

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
 * Safely convert an unknown value to a finite number, or undefined.
 */
export function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return undefined;
}
