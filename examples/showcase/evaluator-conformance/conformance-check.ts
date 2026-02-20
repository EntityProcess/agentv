#!/usr/bin/env bun
/**
 * Evaluator Conformance Harness
 *
 * Runs an evaluator N times per fixture and validates:
 *   - Compatibility: output matches CodeJudgeResult schema (score, hits, misses)
 *   - Consistency: flip-rate, agreement, and variance meet thresholds
 *
 * Usage:
 *   bun run conformance-check.ts [options]
 *
 * Options:
 *   --fixture <path>       Path to fixture YAML (default: fixtures.yaml)
 *   --runs <N>             Runs per fixture (default: 5)
 *   --max-flip-rate <X>    Max flip-rate for unambiguous fixtures (default: 0)
 *   --output <path>        Write structured JSON results to file
 */

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parse } from 'yaml';

// ── Types ───────────────────────────────────────────────────────────────

interface Fixture {
  id: string;
  label: 'pass' | 'fail' | 'ambiguous';
  question: string;
  criteria: string;
  expected_output: string;
  candidate_answer: string;
  score_bounds?: [number, number];
}

interface FixtureFile {
  evaluator: { script: string[] };
  fixtures: Fixture[];
}

interface EvaluatorResult {
  score: number;
  hits?: string[];
  misses?: string[];
  reasoning?: string;
}

interface FixtureReport {
  id: string;
  label: string;
  runs: number;
  scores: number[];
  mean: number;
  variance: number;
  flip_rate: number;
  expected_score: number | null;
  score_bounds: [number, number] | null;
  compatible: boolean;
  consistent: boolean;
  errors: string[];
}

interface ConformanceReport {
  evaluator: string[];
  total_fixtures: number;
  total_runs: number;
  compatible: boolean;
  consistent: boolean;
  fixtures: FixtureReport[];
}

// ── CLI ─────────────────────────────────────────────────────────────────

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    fixture: { type: 'string', short: 'f', default: 'fixtures.yaml' },
    runs: { type: 'string', short: 'n', default: '5' },
    'max-flip-rate': { type: 'string', default: '0' },
    output: { type: 'string', short: 'o' },
  },
});

const fixturePath = resolve(values.fixture ?? 'fixtures.yaml');
const runs = Number.parseInt(values.runs ?? '5', 10);
const maxFlipRate = Number.parseFloat(values['max-flip-rate'] ?? '0');

// ── Evaluator invocation ────────────────────────────────────────────────

function buildCodeJudgeInput(fixture: Fixture): string {
  // Build a minimal CodeJudgeInput in the snake_case wire format
  return JSON.stringify({
    question: fixture.question,
    criteria: fixture.criteria,
    candidate_answer: fixture.candidate_answer,
    reference_answer: fixture.expected_output,
    expected_messages: [],
    input_messages: [{ role: 'user', content: fixture.question }],
    output_messages: [{ role: 'assistant', content: fixture.candidate_answer }],
    guideline_files: [],
    input_files: [],
  });
}

