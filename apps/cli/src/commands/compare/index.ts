import { readFileSync } from 'node:fs';
import { command, flag, number, oneOf, option, optional, positional, string } from 'cmd-ts';
import { toSnakeCaseDeep } from '../../utils/case-conversion.js';

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

// Check if colors should be disabled
const noColor = process.env.NO_COLOR !== undefined || !process.stdout.isTTY;
const c = noColor ? Object.fromEntries(Object.keys(colors).map((k) => [k, ''])) : colors;

interface EvalResult {
  evalId: string;
  score: number;
}

interface MatchedResult {
  evalId: string;
  score1: number;
  score2: number;
  delta: number;
  outcome: 'win' | 'loss' | 'tie';
}

interface ComparisonOutput {
  matched: MatchedResult[];
  unmatched: { file1: number; file2: number };
  summary: {
    total: number;
    matched: number;
    wins: number;
    losses: number;
    ties: number;
    meanDelta: number;
  };
}

export function loadJsonlResults(filePath: string): EvalResult[] {
  const content = readFileSync(filePath, 'utf8');
  const lines = content
    .trim()
    .split('\n')
    .filter((line) => line.trim());

  return lines.map((line) => {
    const record = JSON.parse(line) as { eval_id?: string; score?: number };
    if (typeof record.eval_id !== 'string') {
      throw new Error(`Missing eval_id in result: ${line}`);
    }
    if (typeof record.score !== 'number') {
      throw new Error(`Missing or invalid score in result: ${line}`);
    }
    return { evalId: record.eval_id, score: record.score };
  });
}

export function classifyOutcome(delta: number, threshold: number): 'win' | 'loss' | 'tie' {
  if (delta >= threshold) return 'win';
  if (delta <= -threshold) return 'loss';
  return 'tie';
}

export function compareResults(
  results1: EvalResult[],
  results2: EvalResult[],
  threshold: number,
): ComparisonOutput {
  const map1 = new Map(results1.map((r) => [r.evalId, r.score]));
  const map2 = new Map(results2.map((r) => [r.evalId, r.score]));

  const matched: MatchedResult[] = [];
  const matchedIds = new Set<string>();

  for (const [evalId, score1] of map1) {
    const score2 = map2.get(evalId);
    if (score2 !== undefined) {
      const delta = score2 - score1;
      matched.push({
        evalId: evalId,
        score1,
        score2,
        delta,
        outcome: classifyOutcome(delta, threshold),
      });
      matchedIds.add(evalId);
    }
  }

  const unmatchedFile1 = results1.filter((r) => !matchedIds.has(r.evalId)).length;
  const unmatchedFile2 = results2.filter((r) => !map1.has(r.evalId)).length;

  const wins = matched.filter((m) => m.outcome === 'win').length;
  const losses = matched.filter((m) => m.outcome === 'loss').length;
  const ties = matched.filter((m) => m.outcome === 'tie').length;

  const meanDelta =
    matched.length > 0 ? matched.reduce((sum, m) => sum + m.delta, 0) / matched.length : 0;

  return {
    matched,
    unmatched: { file1: unmatchedFile1, file2: unmatchedFile2 },
    summary: {
      total: results1.length + results2.length,
      matched: matched.length,
      wins,
      losses,
      ties,
      meanDelta: Math.round(meanDelta * 1000) / 1000,
    },
  };
}

export function determineExitCode(meanDelta: number): number {
  // Exit 0 if file2 >= file1 (meanDelta >= 0), exit 1 if file1 > file2
  return meanDelta >= 0 ? 0 : 1;
}

function formatDelta(delta: number): string {
  const sign = delta >= 0 ? '+' : '';
  const formatted = `${sign}${delta.toFixed(2)}`;
  if (delta > 0) return `${c.green}${formatted}${c.reset}`;
  if (delta < 0) return `${c.red}${formatted}${c.reset}`;
  return `${c.gray}${formatted}${c.reset}`;
}

function formatOutcome(outcome: 'win' | 'loss' | 'tie'): string {
  switch (outcome) {
    case 'win':
      return `${c.green}✓ win${c.reset}`;
    case 'loss':
      return `${c.red}✗ loss${c.reset}`;
    case 'tie':
      return `${c.gray}= tie${c.reset}`;
  }
}

// Regex to strip ANSI escape codes (constructed to avoid lint warning)
const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

function stripAnsi(str: string): string {
  return str.replace(ansiPattern, '');
}

function padRight(str: string, len: number): string {
  const plainLen = stripAnsi(str).length;
  return str + ' '.repeat(Math.max(0, len - plainLen));
}

function padLeft(str: string, len: number): string {
  const plainLen = stripAnsi(str).length;
  return ' '.repeat(Math.max(0, len - plainLen)) + str;
}

