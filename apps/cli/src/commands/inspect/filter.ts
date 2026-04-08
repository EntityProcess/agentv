/**
 * `agentv inspect filter` — filter evaluation results by metadata criteria.
 *
 * Scans JSONL index files in `.agentv/results/runs/` and applies filters
 * such as target name, experiment name, score thresholds, execution status,
 * and tool usage. Outputs matching test IDs with summary info.
 *
 * Each filter is optional and combinable (AND logic). Results must match
 * all specified filters to be included.
 *
 * To extend: add new filter predicates in `buildFilterPredicate()`.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { command, number, option, optional, positional, string } from 'cmd-ts';
import { c, formatScore, padLeft, padRight } from './utils.js';

/** A lightweight result record with fields needed for filtering. */
export interface FilterableRecord {
  file: string;
  test_id: string;
  suite?: string;
  target?: string;
  experiment?: string;
  score: number;
  execution_status?: string;
  error?: string;
  timestamp?: string;
  /** Flattened set of tool names found in trace.tool_calls or output messages. */
  tool_names: string[];
}

/**
 * Recursively collect all index.jsonl files under the runs directory.
 */
function collectIndexFiles(dir: string): string[] {
  const files: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...collectIndexFiles(fullPath));
      } else if (entry.name === 'index.jsonl') {
        files.push(fullPath);
      }
    }
  } catch {
    // Directory may not exist
  }
  return files;
}

/**
 * Extract tool names from a result record.
 * Looks in trace.tool_calls (Record<string, number>) and output messages (tool_calls[].tool).
 */
function extractToolNames(record: Record<string, unknown>): string[] {
  const tools = new Set<string>();

  // From trace.tool_calls
  const trace = record.trace as Record<string, unknown> | undefined;
  if (trace?.tool_calls && typeof trace.tool_calls === 'object') {
    for (const name of Object.keys(trace.tool_calls as Record<string, unknown>)) {
      tools.add(name);
    }
  }

  // From output messages (array of messages with tool_calls)
  const output = record.output;
  if (Array.isArray(output)) {
    for (const msg of output) {
      if (typeof msg === 'object' && msg !== null && Array.isArray((msg as Record<string, unknown>).tool_calls)) {
        for (const tc of (msg as Record<string, unknown>).tool_calls as Record<string, unknown>[]) {
          if (typeof tc.tool === 'string') {
            tools.add(tc.tool);
          }
        }
      }
    }
  }

  // From scores[].type or scores[].assertions evidence mentioning tools
  // (kept minimal — primary source is trace.tool_calls and output messages)

  return [...tools];
}

/**
 * Parse a single JSONL index file into filterable records.
 */
export function parseFilterableRecords(
  filePath: string,
): FilterableRecord[] {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }

  const lines = content.split('\n').filter((line) => line.trim());
  const records: FilterableRecord[] = [];

  for (const line of lines) {
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    // Determine experiment from record or from directory path
    let experiment = typeof raw.experiment === 'string' ? raw.experiment : undefined;
    if (!experiment) {
      // Infer from path: .agentv/results/runs/<experiment>/<timestamp>/index.jsonl
      const parts = filePath.split(path.sep);
      const runsIdx = parts.indexOf('runs');
      // If there are 2+ segments between "runs" and the file, the first is the experiment
      if (runsIdx !== -1 && parts.length - runsIdx >= 3) {
        const candidate = parts[runsIdx + 1];
        // "default" experiment or named experiments; skip if it looks like a timestamp
        if (candidate && !/^\d{4}-\d{2}-\d{2}T/.test(candidate)) {
          experiment = candidate;
        }
      }
    }

    records.push({
      file: filePath,
      test_id: typeof raw.test_id === 'string' ? raw.test_id : `unknown`,
      suite: typeof raw.suite === 'string' ? raw.suite : undefined,
      target: typeof raw.target === 'string' ? raw.target : undefined,
      experiment,
      score: typeof raw.score === 'number' ? raw.score : 0,
      execution_status: typeof raw.execution_status === 'string' ? raw.execution_status : undefined,
      error: typeof raw.error === 'string' ? raw.error : undefined,
      timestamp: typeof raw.timestamp === 'string' ? raw.timestamp : undefined,
      tool_names: extractToolNames(raw),
    });
  }

  return records;
}

