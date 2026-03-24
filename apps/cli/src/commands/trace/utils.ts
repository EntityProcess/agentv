import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  LEGACY_RESULTS_FILENAME,
  RESULT_INDEX_FILENAME,
  resolveExistingRunPrimaryPath,
  resolveExistingRunTracePath,
  resolveWorkspaceOrFilePath,
} from '../eval/result-layout.js';

// ANSI color codes (no dependency needed)
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

const noColor = process.env.NO_COLOR !== undefined || !process.stdout.isTTY;
export const c = noColor
  ? (Object.fromEntries(Object.keys(colors).map((k) => [k, ''])) as typeof colors)
  : colors;

// Regex to strip ANSI escape codes
const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

export function stripAnsi(str: string): string {
  return str.replace(ansiPattern, '');
}

export function padRight(str: string, len: number): string {
  const plainLen = stripAnsi(str).length;
  return str + ' '.repeat(Math.max(0, len - plainLen));
}

export function padLeft(str: string, len: number): string {
  const plainLen = stripAnsi(str).length;
  return ' '.repeat(Math.max(0, len - plainLen)) + str;
}

/**
 * A raw JSONL result record with snake_case keys as stored on disk.
 */
export interface RawResult {
  timestamp?: string;
  test_id?: string;
  eval_id?: string;
  eval_set?: string;
  conversation_id?: string;
  score: number;
  assertions?: { text: string; passed: boolean; evidence?: string }[];
  target?: string;
  error?: string;
  scores?: RawEvaluatorScore[];
  trace?: RawTraceSummary;
  // Promoted execution metrics (snake_case from JSONL)
  token_usage?: { input: number; output: number; cached?: number };
  cost_usd?: number;
  duration_ms?: number;
  start_time?: string;
  end_time?: string;
  input?: unknown;
  output?: unknown;
  trials?: unknown[];
  aggregation?: unknown;
  file_changes?: string;
}

export interface RawEvaluatorScore {
  name: string;
  type: string;
  score: number;
  assertions?: { text: string; passed: boolean; evidence?: string }[];
  weight?: number;
}

export interface RawTraceSummary {
  event_count?: number;
  tool_calls?: Record<string, number>;
  error_count?: number;
  tool_durations?: Record<string, number[]>;
  llm_call_count?: number;
  // Execution metrics (present when trace includes provider metrics)
  token_usage?: { input: number; output: number; cached?: number };
  cost_usd?: number;
  duration_ms?: number;
}

/**
 * Load all result records from a JSONL file.
 */
export function loadResultFile(filePath: string): RawResult[] {
  const resolvedFilePath = resolveTraceResultPath(filePath);
  const content = readFileSync(resolvedFilePath, 'utf8');
  const lines = content
    .trim()
    .split('\n')
    .filter((line) => line.trim());

  return lines.map((line, i) => {
    const record = JSON.parse(line) as RawResult;
    if (typeof record.score !== 'number') {
      throw new Error(`Missing or invalid score in result at line ${i + 1}: ${line.slice(0, 100)}`);
    }
    return record;
  });
}

function resolveTraceResultPath(filePath: string): string {
  if (path.basename(filePath) === RESULT_INDEX_FILENAME) {
    const legacySibling = path.join(path.dirname(filePath), LEGACY_RESULTS_FILENAME);
    try {
      statSync(legacySibling);
      return legacySibling;
    } catch {
      return filePath;
    }
  }

  if (path.basename(filePath) === LEGACY_RESULTS_FILENAME) {
    return filePath;
  }

  if (!filePath.endsWith('.jsonl')) {
    return resolveExistingRunTracePath(filePath) ?? resolveWorkspaceOrFilePath(filePath);
  }

  return resolveWorkspaceOrFilePath(filePath);
}

/**
 * Metadata about a result file for listing.
 */
export interface ResultFileMeta {
  path: string;
  filename: string;
  timestamp: string;
  testCount: number;
  passRate: number;
  avgScore: number;
  sizeBytes: number;
}

