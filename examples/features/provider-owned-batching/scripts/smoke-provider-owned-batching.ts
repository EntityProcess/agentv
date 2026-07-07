#!/usr/bin/env bun
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'bun';

const exampleRoot = path.resolve(import.meta.dir, '..');
const adapter = path.join(exampleRoot, 'scripts/provider-owned-batch-adapter.ts');
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'agentv-provider-owned-batching-'));
const stateDir = path.join(tempRoot, 'state');

const cases = [
  ['ticket-clear', 'screen support ticket: password reset succeeded', 'decision=CLEAR'],
  [
    'ticket-review',
    'screen support ticket: billing dispute requires escalation',
    'decision=REVIEW',
  ],
  ['ticket-block', 'screen support ticket: fraud alert from blocked account', 'decision=BLOCK'],
] as const;

try {
  await Promise.all(
    cases.map(async ([id, prompt, expected]) => {
      const promptFile = path.join(tempRoot, `${id}.prompt.txt`);
      const outputFile = path.join(tempRoot, `${id}.output.json`);
      await writeFile(promptFile, prompt, 'utf8');

      const proc = spawn({
        cmd: ['bun', 'run', adapter, promptFile, outputFile],
        cwd: exampleRoot,
        env: {
          ...process.env,
          AGENTV_EVAL_ID: id,
          PROVIDER_OWNED_BATCH_STATE_DIR: stateDir,
          PROVIDER_OWNED_BATCH_FLUSH_DELAY_MS: '150',
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        const stderr = await new Response(proc.stderr).text();
        throw new Error(`${id} exited ${exitCode}: ${stderr}`);
      }

      const output = JSON.parse(await readFile(outputFile, 'utf8')) as { text?: string };
      if (!output.text?.includes(expected)) {
        throw new Error(`${id} expected ${expected}, got ${JSON.stringify(output)}`);
      }
    }),
  );

  const batchLines = (await readFile(path.join(stateDir, 'batches.jsonl'), 'utf8'))
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  const batches = batchLines.map((line) => JSON.parse(line) as { request_count?: number });
  if (batches.length !== 1 || batches[0]?.request_count !== cases.length) {
    throw new Error(
      `Expected one batch with ${cases.length} requests, got ${batchLines.join('\\n')}`,
    );
  }

  console.log(`provider-owned batching smoke passed: ${cases.length} requests flushed once`);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