function runEvaluator(script: string[], input: string): Promise<EvaluatorResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(script[0], script.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: import.meta.dir,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });

    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Evaluator exited with code ${code}: ${stderr}`));
        return;
      }
      try {
        const result = JSON.parse(stdout);
        resolve(result as EvaluatorResult);
      } catch {
        reject(new Error(`Invalid JSON output: ${stdout}`));
      }
    });

    proc.stdin.write(input);
    proc.stdin.end();
  });
}

// ── Schema validation ───────────────────────────────────────────────────

function validateResult(result: unknown): string[] {
  const errors: string[] = [];
  if (typeof result !== 'object' || result === null) {
    errors.push('Result is not an object');
    return errors;
  }

  const r = result as Record<string, unknown>;

  if (typeof r.score !== 'number') {
    errors.push('Missing or non-numeric "score"');
  } else if (r.score < 0 || r.score > 1) {
    errors.push(`Score ${r.score} out of range [0, 1]`);
  }

  if (r.hits !== undefined && !Array.isArray(r.hits)) {
    errors.push('"hits" must be an array');
  }
  if (r.misses !== undefined && !Array.isArray(r.misses)) {
    errors.push('"misses" must be an array');
  }

  return errors;
}

// ── Statistics ──────────────────────────────────────────────────────────

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function variance(values: number[]): number {
  const m = mean(values);
  return values.reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length;
}

function toVerdict(score: number): 'pass' | 'borderline' | 'fail' {
  if (score >= 0.8) return 'pass';
  if (score >= 0.6) return 'borderline';
  return 'fail';
}

function flipRate(scores: number[]): number {
  if (scores.length <= 1) return 0;
  const verdicts = scores.map(toVerdict);
  const primary = verdicts[0];
  const flips = verdicts.filter((v) => v !== primary).length;
  return flips / (verdicts.length - 1);
}

// ── Main ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const raw = readFileSync(fixturePath, 'utf-8');
  const data = parse(raw) as FixtureFile;

  const { evaluator, fixtures } = data;
  console.log('\n  Evaluator Conformance Harness');
  console.log(`  evaluator:  ${evaluator.script.join(' ')}`);
  console.log(`  fixtures:   ${fixtures.length}`);
  console.log(`  runs/each:  ${runs}`);
  console.log(`  max-flip:   ${maxFlipRate}\n`);

  const reports: FixtureReport[] = [];
  let allCompatible = true;
  let allConsistent = true;

  for (const fixture of fixtures) {
    const input = buildCodeJudgeInput(fixture);
    const scores: number[] = [];
    const errors: string[] = [];
    let compatible = true;

    for (let i = 0; i < runs; i++) {
      try {
        const result = await runEvaluator(evaluator.script, input);
        const schemaErrors = validateResult(result);
        if (schemaErrors.length > 0) {
          compatible = false;
          for (const e of schemaErrors) errors.push(`Run ${i + 1}: ${e}`);
        } else {
          scores.push(result.score);
        }
      } catch (err) {
        compatible = false;
        errors.push(`Run ${i + 1}: ${(err as Error).message}`);
      }
    }

    // Consistency checks
    let consistent = true;
    const expectedScore = fixture.label === 'pass' ? 1.0 : fixture.label === 'fail' ? 0.0 : null;
    const bounds = fixture.label === 'ambiguous' ? (fixture.score_bounds ?? null) : null;

    if (scores.length > 0) {
      const fr = flipRate(scores);

      if (fixture.label !== 'ambiguous' && fr > maxFlipRate) {
        consistent = false;
        errors.push(`Flip rate ${fr.toFixed(2)} exceeds max ${maxFlipRate}`);
      }

      if (expectedScore !== null) {
        const allMatch = scores.every((s) => s === expectedScore);
        if (!allMatch) {
          consistent = false;
          errors.push(
            `Expected all scores to be ${expectedScore}, got [${scores.map((s) => s.toFixed(2)).join(', ')}]`,
          );
        }
      }

      if (bounds) {
        const oob = scores.filter((s) => s < bounds[0] || s > bounds[1]);
        if (oob.length > 0) {
          consistent = false;
          errors.push(
            `${oob.length} score(s) outside bounds [${bounds[0]}, ${bounds[1]}]: [${oob.map((s) => s.toFixed(2)).join(', ')}]`,
          );
        }
      }

      const report: FixtureReport = {
        id: fixture.id,
        label: fixture.label,
        runs: scores.length,
        scores,
        mean: mean(scores),
        variance: variance(scores),
        flip_rate: fr,
        expected_score: expectedScore,
        score_bounds: bounds,
        compatible,
        consistent,
        errors,
      };
      reports.push(report);

      // Print per-fixture result
      const status = compatible && consistent ? '✓' : '✗';
      const tag = fixture.label.toUpperCase().padEnd(9);
      console.log(
        `  ${status}  [${tag}] ${fixture.id}  mean=${report.mean.toFixed(2)}  var=${report.variance.toFixed(4)}  flip=${fr.toFixed(2)}`,
      );
      for (const e of errors) {
        console.log(`              ↳ ${e}`);
      }
    } else {
      compatible = false;
      consistent = false;
      reports.push({
        id: fixture.id,
        label: fixture.label,
        runs: 0,
        scores: [],
        mean: 0,
        variance: 0,
        flip_rate: 0,
        expected_score: expectedScore,
        score_bounds: bounds,
        compatible: false,
        consistent: false,
        errors,
      });
      console.log(`  ✗  [${fixture.label.toUpperCase().padEnd(9)}] ${fixture.id}  NO VALID RUNS`);
      for (const e of errors) {
        console.log(`              ↳ ${e}`);
      }
    }

    if (!compatible) allCompatible = false;
    if (!consistent) allConsistent = false;
  }

  // Summary
  const passed = reports.filter((r) => r.compatible && r.consistent).length;
  const failed = reports.length - passed;

  console.log('\n  ── Summary ──');
  console.log(`  Compatible:  ${allCompatible ? '✓' : '✗'}`);
  console.log(`  Consistent:  ${allConsistent ? '✓' : '✗'}`);
  console.log(`  Passed:      ${passed}/${reports.length}`);
  console.log(`  Failed:      ${failed}/${reports.length}`);

  // Write output
  if (values.output) {
    const output: ConformanceReport = {
      evaluator: evaluator.script,
      total_fixtures: fixtures.length,
      total_runs: runs * fixtures.length,
      compatible: allCompatible,
      consistent: allConsistent,
      fixtures: reports,
    };
    writeFileSync(values.output, JSON.stringify(output, null, 2));
    console.log(`\n  Results written to ${values.output}`);
  }

  console.log('');

  if (!allCompatible || !allConsistent) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