/**
 * Enumerate result files in the .agentv/results/ directory.
 * Scans raw/ for both directory-per-run layouts (index.jsonl preferred inside subdirs)
 * and legacy flat .jsonl files. Also scans the base directory for pre-raw/ files.
 */
export function listResultFiles(cwd: string, limit?: number): ResultFileMeta[] {
  const baseDir = path.join(cwd, '.agentv', 'results');
  const rawDir = path.join(baseDir, 'raw');

  const files: { filePath: string; displayName: string }[] = [];

  // Scan raw/ for both directory-based runs and flat JSONL files.
  // Process directories first so they take priority in dedup over flat files.
  try {
    const entries = readdirSync(rawDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const primaryPath = resolveExistingRunPrimaryPath(path.join(rawDir, entry.name));
        if (primaryPath) {
          files.push({ filePath: primaryPath, displayName: entry.name });
        }
      }
    }
    for (const entry of entries) {
      if (!entry.isDirectory() && entry.name.endsWith('.jsonl')) {
        files.push({ filePath: path.join(rawDir, entry.name), displayName: entry.name });
      }
    }
  } catch {
    // raw/ doesn't exist yet
  }

  // Also scan base directory for legacy files (backward compat)
  try {
    const entries = readdirSync(baseDir).filter((f) => f.endsWith('.jsonl'));
    for (const entry of entries) {
      files.push({ filePath: path.join(baseDir, entry), displayName: entry });
    }
  } catch {
    // Base directory doesn't exist yet
  }

  // Deduplicate by normalized name (strip .jsonl so dir "eval_X" matches file "eval_X.jsonl")
  const seen = new Set<string>();
  const uniqueFiles: { filePath: string; displayName: string }[] = [];
  for (const file of files) {
    const key = file.displayName.replace(/\.jsonl$/, '');
    if (!seen.has(key)) {
      seen.add(key);
      uniqueFiles.push(file);
    }
  }

  // Sort by display name descending (most recent first)
  uniqueFiles.sort((a, b) => b.displayName.localeCompare(a.displayName));

  const limited = limit !== undefined && limit > 0 ? uniqueFiles.slice(0, limit) : uniqueFiles;

  const metas: ResultFileMeta[] = [];

  for (const { filePath, displayName } of limited) {
    try {
      const fileStat = statSync(filePath);
      const results = loadResultFile(filePath);

      const testCount = results.length;
      const passCount = results.filter((r) => r.score >= 1.0).length;
      const passRate = testCount > 0 ? passCount / testCount : 0;
      const avgScore = testCount > 0 ? results.reduce((sum, r) => sum + r.score, 0) / testCount : 0;

      const filenameTimestamp = extractTimestampFromFilename(displayName);
      const timestamp = filenameTimestamp ?? results[0]?.timestamp ?? 'unknown';

      metas.push({
        path: filePath,
        filename: displayName,
        timestamp,
        testCount,
        passRate,
        avgScore,
        sizeBytes: fileStat.size,
      });
    } catch {
      // Skip unreadable files
    }
  }

  return metas;
}

/**
 * Extract ISO timestamp from eval filename like eval_2026-02-20T21-38-05-833Z.jsonl
 */
export function extractTimestampFromFilename(filename: string): string | undefined {
  const match = filename.match(/eval_(\d{4}-\d{2}-\d{2}T[\d-]+Z)/);
  if (!match) return undefined;
  // Re-convert dashes back to colons/dots for display
  return match[1].replace(/-(\d{2})-(\d{2})-(\d{3})Z$/, ':$1:$2.$3Z');
}

/**
 * Format a number with commas for display.
 */
export function formatNumber(n: number): string {
  return n.toLocaleString();
}

/**
 * Format duration in ms to human-readable.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return `${minutes}m${seconds}s`;
}

/**
 * Format cost in USD.
 */
export function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

/**
 * Format file size for display.
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Format a score as percentage.
 */
export function formatScore(score: number): string {
  return `${(score * 100).toFixed(0)}%`;
}
