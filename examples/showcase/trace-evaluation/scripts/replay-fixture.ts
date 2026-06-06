#!/usr/bin/env bun
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

interface ReplayRecord {
  readonly schema_version: string;
  readonly suite: string;
  readonly test_id: string;
  readonly source_target: string;
  readonly attempt?: number;
  readonly fixture_id?: string;
  readonly output: unknown;
  readonly token_usage?: unknown;
  readonly cost_usd?: number;
  readonly duration_ms?: number;
}

const { values } = parseArgs({
  options: {
    fixtures: { type: 'string' },
    suite: { type: 'string' },
    'source-target': { type: 'string' },
    'test-id': { type: 'string' },
    attempt: { type: 'string' },
    output: { type: 'string' },
    healthcheck: { type: 'boolean' },
  },
});

if (values.healthcheck) {
  console.log('trace-evaluation replay target: healthy');
  process.exit(0);
}

const fixturesPath = values.fixtures;
const suite = values.suite;
const sourceTarget = values['source-target'];
const testId = values['test-id'];
const outputPath = values.output;
const attempt = Number(values.attempt ?? '0');

if (!fixturesPath || !suite || !sourceTarget || !testId || !outputPath) {
  console.error(
    'Usage: bun replay-fixture.ts --fixtures <jsonl> --suite <suite> --source-target <target> --test-id <id> --attempt <n> --output <file>',
  );
  process.exit(1);
}

const records = readFileSync(fixturesPath, 'utf8')
  .split(/\r?\n/)
  .filter((line) => line.trim().length > 0)
  .map((line) => JSON.parse(line) as ReplayRecord);

const matches = records.filter(
  (record) =>
    record.suite === suite &&
    record.test_id === testId &&
    record.source_target === sourceTarget &&
    (record.attempt ?? 0) === attempt,
);

if (matches.length !== 1) {
  console.error(
    `Replay lookup expected exactly 1 record for suite=${suite} test_id=${testId} source_target=${sourceTarget} attempt=${attempt}, found ${matches.length}`,
  );
  process.exit(1);
}

const record = matches[0];
writeFileSync(
  outputPath,
  JSON.stringify(
    {
      output: record.output,
      token_usage: record.token_usage,
      cost_usd: record.cost_usd,
      duration_ms: record.duration_ms,
    },
    null,
    2,
  ),
  'utf8',
);

const proofLog = process.env.AGENTV_TRACE_SHOWCASE_PROOF_LOG;
if (proofLog) {
  appendFileSync(
    proofLog,
    `${JSON.stringify({
      kind: 'target_replay',
      suite,
      test_id: testId,
      source_target: sourceTarget,
      attempt,
      fixture_id: record.fixture_id,
    })}\n`,
    'utf8',
  );
}

console.log(`replayed ${record.fixture_id ?? testId}`);
