import {
  array,
  command,
  flag,
  multioption,
  number,
  oneOf,
  option,
  optional,
  restPositionals,
  string,
} from 'cmd-ts';

import { toSnakeCaseDeep } from '../../utils/case-conversion.js';
import { loadLightweightResults, resolveResultSourcePath } from '../results/manifest.js';

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

export interface EvalResult {
  testId: string;
  score: number;
}

interface MatchedResult {
  testId: string;
  score1: number;
  score2: number;
  delta: number;
  normalizedGain: number | null;
  outcome: 'win' | 'loss' | 'tie';
}

export interface ComparisonOutput {
  matched: MatchedResult[];
  unmatched: { file1: number; file2: number };
  summary: {
    total: number;
    matched: number;
    wins: number;
    losses: number;
    ties: number;
    meanDelta: number;
    meanNormalizedGain: number | null;
  };
  baseline?: string;
  candidate?: string;
}

interface MatrixRow {
  testId: string;
  scores: Record<string, number>;
}

interface CompareInputRecord extends EvalResult {
  target?: string;
}

function loadCompareResults(filePath: string): CompareInputRecord[] {
  return loadLightweightResults(resolveResultSourcePath(filePath)).map((record) => {
    if (!record.testId || record.testId === 'unknown') {
      throw new Error(`Missing test_id in result source: ${filePath}`);
    }
    if (typeof record.score !== 'number' || Number.isNaN(record.score)) {
      throw new Error(`Missing or invalid score in result source: ${filePath}`);
    }
    return {
      testId: record.testId,
      score: record.score,
      target: record.target,
    };
  });
}

export interface MatrixOutput {
  matrix: MatrixRow[];
  pairwise: ComparisonOutput[];
  targets: string[];
}

export function loadJsonlResults(filePath: string): EvalResult[] {
  return loadCompareResults(filePath).map(({ testId, score }) => ({ testId, score }));
}

export function loadCombinedResults(filePath: string): Map<string, EvalResult[]> {
  const groups = new Map<string, EvalResult[]>();

  for (const record of loadCompareResults(filePath)) {
    if (typeof record.target !== 'string') {
      throw new Error(`Missing target field in combined result source: ${filePath}`);
    }

    const target = record.target;
    if (!groups.has(target)) {
      groups.set(target, []);
    }
    groups.get(target)?.push({ testId: record.testId, score: record.score });
  }

  return groups;
}

/**
 * Hake's normalized gain: g = (score_candidate − score_baseline) / (1 − score_baseline)
 * Measures improvement relative to remaining headroom. Returns null when baseline is 1.0
 * (perfect score leaves no room for improvement).
 * Reference: Hake (1998), used by SkillsBench (arXiv:2602.12670).
 */
export function computeNormalizedGain(
  baselineScore: number,
  candidateScore: number,
): number | null {
  if (baselineScore >= 1.0) return null;
  return (candidateScore - baselineScore) / (1 - baselineScore);
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
  const map1 = new Map(results1.map((r) => [r.testId, r.score]));
  const map2 = new Map(results2.map((r) => [r.testId, r.score]));

  const matched: MatchedResult[] = [];
  const matchedIds = new Set<string>();

  for (const [testId, score1] of map1) {
    const score2 = map2.get(testId);
    if (score2 !== undefined) {
      const delta = score2 - score1;
      matched.push({
        testId,
        score1,
        score2,
        delta,
        normalizedGain: computeNormalizedGain(score1, score2),
        outcome: classifyOutcome(delta, threshold),
      });
      matchedIds.add(testId);
    }
  }

  const unmatchedFile1 = results1.filter((r) => !matchedIds.has(r.testId)).length;
  const unmatchedFile2 = results2.filter((r) => !map1.has(r.testId)).length;

  const wins = matched.filter((m) => m.outcome === 'win').length;
  const losses = matched.filter((m) => m.outcome === 'loss').length;
  const ties = matched.filter((m) => m.outcome === 'tie').length;

  const meanDelta =
    matched.length > 0 ? matched.reduce((sum, m) => sum + m.delta, 0) / matched.length : 0;

  const gainValues = matched.map((m) => m.normalizedGain).filter((g): g is number => g !== null);
  const meanNormalizedGain =
    gainValues.length > 0
      ? Math.round((gainValues.reduce((sum, g) => sum + g, 0) / gainValues.length) * 1000) / 1000
      : null;

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
      meanNormalizedGain,
    },
  };
}