/** Filter predicate that checks all criteria. */
export type FilterPredicate = (record: FilterableRecord) => boolean;

export function buildFilterPredicate(opts: {
  target?: string;
  experiment?: string;
  scoreBelow?: number;
  scoreAbove?: number;
  status?: string;
  hasTool?: string;
}): FilterPredicate {
  return (record) => {
    if (opts.target && record.target !== opts.target) return false;
    if (opts.experiment && record.experiment !== opts.experiment) return false;
    if (opts.scoreBelow !== undefined && record.score >= opts.scoreBelow) return false;
    if (opts.scoreAbove !== undefined && record.score <= opts.scoreAbove) return false;
    if (opts.status) {
      // Map user-friendly names to execution_status values
      const statusMap: Record<string, string[]> = {
        pass: ['ok'],
        fail: ['quality_failure'],
        error: ['error', 'timeout', 'provider_error'],
      };
      const allowedStatuses = statusMap[opts.status] ?? [opts.status];
      if (record.execution_status && !allowedStatuses.includes(record.execution_status)) return false;
      if (!record.execution_status) {
        // Infer from score if execution_status is missing
        if (opts.status === 'pass' && record.score < 1) return false;
        if (opts.status === 'fail' && record.score >= 1) return false;
        if (opts.status === 'error' && !record.error) return false;
      }
    }
    if (opts.hasTool) {
      const toolPattern = opts.hasTool.toLowerCase();
      const hasMatch = record.tool_names.some((t) => t.toLowerCase().includes(toolPattern));
      if (!hasMatch) return false;
    }
    return true;
  };
}

function discoverFilterSources(searchPath: string | undefined, cwd: string): string[] {
  if (searchPath) {
    const resolved = path.isAbsolute(searchPath) ? searchPath : path.resolve(cwd, searchPath);
    try {
      if (statSync(resolved).isDirectory()) {
        return collectIndexFiles(resolved);
      }
    } catch {
      // Fall through
    }
    return [resolved];
  }

  return collectIndexFiles(path.join(cwd, '.agentv', 'results', 'runs'));
}

function formatFilterTable(records: FilterableRecord[]): string {
  const lines: string[] = [];

  if (records.length === 0) {
    lines.push(`${c.yellow}No matching results found.${c.reset}`);
    return lines.join('\n');
  }

  lines.push('');
  lines.push(
    `${c.bold}Filtered Results${c.reset} ${c.dim}(${records.length} match${records.length !== 1 ? 'es' : ''})${c.reset}`,
  );
  lines.push('');

  // Compute column widths
  const maxIdLen = Math.min(32, Math.max(7, ...records.map((r) => r.test_id.length)));
  const maxTargetLen = Math.min(16, Math.max(6, ...records.map((r) => (r.target ?? '').length)));
  const maxExpLen = Math.min(20, Math.max(10, ...records.map((r) => (r.experiment ?? '').length)));

  // Header
  const header = `  ${padRight('Test ID', maxIdLen)}  ${padRight('Target', maxTargetLen)}  ${padRight('Experiment', maxExpLen)}  ${padLeft('Score', 6)}  Status`;
  lines.push(`${c.dim}${header}${c.reset}`);
  lines.push(
    `${c.dim}  ${'─'.repeat(maxIdLen)}  ${'─'.repeat(maxTargetLen)}  ${'─'.repeat(maxExpLen)}  ${'─'.repeat(6)}  ${'─'.repeat(16)}${c.reset}`,
  );

  for (const record of records) {
    const scoreColor = record.score >= 1 ? c.green : record.score >= 0.5 ? c.yellow : c.red;
    const status = record.execution_status ?? (record.error ? 'error' : record.score >= 1 ? 'ok' : 'quality_failure');
    const statusColor = status === 'ok' ? c.green : status === 'error' ? c.red : c.yellow;

    const row = `  ${padRight(record.test_id.slice(0, maxIdLen), maxIdLen)}  ${padRight((record.target ?? '-').slice(0, maxTargetLen), maxTargetLen)}  ${padRight((record.experiment ?? '-').slice(0, maxExpLen), maxExpLen)}  ${padLeft(`${scoreColor}${formatScore(record.score)}${c.reset}`, 6)}  ${statusColor}${status}${c.reset}`;
    lines.push(row);
  }

  // Summary
  lines.push('');
  const passCount = records.filter((r) => r.score >= 1).length;
  const avgScore =
    records.length > 0
      ? records.reduce((sum, r) => sum + r.score, 0) / records.length
      : 0;
  lines.push(
    `${c.dim}${records.length} result${records.length !== 1 ? 's' : ''} | ${passCount} passed | avg score: ${formatScore(avgScore)}${c.reset}`,
  );
  lines.push('');

  return lines.join('\n');
}

