#!/usr/bin/env bun
/**
 * Generate a GitHub Actions step summary from AgentV eval results.
 *
 * Usage: bun run scripts/ci-summary.ts <results-dir>
 *
 * Reads:
 *   <results-dir>/artifacts/index.jsonl  — per-test results
 *
 * Outputs GitHub-flavored Markdown to stdout (pipe to $GITHUB_STEP_SUMMARY).
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const resultsDir = process.argv[2] || '.agentv/ci-results';
const indexPath = path.join(resultsDir, 'artifacts', 'index.jsonl');

interface EvalResult {
  test_id?: string;
  dataset?: string;
  score?: number;
  pass?: boolean;
  execution_status?: string;
  error?: string;
  duration_ms?: number;
  target?: string;
  assertions?: Array<{ text?: string; passed?: boolean }>;
  failure_stage?: string;
  failure_reason_code?: string;
}

// Parse JSONL results
const results: EvalResult[] = [];
if (existsSync(indexPath)) {
  const lines = readFileSync(indexPath, 'utf-8').split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      results.push(JSON.parse(line));
    } catch {
      /* skip malformed */
    }
  }
}

if (results.length === 0) {
  console.log('## AgentV Eval Results\n\n:warning: No results found.');
  process.exit(0);
}

// Group by dataset/suite
const suites = new Map<string, EvalResult[]>();
for (const r of results) {
  const suite = r.dataset || 'default';
  if (!suites.has(suite)) suites.set(suite, []);
  suites.get(suite)?.push(r);
}

// Compute stats
const threshold = 0.8;
let totalPass = 0;
let totalFail = 0;
let totalErrors = 0;
let totalScore = 0;
const scores: number[] = [];

for (const r of results) {
  const isError = r.execution_status === 'execution_error';
  const passed = !isError && (r.score ?? 0) >= threshold;
  if (isError) totalErrors++;
  else if (passed) totalPass++;
  else totalFail++;
  const score = r.score ?? 0;
  totalScore += score;
  scores.push(score);
}

const totalTests = results.length;
const meanScore = totalTests > 0 ? totalScore / totalTests : 0;

// Stddev
const variance =
  scores.length > 0 ? scores.reduce((sum, s) => sum + (s - meanScore) ** 2, 0) / scores.length : 0;
const stddev = Math.sqrt(variance);

// Total duration
const totalDuration = results.reduce((s, r) => s + (r.duration_ms ?? 0), 0);

const md: string[] = [];
md.push('## AgentV Eval Results');
md.push('');

const icon = totalFail === 0 && totalErrors === 0 ? ':white_check_mark:' : ':x:';
md.push(
  `${icon} **${totalPass}/${totalTests} passed** | Mean: **${meanScore.toFixed(3)}** | Stddev: **${stddev.toFixed(3)}** | Errors: **${totalErrors}** | Duration: **${(totalDuration / 1000).toFixed(1)}s**`,
);
md.push('');

// Suite table
md.push('| Suite | Tests | Pass | Fail | Errors | Mean | Duration |');
md.push('|-------|------:|-----:|-----:|-------:|-----:|---------:|');

for (const [suite, tests] of suites) {
  const pass = tests.filter(
    (t) => t.execution_status !== 'execution_error' && (t.score ?? 0) >= threshold,
  ).length;
  const errors = tests.filter((t) => t.execution_status === 'execution_error').length;
  const fail = tests.length - pass - errors;
  const mean = (tests.reduce((s, t) => s + (t.score ?? 0), 0) / tests.length).toFixed(3);
  const duration = tests.reduce((s, t) => s + (t.duration_ms ?? 0), 0);
  const durationStr = duration > 0 ? `${(duration / 1000).toFixed(1)}s` : '-';
  const suiteIcon =
    fail === 0 && errors === 0 ? ':white_check_mark:' : errors > 0 ? ':warning:' : ':x:';
  md.push(
    `| ${suiteIcon} ${suite} | ${tests.length} | ${pass} | ${fail} | ${errors} | ${mean} | ${durationStr} |`,
  );
}

md.push('');

// Failed tests detail
const failedTests = results.filter(
  (r) => r.execution_status !== 'execution_error' && (r.score ?? 0) < threshold,
);
if (failedTests.length > 0) {
  md.push('<details>');
  md.push(`<summary>:x: ${failedTests.length} quality failure(s)</summary>`);
  md.push('');
  for (const t of failedTests.slice(0, 50)) {
    const name = t.test_id || 'unknown';
    const suite = t.dataset || 'default';
    md.push(
      `**${suite} / ${name}** — score: ${(t.score ?? 0).toFixed(3)} | target: ${t.target ?? '-'}`,
    );
    if (t.assertions) {
      const failed = t.assertions.filter((a) => !a.passed);
      for (const a of failed) {
        md.push(`  - :x: ${a.text ?? 'assertion failed'}`);
      }
    }
    md.push('');
  }
  if (failedTests.length > 50) {
    md.push(`_...and ${failedTests.length - 50} more_`);
  }
  md.push('</details>');
  md.push('');
}

// Error tests detail
const errorTests = results.filter((r) => r.execution_status === 'execution_error');
if (errorTests.length > 0) {
  md.push('<details>');
  md.push(`<summary>:warning: ${errorTests.length} execution error(s)</summary>`);
  md.push('');
  for (const t of errorTests.slice(0, 30)) {
    const name = t.test_id || 'unknown';
    md.push(`**${name}** — ${t.failure_reason_code ?? 'error'}: ${t.error ?? 'unknown error'}`);
    md.push('');
  }
  if (errorTests.length > 30) {
    md.push(`_...and ${errorTests.length - 30} more_`);
  }
  md.push('</details>');
}

console.log(md.join('\n'));
