import type { JsonObject } from '../types.js';

/**
 * Formatting mode for segment content.
 * - 'agent': File references only (for providers with filesystem access)
 * - 'lm': Embedded file content with XML tags (for language model providers)
 */
export type FormattingMode = 'agent' | 'lm';

/**
 * Extract fenced code blocks from AgentV user segments.
 */
export function extractCodeBlocks(segments: readonly JsonObject[]): readonly string[] {
  const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g;
  const codeBlocks: string[] = [];
  for (const segment of segments) {
    const typeValue = segment.type;
    if (typeof typeValue !== 'string' || typeValue !== 'text') {
      continue;
    }
    const textValue = segment.value;
    if (typeof textValue !== 'string') {
      continue;
    }
    const matches = textValue.match(CODE_BLOCK_PATTERN);
    if (matches) {
      codeBlocks.push(...matches);
    }
  }
  return codeBlocks;
}

/**
 * Format file contents with XML tags for all files.
 */
export function formatFileContents(
  parts: Array<{ content: string; isFile: boolean; displayPath?: string }>,
): string {
  const fileCount = parts.filter((p) => p.isFile).length;

  // Use XML tags if any files are present
  if (fileCount > 0) {
    return parts
      .map((part) => {
        if (part.isFile && part.displayPath) {
          return `<file path="${part.displayPath}">\n${part.content}\n</file>`;
        }
        return part.content;
      })
      .join('\n\n');
  }

  // Otherwise, join normally
  return parts.map((p) => p.content).join(' ');
}

/**
 * Format a segment into its display string.
 * Text segments return their value; file segments return formatted file content with header.
 *
 * @param segment - The segment to format
 * @param mode - Formatting mode: 'agent' for file references, 'lm' for embedded content
 */
export function formatSegment(
  segment: JsonObject,
  mode: FormattingMode = 'lm',
): string | undefined {
  const type = asString(segment.type);

  if (type === 'text') {
    return asString(segment.value);
  }

  if (type === 'guideline_ref') {
    const refPath = asString(segment.path);
    return refPath ? `<Attached: ${refPath}>` : undefined;
  }

  if (type === 'file') {
    const filePath = asString(segment.path);
    if (!filePath) {
      return undefined;
    }

    // Agent mode: return file reference only
    if (mode === 'agent') {
      return `<file: path="${filePath}">`;
    }

    // LM mode: return embedded content with XML tags
    const text = asString(segment.text);
    if (text && filePath) {
      // Use formatFileContents for consistent XML formatting
      return formatFileContents([{ content: text.trim(), isFile: true, displayPath: filePath }]);
    }
  }

  return undefined;
}

/**
 * Check if processed segments contain visible content (text or file attachments).
 */
export function hasVisibleContent(segments: readonly JsonObject[]): boolean {
  return segments.some((segment) => {
    const type = asString(segment.type);

    if (type === 'text') {
      const value = asString(segment.value);
      return value !== undefined && value.trim().length > 0;
    }

    if (type === 'guideline_ref') {
      return false;
    }

    if (type === 'file') {
      const text = asString(segment.text);
      return text !== undefined && text.trim().length > 0;
    }

    return false;
  });
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