export const inspectFilterCommand = command({
  name: 'filter',
  description:
    'Filter evaluation results by target, experiment, score, status, or tool usage',
  args: {
    path: positional({
      type: optional(string),
      displayName: 'path',
      description:
        'Directory or file to filter (default: .agentv/results/runs/)',
    }),
    target: option({
      type: optional(string),
      long: 'target',
      description: 'Filter by target name',
    }),
    experiment: option({
      type: optional(string),
      long: 'experiment',
      description: 'Filter by experiment name',
    }),
    scoreBelow: option({
      type: optional(number),
      long: 'score-below',
      description: 'Filter to results with score below this value',
    }),
    scoreAbove: option({
      type: optional(number),
      long: 'score-above',
      description: 'Filter to results with score above this value',
    }),
    status: option({
      type: optional(string),
      long: 'status',
      description:
        'Filter by execution status: pass, fail, error (or raw value like ok, quality_failure)',
    }),
    hasTool: option({
      type: optional(string),
      long: 'has-tool',
      description: 'Filter to results that used a specific tool (substring match)',
    }),
    dir: option({
      type: optional(string),
      long: 'dir',
      short: 'd',
      description: 'Working directory (default: current directory)',
    }),
    format: option({
      type: optional(string),
      long: 'format',
      short: 'f',
      description: 'Output format: table (default) or json',
    }),
  },
  handler: async ({
    path: searchPath,
    target,
    experiment,
    scoreBelow,
    scoreAbove,
    status,
    hasTool,
    dir,
    format,
  }) => {
    const cwd = dir ?? process.cwd();

    // Discover sources
    const sources = discoverFilterSources(searchPath, cwd);
    if (sources.length === 0) {
      console.error(
        `${c.yellow}No result files found.${c.reset}`,
      );
      console.error(
        `${c.dim}Run an evaluation first, or specify a path.${c.reset}`,
      );
      process.exit(0);
    }

    // Load all records
    const allRecords: FilterableRecord[] = [];
    for (const source of sources) {
      allRecords.push(...parseFilterableRecords(source));
    }

    if (allRecords.length === 0) {
      console.error(`${c.yellow}No results found in the specified path.${c.reset}`);
      process.exit(0);
    }

    // Apply filters
    const predicate = buildFilterPredicate({
      target,
      experiment,
      scoreBelow,
      scoreAbove,
      status,
      hasTool,
    });
    const filtered = allRecords.filter(predicate);

    if (format === 'json') {
      console.log(JSON.stringify(filtered, null, 2));
    } else {
      console.log(formatFilterTable(filtered));
    }
  },
});
