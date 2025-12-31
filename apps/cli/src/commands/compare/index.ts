import { readFileSync } from 'node:fs';
import { command, number, option, optional, positional, string } from 'cmd-ts';

interface EvalResult {
  eval_id: string;
  score: number;
}

interface MatchedResult {
  eval_id: string;
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
    return { eval_id: record.eval_id, score: record.score };
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
  const map1 = new Map(results1.map((r) => [r.eval_id, r.score]));
  const map2 = new Map(results2.map((r) => [r.eval_id, r.score]));

  const matched: MatchedResult[] = [];
  const matchedIds = new Set<string>();

  for (const [evalId, score1] of map1) {
    const score2 = map2.get(evalId);
    if (score2 !== undefined) {
      const delta = score2 - score1;
      matched.push({
        eval_id: evalId,
        score1,
        score2,
        delta,
        outcome: classifyOutcome(delta, threshold),
      });
      matchedIds.add(evalId);
    }
  }

  const unmatchedFile1 = results1.filter((r) => !matchedIds.has(r.eval_id)).length;
  const unmatchedFile2 = results2.filter((r) => !map1.has(r.eval_id)).length;

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
  },
  handler: async ({ result1, result2, threshold }) => {
    const effectiveThreshold = threshold ?? 0.1;

    try {
      const results1 = loadJsonlResults(result1);
      const results2 = loadJsonlResults(result2);

      const comparison = compareResults(results1, results2, effectiveThreshold);

      console.log(JSON.stringify(comparison, null, 2));

      const exitCode = determineExitCode(comparison.summary.meanDelta);
      process.exit(exitCode);
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  },
});
