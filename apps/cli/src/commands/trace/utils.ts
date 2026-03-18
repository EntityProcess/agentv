import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

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
  dataset?: string;
  conversation_id?: string;
  score: number;
  assertions?: { text: string; passed: boolean; evidence?: string }[];
  output_text?: string;
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
  tool_names?: string[];
  tool_calls_by_name?: Record<string, number>;
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
  const content = readFileSync(filePath, 'utf8');
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
 */
export function listResultFiles(cwd: string, limit?: number): ResultFileMeta[] {
  const resultsDir = path.join(cwd, '.agentv', 'results');

  let files: string[];
  try {
    files = readdirSync(resultsDir).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return [];
  }

  // Sort by filename (which contains timestamp) descending (most recent first)
  files.sort((a, b) => b.localeCompare(a));

  if (limit !== undefined && limit > 0) {
    files = files.slice(0, limit);
  }

  const metas: ResultFileMeta[] = [];

  for (const filename of files) {
    const filePath = path.join(resultsDir, filename);
    try {
      const stat = statSync(filePath);
      const results = loadResultFile(filePath);

      const testCount = results.length;
      const passCount = results.filter((r) => r.score >= 1.0).length;
      const passRate = testCount > 0 ? passCount / testCount : 0;
      const avgScore = testCount > 0 ? results.reduce((sum, r) => sum + r.score, 0) / testCount : 0;

      // Extract timestamp from filename or first record
      const filenameTimestamp = extractTimestampFromFilename(filename);
      const timestamp = filenameTimestamp ?? results[0]?.timestamp ?? 'unknown';

      metas.push({
        path: filePath,
        filename,
        timestamp,
        testCount,
        passRate,
        avgScore,
        sizeBytes: stat.size,
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
