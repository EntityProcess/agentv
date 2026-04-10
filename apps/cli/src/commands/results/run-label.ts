/**
 * Per-run label sidecar file helpers.
 *
 * Labels are stored as a `label.json` sidecar next to the run's `index.jsonl`
 * manifest. The sidecar is optional, mutable, and non-breaking — absence means
 * the run has no label.
 *
 * Wire format (stored on disk):
 * ```json
 * { "label": "baseline", "updated_at": "2026-04-10T00:00:00.000Z" }
 * ```
 *
 * Used by the Studio compare API so users can retroactively tag runs without
 * changing the eval YAML or the run manifest itself.
 *
 * To extend with more metadata (e.g. tags, notes): add fields to
 * `RunLabelFile` and update `readRunLabel`/`writeRunLabel` accordingly. Keep
 * the schema additive so older files still parse.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const RUN_LABEL_FILENAME = 'label.json';

export interface RunLabelFile {
  /** Human-readable label replacing the run timestamp in compare views. */
  label: string;
  /** ISO-8601 timestamp of last update. */
  updated_at: string;
}

/** Resolve the label sidecar path given a run manifest (index.jsonl) path. */
export function runLabelPath(manifestPath: string): string {
  return path.join(path.dirname(manifestPath), RUN_LABEL_FILENAME);
}

/** Read the label for a run. Returns `undefined` if missing or unreadable. */
export function readRunLabel(manifestPath: string): RunLabelFile | undefined {
  const fp = runLabelPath(manifestPath);
  if (!existsSync(fp)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(fp, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object') return undefined;
    const record = parsed as Record<string, unknown>;
    if (typeof record.label !== 'string' || record.label.trim() === '') return undefined;
    return {
      label: record.label,
      updated_at: typeof record.updated_at === 'string' ? record.updated_at : '',
    };
  } catch {
    return undefined;
  }
}

/** Write a label for a run. Overwrites any existing label. */
export function writeRunLabel(manifestPath: string, label: string): RunLabelFile {
  const trimmed = label.trim();
  if (trimmed === '') {
    throw new Error('Label cannot be empty');
  }
  if (trimmed.length > 120) {
    throw new Error('Label must be at most 120 characters');
  }
  const entry: RunLabelFile = {
    label: trimmed,
    updated_at: new Date().toISOString(),
  };
  writeFileSync(runLabelPath(manifestPath), `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
  return entry;
}

/** Remove a run's label sidecar. No-op if the file does not exist. */
export function deleteRunLabel(manifestPath: string): void {
  const fp = runLabelPath(manifestPath);
  if (existsSync(fp)) {
    unlinkSync(fp);
  }
}
