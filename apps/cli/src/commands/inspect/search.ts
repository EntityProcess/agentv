/**
 * `agentv inspect search` — regex search across evaluation results and transcripts.
 *
 * Scans JSONL files in `.agentv/results/runs/` and `.agentv/transcripts/` for
 * lines matching a regex pattern. Outputs file path, test_id, and matching
 * content with surrounding context.
 *
 * Supported sources:
 * - Run result manifests (index.jsonl) — searches serialized JSON content
 * - Transcript JSONL files — searches message content and tool call data
 *
 * To extend: add new scanners in the `scanSources()` function for additional
 * JSONL-based data directories.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { command, option, optional, positional, string } from 'cmd-ts';
import { c, padRight } from './utils.js';

/** A single search match within a JSONL line. */
export interface SearchMatch {
  /** Absolute path to the source file. */
  file: string;
  /** Identifier extracted from the record (test_id, session_id, etc.). */
  id: string;
  /** The line number within the file (1-based). */
  lineNumber: number;
  /** The matched text snippet with surrounding context. */
  snippet: string;
  /** Optional metadata: target, experiment, score. */
  target?: string;
  experiment?: string;
  score?: number;
}

/**
 * Recursively collect all JSONL files under a directory.
 */
function collectJsonlFiles(dir: string): string[] {
  const files: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...collectJsonlFiles(fullPath));
      } else if (entry.name.endsWith('.jsonl')) {
        files.push(fullPath);
      }
    }
  } catch {
    // Directory may not exist
  }
  return files;
}

/**
 * Extract a human-readable snippet around a regex match within a string.
 * Returns up to `contextChars` characters on each side of the match.
 */
function extractSnippet(text: string, matchIndex: number, matchLength: number, contextChars = 60): string {
  const start = Math.max(0, matchIndex - contextChars);
  const end = Math.min(text.length, matchIndex + matchLength + contextChars);
  let snippet = text.slice(start, end);
  if (start > 0) snippet = `...${snippet}`;
  if (end < text.length) snippet = `${snippet}...`;
  // Collapse whitespace for readability
  return snippet.replace(/\n/g, '\\n').replace(/\r/g, '');
}

/**
 * Search a single JSONL file for regex matches.
 */
export function searchJsonlFile(
  filePath: string,
  regex: RegExp,
  targetFilter?: string,
  experimentFilter?: string,
): SearchMatch[] {
  const matches: SearchMatch[] = [];
  let content: string;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    return matches;
  }

  const lines = content.split('\n').filter((line) => line.trim());

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    // Extract metadata for filtering
    const target = typeof record.target === 'string' ? record.target : undefined;
    const experiment = typeof record.experiment === 'string' ? record.experiment : undefined;
    const score = typeof record.score === 'number' ? record.score : undefined;
    const testId =
      typeof record.test_id === 'string'
        ? record.test_id
        : typeof record.source === 'object' && record.source !== null
          ? (record.source as Record<string, unknown>).session_id as string | undefined
          : undefined;

    // Apply metadata filters before regex search
    if (targetFilter && target !== targetFilter) continue;
    if (experimentFilter && experiment !== experimentFilter) continue;

    // Search the entire serialized line for the pattern
    const match = regex.exec(line);
    if (match) {
      matches.push({
        file: filePath,
        id: testId ?? `line-${i + 1}`,
        lineNumber: i + 1,
        snippet: extractSnippet(line, match.index, match[0].length),
        target,
        experiment,
        score,
      });
    }
  }

  return matches;
}

/**
 * Discover all searchable JSONL sources under a base path.
 * If the path is a file, search that single file.
 * If it's a directory, recursively find all .jsonl files.
 * If not specified, scan both .agentv/results/runs/ and .agentv/transcripts/.
 */
function discoverSources(basePath: string | undefined, cwd: string): string[] {
  if (basePath) {
    const resolved = path.isAbsolute(basePath) ? basePath : path.resolve(cwd, basePath);
    try {
      if (statSync(resolved).isDirectory()) {
        return collectJsonlFiles(resolved);
      }
    } catch {
      // Not a directory — treat as file
    }
    return [resolved];
  }

  // Default: scan both results and transcripts
  const sources: string[] = [];
  sources.push(...collectJsonlFiles(path.join(cwd, '.agentv', 'results', 'runs')));
  sources.push(...collectJsonlFiles(path.join(cwd, '.agentv', 'transcripts')));
  return sources;
}

function formatSearchResults(matches: SearchMatch[], pattern: string): string {
  const lines: string[] = [];

  if (matches.length === 0) {
    lines.push(`${c.yellow}No matches found for pattern: ${pattern}${c.reset}`);
    return lines.join('\n');
  }

  lines.push('');
  lines.push(
    `${c.bold}Search Results${c.reset} ${c.dim}pattern: /${pattern}/${c.reset}`,
  );
  lines.push(`${c.dim}${matches.length} match${matches.length !== 1 ? 'es' : ''} found${c.reset}`);
  lines.push('');

  // Group by file
  const byFile = new Map<string, SearchMatch[]>();
  for (const match of matches) {
    const existing = byFile.get(match.file) ?? [];
    existing.push(match);
    byFile.set(match.file, existing);
  }

  for (const [file, fileMatches] of byFile) {
    lines.push(`${c.cyan}${file}${c.reset}`);

    for (const match of fileMatches) {
      const meta: string[] = [];
      if (match.target) meta.push(`target:${match.target}`);
      if (match.experiment) meta.push(`exp:${match.experiment}`);
      if (match.score !== undefined) meta.push(`score:${match.score}`);
      const metaStr = meta.length > 0 ? ` ${c.dim}[${meta.join(', ')}]${c.reset}` : '';

      lines.push(
        `  ${c.bold}${match.id}${c.reset} ${c.dim}(line ${match.lineNumber})${c.reset}${metaStr}`,
      );
      lines.push(`    ${match.snippet}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export const inspectSearchCommand = command({
  name: 'search',
  description:
    'Search across evaluation results and transcripts for a regex pattern',
  args: {
    pattern: option({
      type: string,
      long: 'pattern',
      short: 'p',
      description: 'Regex pattern to search for in result/transcript content',
    }),
    path: positional({
      type: optional(string),
      displayName: 'path',
      description:
        'Directory or file to search (default: .agentv/results/runs/ and .agentv/transcripts/)',
    }),
    target: option({
      type: optional(string),
      long: 'target',
      description: 'Filter results to a specific target name',
    }),
    experiment: option({
      type: optional(string),
      long: 'experiment',
      description: 'Filter results to a specific experiment name',
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
  handler: async ({ pattern, path: searchPath, target, experiment, dir, format }) => {
    const cwd = dir ?? process.cwd();

    // Compile the regex
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, 'i');
    } catch (err) {
      console.error(
        `${c.red}Error:${c.reset} Invalid regex pattern: ${(err as Error).message}`,
      );
      process.exit(1);
    }

    // Discover files to search
    const sources = discoverSources(searchPath, cwd);
    if (sources.length === 0) {
      console.error(
        `${c.yellow}No JSONL files found to search.${c.reset}`,
      );
      console.error(
        `${c.dim}Run an evaluation first, or specify a path to search.${c.reset}`,
      );
      process.exit(0);
    }

    // Search all sources
    const allMatches: SearchMatch[] = [];
    for (const source of sources) {
      const fileMatches = searchJsonlFile(source, regex, target, experiment);
      allMatches.push(...fileMatches);
    }

    if (format === 'json') {
      console.log(JSON.stringify(allMatches, null, 2));
    } else {
      console.log(formatSearchResults(allMatches, pattern));
    }
  },
});
