import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface BaselineSummary {
  readonly path: string;
  readonly testIds: readonly string[];
}

export function baselinePathFor(evalSourcePath: string): string {
  return evalSourcePath.replace(/\.ya?ml$/i, '.baseline.jsonl');
}

export function readBaselineSummary(evalSourcePath: string): BaselineSummary | undefined {
  if (!/\.ya?ml$/i.test(evalSourcePath)) return undefined;
  const baselinePath = baselinePathFor(evalSourcePath);
  if (!existsSync(baselinePath)) return undefined;

  const lines = readFileSync(baselinePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    path: path.basename(baselinePath),
    testIds: lines.map((line) => String(JSON.parse(line).test_id ?? JSON.parse(line).testId ?? '')),
  };
}