export function formatTable(comparison: ComparisonOutput, file1: string, file2: string): string {
  const lines: string[] = [];

  // Header
  lines.push('');
  lines.push(
    `${c.bold}Comparing:${c.reset} ${c.cyan}${file1}${c.reset} → ${c.cyan}${file2}${c.reset}`,
  );
  lines.push('');

  if (comparison.matched.length === 0) {
    lines.push(`${c.yellow}No matching eval IDs found between files.${c.reset}`);
  } else {
    // Calculate column widths
    const maxIdLen = Math.max(
      7, // "Eval ID"
      ...comparison.matched.map((m) => m.evalId.length),
    );

    // Table header
    const header = `  ${padRight('Eval ID', maxIdLen)}  ${padLeft('Baseline', 8)}  ${padLeft('Candidate', 9)}  ${padLeft('Delta', 8)}  Result`;
    lines.push(`${c.dim}${header}${c.reset}`);
    lines.push(
      `${c.dim}  ${'─'.repeat(maxIdLen)}  ${'─'.repeat(8)}  ${'─'.repeat(9)}  ${'─'.repeat(8)}  ${'─'.repeat(8)}${c.reset}`,
    );

    // Table rows
    for (const m of comparison.matched) {
      const row = `  ${padRight(m.evalId, maxIdLen)}  ${padLeft(m.score1.toFixed(2), 8)}  ${padLeft(m.score2.toFixed(2), 9)}  ${padLeft(formatDelta(m.delta), 8)}  ${formatOutcome(m.outcome)}`;
      lines.push(row);
    }
  }

  // Unmatched warning
  if (comparison.unmatched.file1 > 0 || comparison.unmatched.file2 > 0) {
    lines.push('');
    lines.push(
      `${c.yellow}⚠ Unmatched:${c.reset} ${comparison.unmatched.file1} in baseline, ${comparison.unmatched.file2} in candidate`,
    );
  }

  // Summary
  lines.push('');
  const { wins, losses, ties, meanDelta } = comparison.summary;

  const winStr =
    wins > 0 ? `${c.green}${wins} win${wins !== 1 ? 's' : ''}${c.reset}` : `${wins} wins`;
  const lossStr =
    losses > 0 ? `${c.red}${losses} loss${losses !== 1 ? 'es' : ''}${c.reset}` : `${losses} losses`;
  const tieStr = `${ties} tie${ties !== 1 ? 's' : ''}`;

  const deltaColor = meanDelta > 0 ? c.green : meanDelta < 0 ? c.red : c.gray;
  const deltaSign = meanDelta >= 0 ? '+' : '';
  const status =
    meanDelta > 0
      ? `${c.green}improved${c.reset}`
      : meanDelta < 0
        ? `${c.red}regressed${c.reset}`
        : `${c.gray}neutral${c.reset}`;

  lines.push(
    `${c.bold}Summary:${c.reset} ${winStr}, ${lossStr}, ${tieStr} | Mean Δ: ${deltaColor}${deltaSign}${meanDelta.toFixed(3)}${c.reset} | Status: ${status}`,
  );
  lines.push('');

  return lines.join('\n');
}

export const compareCommand = command({
  name: 'compare',
  description: 'Compare two evaluation result files and compute score differences',
  args: {
    result1: positional({
      type: string,
      displayName: 'result1',
      description: 'Path to first JSONL result file (baseline)',
    }),
    result2: positional({
      type: string,
      displayName: 'result2',
      description: 'Path to second JSONL result file (candidate)',
    }),
    threshold: option({
      type: optional(number),
      long: 'threshold',
      short: 't',
      description: 'Score delta threshold for win/loss classification (default: 0.1)',
    }),
    format: option({
      type: optional(oneOf(['table', 'json'])),
      long: 'format',
      short: 'f',
      description: 'Output format: table (default, human-readable) or json (machine-readable)',
    }),
    json: flag({
      long: 'json',
      description: 'Output JSON format (shorthand for --format=json)',
    }),
  },
  handler: async ({ result1, result2, threshold, format, json }) => {
    const effectiveThreshold = threshold ?? 0.1;
    // --json flag or --format=json triggers JSON output
    const outputFormat = json ? 'json' : (format ?? 'table');

    try {
      const results1 = loadJsonlResults(result1);
      const results2 = loadJsonlResults(result2);

      const comparison = compareResults(results1, results2, effectiveThreshold);

      if (outputFormat === 'json') {
        // Convert to snake_case for Python ecosystem compatibility
        console.log(JSON.stringify(toSnakeCaseDeep(comparison), null, 2));
      } else {
        console.log(formatTable(comparison, result1, result2));
      }

      const exitCode = determineExitCode(comparison.summary.meanDelta);
      process.exit(exitCode);
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  },
});