export function compareMatrix(groups: Map<string, EvalResult[]>, threshold: number): MatrixOutput {
  const targets = [...groups.keys()].sort();

  // Collect all test IDs across all targets
  const allTestIds = new Set<string>();
  for (const results of groups.values()) {
    for (const r of results) {
      allTestIds.add(r.testId);
    }
  }
  const sortedTestIds = [...allTestIds].sort();

  // Build score lookup: target -> testId -> score
  const scoreLookup = new Map<string, Map<string, number>>();
  for (const [target, results] of groups) {
    scoreLookup.set(target, new Map(results.map((r) => [r.testId, r.score])));
  }

  // Build matrix rows
  const matrix: MatrixRow[] = sortedTestIds.map((testId) => {
    const scores: Record<string, number> = {};
    for (const target of targets) {
      const score = scoreLookup.get(target)?.get(testId);
      if (score !== undefined) {
        scores[target] = score;
      }
    }
    return { testId, scores };
  });

  // Run pairwise comparisons for all target pairs
  const pairwise: ComparisonOutput[] = [];
  for (let i = 0; i < targets.length; i++) {
    for (let j = i + 1; j < targets.length; j++) {
      const t1 = targets[i];
      const t2 = targets[j];
      const r1 = groups.get(t1) ?? [];
      const r2 = groups.get(t2) ?? [];
      const comparison = compareResults(r1, r2, threshold);
      comparison.baseline = t1;
      comparison.candidate = t2;
      pairwise.push(comparison);
    }
  }

  return { matrix, pairwise, targets };
}

export function determineExitCode(meanDelta: number): number {
  // Exit 0 if file2 >= file1 (meanDelta >= 0), exit 1 if file1 > file2
  return meanDelta >= 0 ? 0 : 1;
}

