/**
 * Multimodal content types for the AgentV pipeline.
 *
 * Models structured content blocks (text, images, files) that flow end-to-end
 * without lossy flattening. Modeled after Inspect AI's discriminated union approach.
 *
 * ## Content model
 *
 * `Message.content` accepts `string | Content[]`:
 * - `string` — backward-compatible plain text (most common case)
 * - `Content[]` — array of typed content blocks for multimodal messages
 *
 * Binary data (images, files) is referenced by URL/base64 string or filesystem
 * path — never raw bytes. This keeps payloads serializable and lets code graders
 * access files via path without decoding.
 *
 * ## How to extend
 *
 * To add a new content variant (e.g., `ContentAudio`):
 * 1. Define the interface with a unique `type` discriminant
 * 2. Add it to the `Content` union
 * 3. Update `getTextContent()` if the new type has extractable text
 * 4. Update `isContent()` type guard with the new type string
 */

// ---------------------------------------------------------------------------
// Content block types
// ---------------------------------------------------------------------------

/** A text content block. */
export interface ContentText {
  readonly type: 'text';
  readonly text: string;
}

/**
 * An image content block.
 * `source` is a URL, data URI (base64), or filesystem path.
 */
export interface ContentImage {
  readonly type: 'image';
  readonly media_type: string;
  readonly source: string;
}

/**
 * A file content block.
 * `path` is a filesystem path or URL referencing the file.
 */
export interface ContentFile {
  readonly type: 'file';
  readonly media_type: string;
  readonly path: string;
}

/** Discriminated union of all content block types. */
export type Content = ContentText | ContentImage | ContentFile;

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

const CONTENT_TYPES = new Set<string>(['text', 'image', 'file']);

/** Check whether a value is a valid `Content` block. */
export function isContent(value: unknown): value is Content {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.type === 'string' && CONTENT_TYPES.has(v.type);
}

/** Check whether a value is a `Content[]` array (at least one valid block). */
export function isContentArray(value: unknown): value is Content[] {
  return Array.isArray(value) && value.length > 0 && value.every(isContent);
}

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

/**
 * Extract plain text from `string | Content[]`.
 *
 * - If `content` is a string, returns it directly.
 * - If `content` is a `Content[]`, concatenates all `ContentText.text` values
 *   (separated by newlines) and returns the result.
 * - Returns `''` for `undefined`/`null`/unrecognized shapes.
 *
 * This is a **non-destructive** accessor — the original `Content[]` is preserved.
 */
export function getTextContent(content: string | Content[] | undefined | null): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  const parts: string[] = [];
  for (const block of content) {
    if (block.type === 'text') {
      parts.push(block.text);
    }
  }
  return parts.join('\n');
}
