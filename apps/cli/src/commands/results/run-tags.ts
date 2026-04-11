/**
 * Per-run tag sidecar file helpers.
 *
 * Tags are stored as a `tags.json` sidecar next to the run's `index.jsonl`
 * manifest. The sidecar is optional, mutable, and non-breaking — absence
 * means the run has no user-assigned tags.
 *
 * Wire format (stored on disk):
 * ```json
 * { "tags": ["baseline", "v2-prompt"], "updated_at": "2026-04-10T00:00:00.000Z" }
 * ```
 *
 * Used by the Studio compare API so users can retroactively tag runs
 * without changing the eval YAML or the run manifest itself. This mirrors
 * the Langfuse / W&B / GitHub `tags` pattern — a mutable multi-valued
 * list of free-form labels that lives alongside the immutable run_id.
 *
 * Validation rules:
 *   - Each tag is 1–60 characters after trimming
 *   - No control characters (\n, \t, DEL, etc.)
 *   - Tags are deduplicated case-sensitively
 *   - A run can have at most 20 tags
 *   - Writing an empty array removes the sidecar file
 *
 * To extend (e.g. add colored labels or descriptions): add optional fields
 * to `RunTagsFile` and keep the schema additive so older files still parse.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const RUN_TAGS_FILENAME = 'tags.json';

/** Maximum number of tags per run. */
export const MAX_TAGS_PER_RUN = 20;

/** Maximum length of a single tag after trimming. */
export const MAX_TAG_LENGTH = 60;

export interface RunTagsFile {
  /** Ordered, deduplicated list of user-assigned tags. */
  tags: string[];
  /** ISO-8601 timestamp of last update. */
  updated_at: string;
}

/** Resolve the tags sidecar path given a run manifest (index.jsonl) path. */
export function runTagsPath(manifestPath: string): string {
  return path.join(path.dirname(manifestPath), RUN_TAGS_FILENAME);
}

/** Read the tags for a run. Returns `undefined` if missing or unreadable. */
export function readRunTags(manifestPath: string): RunTagsFile | undefined {
  const fp = runTagsPath(manifestPath);
  if (!existsSync(fp)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(fp, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object') return undefined;
    const record = parsed as Record<string, unknown>;
    if (!Array.isArray(record.tags)) return undefined;
    const tags = record.tags.filter(
      (t): t is string => typeof t === 'string' && t.trim().length > 0,
    );
    if (tags.length === 0) return undefined;
    return {
      tags,
      updated_at: typeof record.updated_at === 'string' ? record.updated_at : '',
    };
  } catch {
    return undefined;
  }
}

/**
 * Write tags for a run. Replaces any existing tags. Pass an empty array
 * to remove the sidecar entirely.
 */
export function writeRunTags(manifestPath: string, tags: readonly string[]): RunTagsFile | null {
  const cleaned = normalizeTags(tags);
  if (cleaned.length === 0) {
    deleteRunTags(manifestPath);
    return null;
  }
  const entry: RunTagsFile = {
    tags: cleaned,
    updated_at: new Date().toISOString(),
  };
  writeFileSync(runTagsPath(manifestPath), `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
  return entry;
}

/** Remove a run's tags sidecar. No-op if the file does not exist. */
export function deleteRunTags(manifestPath: string): void {
  const fp = runTagsPath(manifestPath);
  if (existsSync(fp)) {
    unlinkSync(fp);
  }
}

/**
 * Trim, validate, and deduplicate an incoming tag array. Throws on any
 * invalid entry so the caller can surface a user-friendly error.
 */
function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    if (typeof raw !== 'string') {
      throw new Error('Tags must be strings');
    }
    const trimmed = raw.trim();
    if (trimmed === '') continue;
    if (trimmed.length > MAX_TAG_LENGTH) {
      throw new Error(`Tag "${trimmed.slice(0, 20)}…" exceeds ${MAX_TAG_LENGTH} characters`);
    }
    // Reject control characters (newlines, tabs, DEL, etc.) — they break
    // column headers in compare views and confuse test assertions.
    for (let i = 0; i < trimmed.length; i++) {
      const code = trimmed.charCodeAt(i);
      if (code < 0x20 || code === 0x7f) {
        throw new Error('Tag must not contain control characters');
      }
    }
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  if (out.length > MAX_TAGS_PER_RUN) {
    throw new Error(`Too many tags (max ${MAX_TAGS_PER_RUN})`);
  }
  return out;
}