export function determineMatrixExitCode(
  matrixOutput: MatrixOutput,
  baselineTarget?: string,
): number {
  if (!baselineTarget) {
    return 0; // Informational mode
  }

  // Exit 1 if any target regresses vs baseline.
  // Pairwise pairs are generated in sorted order, so the designated baseline
  // may appear as either .baseline or .candidate depending on alphabetical position.
  for (const p of matrixOutput.pairwise) {
    if (p.baseline === baselineTarget && p.summary.meanDelta < 0) {
      // candidate scored lower than baseline → regression
      return 1;
    }
    if (p.candidate === baselineTarget && p.summary.meanDelta > 0) {
      // baseline scored higher than the other target → other regressed
      return 1;
    }
  }
  return 0;
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
    lines.push(`${c.yellow}No matching test IDs found between files.${c.reset}`);
  } else {
    // Calculate column widths
    const maxIdLen = Math.max(
      7, // "Test ID"
      ...comparison.matched.map((m) => m.testId.length),
    );

    // Table header
    const header = `  ${padRight('Test ID', maxIdLen)}  ${padLeft('Baseline', 8)}  ${padLeft('Candidate', 9)}  ${padLeft('Delta', 8)}  Result`;
    lines.push(`${c.dim}${header}${c.reset}`);
    lines.push(
      `${c.dim}  ${'─'.repeat(maxIdLen)}  ${'─'.repeat(8)}  ${'─'.repeat(9)}  ${'─'.repeat(8)}  ${'─'.repeat(8)}${c.reset}`,
    );

    // Table rows
    for (const m of comparison.matched) {
      const row = `  ${padRight(m.testId, maxIdLen)}  ${padLeft(m.score1.toFixed(2), 8)}  ${padLeft(m.score2.toFixed(2), 9)}  ${padLeft(formatDelta(m.delta), 8)}  ${formatOutcome(m.outcome)}`;
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
  const { wins, losses, ties, meanDelta, meanNormalizedGain } = comparison.summary;

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

  let summaryLine = `${c.bold}Summary:${c.reset} ${winStr}, ${lossStr}, ${tieStr} | Mean Δ: ${deltaColor}${deltaSign}${meanDelta.toFixed(3)}${c.reset}`;
  if (meanNormalizedGain != null) {
    const gColor = meanNormalizedGain > 0 ? c.green : meanNormalizedGain < 0 ? c.red : c.gray;
    const gSign = meanNormalizedGain >= 0 ? '+' : '';
    summaryLine += ` | g: ${gColor}${gSign}${meanNormalizedGain.toFixed(3)}${c.reset}`;
  }
  summaryLine += ` | Status: ${status}`;

  lines.push(summaryLine);
  lines.push('');

  return lines.join('\n');
}

export function formatMatrix(matrixOutput: MatrixOutput, baselineTarget?: string): string {
  const { matrix, pairwise, targets } = matrixOutput;
  const lines: string[] = [];

  lines.push('');
  lines.push(`${c.bold}Score Matrix${c.reset}`);
  lines.push('');

  if (matrix.length === 0) {
    lines.push(`${c.yellow}No results found.${c.reset}`);
    return lines.join('\n');
  }

  // Calculate column widths
  const testIdWidth = Math.max(
    7, // "Test ID"
    ...matrix.map((r) => r.testId.length),
  );
  const targetWidths = targets.map((t) => Math.max(t.length, 6));

  // Header row
  let header = `  ${padRight('Test ID', testIdWidth)}`;
  for (let i = 0; i < targets.length; i++) {
    header += `  ${padLeft(targets[i], targetWidths[i])}`;
  }
  lines.push(`${c.dim}${header}${c.reset}`);

  // Separator
  let sep = `  ${'─'.repeat(testIdWidth)}`;
  for (let i = 0; i < targets.length; i++) {
    sep += `  ${'─'.repeat(targetWidths[i])}`;
  }
  lines.push(`${c.dim}${sep}${c.reset}`);

  // Data rows
  for (const row of matrix) {
    let line = `  ${padRight(row.testId, testIdWidth)}`;
    for (let i = 0; i < targets.length; i++) {
      const score = row.scores[targets[i]];
      const scoreStr = score !== undefined ? score.toFixed(2) : '  --';
      // Highlight regressions vs baseline
      if (baselineTarget && targets[i] !== baselineTarget && score !== undefined) {
        const baselineScore = row.scores[baselineTarget];
        if (baselineScore !== undefined && score < baselineScore) {
          line += `  ${padLeft(`${c.red}${scoreStr}${c.reset}`, targetWidths[i])}`;
        } else if (baselineScore !== undefined && score > baselineScore) {
          line += `  ${padLeft(`${c.green}${scoreStr}${c.reset}`, targetWidths[i])}`;
        } else {
          line += `  ${padLeft(scoreStr, targetWidths[i])}`;
        }
      } else {
        line += `  ${padLeft(scoreStr, targetWidths[i])}`;
      }
    }
    lines.push(line);
  }

  // Pairwise summary
  if (pairwise.length > 0) {
    lines.push('');
    lines.push(`${c.bold}Pairwise Summary:${c.reset}`);

    const maxLabelLen = Math.max(
      ...pairwise.map((pw) => `  ${pw.baseline} → ${pw.candidate}:`.length),
    );
    for (const p of pairwise) {
      const { wins, losses, ties, meanDelta, meanNormalizedGain } = p.summary;
      const sign = meanDelta >= 0 ? '+' : '';
      const deltaColor = meanDelta > 0 ? c.green : meanDelta < 0 ? c.red : c.gray;
      const label = `  ${p.baseline} → ${p.candidate}:`;
      let pairLine = `${padRight(label, maxLabelLen)}  ${wins} win${wins !== 1 ? 's' : ''}, ${losses} loss${losses !== 1 ? 'es' : ''}, ${ties} tie${ties !== 1 ? 's' : ''}  (${c.bold}Δ${c.reset} ${deltaColor}${sign}${meanDelta.toFixed(3)}${c.reset}`;
      if (meanNormalizedGain != null) {
        const gColor = meanNormalizedGain > 0 ? c.green : meanNormalizedGain < 0 ? c.red : c.gray;
        const gSign = meanNormalizedGain >= 0 ? '+' : '';
        pairLine += `, ${c.bold}g${c.reset} ${gColor}${gSign}${meanNormalizedGain.toFixed(3)}${c.reset}`;
      }
      pairLine += ')';
      lines.push(pairLine);
    }
  }

  lines.push('');
  return lines.join('\n');
}

export const compareCommand = command({
  name: 'compare',
  description:
    'Compare evaluation run manifests: two-run pairwise, single-run pairwise, or N-way matrix',
  args: {
    results: restPositionals({
      type: string,
      displayName: 'results',
      description:
        'Run workspace or index.jsonl manifest path(s). One source: single-run mode. Two sources: pairwise mode.',
    }),
    threshold: option({
      type: optional(number),
      long: 'threshold',
      short: 't',
      description: 'Score delta threshold for win/loss classification (default: 0.1)',
    }),
    baseline: option({
      type: optional(string),
      long: 'baseline',
      short: 'b',
      description: 'Target name to use as baseline (filters a single run manifest)',
    }),
    candidate: option({
      type: optional(string),
      long: 'candidate',
      short: 'c',
      description: 'Target name to use as candidate (filters a single run manifest)',
    }),
    targets: multioption({
      type: array(string),
      long: 'targets',
      description: 'Target names to include in matrix comparison (repeatable)',
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
  handler: async ({ results, threshold, baseline, candidate, targets, format, json }) => {
    const effectiveThreshold = threshold ?? 0.1;
    const outputFormat = json ? 'json' : (format ?? 'table');

    try {
      if (results.length === 0) {
        throw new Error('At least one run workspace or index.jsonl manifest is required');
      }

      if (results.length === 2) {
        // Two-file pairwise mode (existing behavior)
        const results1 = loadJsonlResults(results[0]);
        const results2 = loadJsonlResults(results[1]);
        const comparison = compareResults(results1, results2, effectiveThreshold);

        if (outputFormat === 'json') {
          console.log(JSON.stringify(toSnakeCaseDeep(comparison), null, 2));
        } else {
          console.log(formatTable(comparison, results[0], results[1]));
        }

        const exitCode = determineExitCode(comparison.summary.meanDelta);
        process.exit(exitCode);
      } else if (results.length === 1) {
        // Single-run manifest mode
        let groups = loadCombinedResults(results[0]);

        // Filter by --targets if specified
        if (targets.length > 0) {
          const filtered = new Map<string, EvalResult[]>();
          for (const t of targets) {
            const group = groups.get(t);
            if (group) {
              filtered.set(t, group);
            }
          }
          if (filtered.size === 0) {
            const available = [...groups.keys()].join(', ');
            throw new Error(
              `None of the specified targets found in results. Available targets: ${available}`,
            );
          }
          groups = filtered;
        }

        // Validate --baseline target exists in (possibly filtered) groups
        if (baseline && !groups.has(baseline)) {
          const available = [...groups.keys()].join(', ');
          throw new Error(
            `Baseline target "${baseline}" not found in results. Available targets: ${available}`,
          );
        }

        if (candidate && !baseline) {
          throw new Error(
            '--candidate requires --baseline. Use both flags for pairwise comparison.',
          );
        }

        if (baseline && candidate) {
          // Pairwise mode from a single run manifest
          const baselineResults = groups.get(baseline);
          const candidateResults = groups.get(candidate);
          if (!baselineResults) {
            throw new Error(`Baseline target "${baseline}" not found in results`);
          }
          if (!candidateResults) {
            throw new Error(`Candidate target "${candidate}" not found in results`);
          }

          const comparison = compareResults(baselineResults, candidateResults, effectiveThreshold);

          if (outputFormat === 'json') {
            console.log(JSON.stringify(toSnakeCaseDeep(comparison), null, 2));
          } else {
            console.log(formatTable(comparison, baseline, candidate));
          }

          const exitCode = determineExitCode(comparison.summary.meanDelta);
          process.exit(exitCode);
        } else {
          // N-way matrix mode
          const matrixOutput = compareMatrix(groups, effectiveThreshold);

          if (outputFormat === 'json') {
            console.log(JSON.stringify(toSnakeCaseDeep(matrixOutput), null, 2));
          } else {
            console.log(formatMatrix(matrixOutput, baseline));
          }

          const exitCode = determineMatrixExitCode(matrixOutput, baseline);
          process.exit(exitCode);
        }
      } else {
        throw new Error('Expected 1 or 2 run workspaces or index.jsonl manifests');
      }
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  },
});
