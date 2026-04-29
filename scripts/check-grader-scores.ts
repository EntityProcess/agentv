/**
 * check-grader-scores.ts
 *
 * Post-processor that walks examples/**\/*.grader-scores.yaml, finds the
 * sibling *.results.jsonl produced by a prior `agentv eval --out` run, and
 * asserts each (test_id, grader, range) tuple matches the expected score range.
 *
 * Usage:
 *   bun scripts/check-grader-scores.ts
 *
 * To add score checks for a new eval:
 *   1. Create <eval-stem>.grader-scores.yaml next to <eval-stem>.eval.yaml.
 *   2. Populate it with (test_id, grader, range) entries.
 *   3. Run the eval with --out to produce the sibling results file:
 *        bun apps/cli/src/cli.ts eval <eval-stem>.eval.yaml --target <t> \
 *          --out <eval-stem>.results.jsonl
 *   4. Run this script to verify.
 */

import { globSync } from 'node:fs';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Range {
  min?: number;
  max?: number;
}

interface GraderScoreEntry {
  test_id: string;
  grader: string;
  range: Range;
}

interface JsonlScore {
  name: string;
  score: number;
}

interface JsonlResult {
  test_id: string;
  scores?: JsonlScore[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveResultsPath(graderScoresPath: string): string {
  const dir = path.dirname(graderScoresPath);
  const base = path.basename(graderScoresPath, '.grader-scores.yaml');
  return path.join(dir, `${base}.results.jsonl`);
}

function parseJsonl(filePath: string): JsonlResult[] {
  const lines = readFileSync(filePath, 'utf8')
    .split('\n')
    .filter((l) => l.trim());
  return lines.map((line, i) => {
    try {
      return JSON.parse(line) as JsonlResult;
    } catch {
      throw new Error(`Failed to parse line ${i + 1} of ${filePath}: ${line}`);
    }
  });
}

function loadGraderScores(filePath: string): GraderScoreEntry[] {
  const raw = readFileSync(filePath, 'utf8');
  const parsed = parseYaml(raw) as GraderScoreEntry[] | null;
  if (!Array.isArray(parsed)) {
    throw new Error(`${filePath}: expected a YAML array of entries`);
  }
  return parsed;
}

function findFiles(pattern: string): string[] {
  return globSync(pattern, { cwd: process.cwd() }).sort();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const graderScoresFiles = findFiles('examples/**/*.grader-scores.yaml');

  if (graderScoresFiles.length === 0) {
    console.log('No *.grader-scores.yaml files found under examples/.');
    process.exit(0);
  }

  let passed = 0;
  let failed = 0;

  for (const gsFile of graderScoresFiles) {
    const resultsPath = resolveResultsPath(gsFile);

    if (!existsSync(resultsPath)) {
      console.error(
        `\nMissing results file for ${gsFile}:\n  ${resultsPath}\n  Did you run \`agentv eval --out ${resultsPath}\` first?`,
      );
      // Count each entry as failed so CI catches missing results
      try {
        const entries = loadGraderScores(gsFile);
        failed += entries.length;
      } catch {
        failed += 1;
      }
      continue;
    }

    let entries: GraderScoreEntry[];
    try {
      entries = loadGraderScores(gsFile);
    } catch (err) {
      console.error(`\nFailed to load ${gsFile}: ${err}`);
      failed += 1;
      continue;
    }

    let results: JsonlResult[];
    try {
      results = parseJsonl(resultsPath);
    } catch (err) {
      console.error(`\nFailed to parse ${resultsPath}: ${err}`);
      failed += entries.length;
      continue;
    }

    const byTestId = new Map<string, JsonlResult>();
    for (const r of results) {
      byTestId.set(r.test_id, r);
    }

    console.log(`\n${gsFile}`);

    for (const entry of entries) {
      const { test_id, grader, range } = entry;
      const min = range?.min ?? 0;
      const max = range?.max ?? 1;

      const result = byTestId.get(test_id);
      if (!result) {
        console.log(`  ✗ ${test_id} / ${grader}: test_id not found in ${resultsPath}`);
        failed++;
        continue;
      }

      const scoreEntry = (result.scores ?? []).find((s) => s.name === grader);
      if (!scoreEntry) {
        console.log(`  ✗ ${test_id} / ${grader}: grader name not found in scores[]`);
        failed++;
        continue;
      }

      const { score } = scoreEntry;
      const ok = score >= min && score <= max;
      const rangeStr = `[${min}, ${max}]`;
      if (ok) {
        console.log(`  ✓ ${test_id} / ${grader}: ${score} in ${rangeStr}`);
        passed++;
      } else {
        console.log(`  ✗ ${test_id} / ${grader}: ${score} not in ${rangeStr}`);
        failed++;
      }
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
