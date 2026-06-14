#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();
const tmp = mkdtempSync(join(tmpdir(), 'agentv-trace-showcase-'));
const proofLog = join(tmp, 'proof.jsonl');
const resultDir = join(tmp, 'replay-run');
const resultIndexPath = join(resultDir, 'index.jsonl');

function runEval(): void {
  const result = spawnSync(
    'bun',
    [
      'apps/cli/src/cli.ts',
      'eval',
      'examples/showcase/trace-evaluation/evals/coding-agent-replay.eval.yaml',
      '--target',
      'replay_coding_agent',
      '--output',
      resultDir,
    ],
    {
      cwd: root,
      stdio: 'pipe',
      encoding: 'utf8',
      env: {
        ...process.env,
        AGENTV_TRACE_SHOWCASE_PROOF_LOG: proofLog,
        OPENAI_API_KEY: '',
        ANTHROPIC_API_KEY: '',
        AZURE_OPENAI_API_KEY: '',
        GEMINI_API_KEY: '',
        GOOGLE_API_KEY: '',
        OPENROUTER_API_KEY: '',
      },
    },
  );

  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    throw new Error(`Replay eval failed with exit code ${result.status}`);
  }
}

function readJsonl(path: string): Record<string, unknown>[] {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

try {
  runEval();

  const proofRecords = readJsonl(proofLog);
  const results = readJsonl(resultIndexPath);
  const graderRuns = proofRecords.filter((record) => record.kind === 'grader_run');

  const resultTargets = new Set(results.map((record) => record.target));
  const scoreTypes = new Set(
    results.flatMap((record) =>
      ((record.scores as Record<string, unknown>[] | undefined) ?? []).map((score) => score.type),
    ),
  );
  const scoreNames = new Set(
    results.flatMap((record) =>
      ((record.scores as Record<string, unknown>[] | undefined) ?? []).map((score) => score.name),
    ),
  );

  const requiredScoreTypes = ['tool-trajectory', 'execution-metrics', 'code-grader'];
  const requiredScoreNames = [
    'expected-tool-sequence',
    'recovery-sequence',
    'execution-budget',
    'recovery-check',
    'replay-proof',
  ];
  const missingScoreTypes = requiredScoreTypes.filter((type) => !scoreTypes.has(type));
  const missingScoreNames = requiredScoreNames.filter((name) => !scoreNames.has(name));

  const failures: string[] = [];
  if (results.length !== 2) failures.push(`expected 2 result records, got ${results.length}`);
  if (resultTargets.size !== 1 || !resultTargets.has('replay_coding_agent')) {
    failures.push(`expected only replay_coding_agent target, got ${[...resultTargets].join(', ')}`);
  }
  if (graderRuns.length !== 2)
    failures.push(`expected 2 replay-proof grader runs, got ${graderRuns.length}`);
  if (missingScoreTypes.length > 0) {
    failures.push(`missing fresh grader score types: ${missingScoreTypes.join(', ')}`);
  }
  if (missingScoreNames.length > 0) {
    failures.push(`missing fresh grader score names: ${missingScoreNames.join(', ')}`);
  }
  for (const result of results) {
    if (result.score !== 1) {
      failures.push(`expected score 1 for ${String(result.test_id)}, got ${String(result.score)}`);
    }
    if (typeof result.cost_usd !== 'number') {
      failures.push(`expected cost_usd for ${String(result.test_id)}`);
    }
    if (typeof result.duration_ms !== 'number') {
      failures.push(`expected duration_ms for ${String(result.test_id)}`);
    }
    const tokenUsage = result.token_usage as Record<string, unknown> | undefined;
    if (
      !tokenUsage ||
      typeof tokenUsage.input !== 'number' ||
      typeof tokenUsage.output !== 'number'
    ) {
      failures.push(`expected token_usage for ${String(result.test_id)}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(failures.join('\n'));
  }

  console.log(`Replay proof passed: ${results.length} tests`);
  console.log(`Fresh grader runs: ${graderRuns.length} replay-proof invocation(s)`);
  console.log('Provider metrics: preserved from replay fixture rows');
  console.log('Result target: replay_coding_agent');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
