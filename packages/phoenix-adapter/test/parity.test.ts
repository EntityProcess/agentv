import { expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { NormalizedSuite } from '../src/agentv/types.js';
import { compareDryRunSuite } from '../src/parity/compare.js';
import { createPhoenixDatasetPayload } from '../src/phoenix/datasets.js';

test('dry-run parity compares baseline ids with normalized cases', () => {
  const dir = path.join(tmpdir(), `agentv-phoenix-parity-${crypto.randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  const evalPath = path.join(dir, 'dataset.eval.yaml');
  writeFileSync(evalPath, 'tests: []\n');
  writeFileSync(path.join(dir, 'dataset.eval.baseline.jsonl'), '{"test_id":"known"}\n');

  const suite: NormalizedSuite = {
    name: 'suite',
    source: {
      path: evalPath,
      relativePath: 'examples/x/evals/dataset.eval.yaml',
      kind: 'eval-yaml',
    },
    cases: [
      {
        id: 'known',
        input: [{ role: 'user', content: 'hi' }],
        assertions: [],
        metadata: {},
        sourcePath: 'examples/x/evals/dataset.eval.yaml',
      },
    ],
    suiteAssertions: [],
    warnings: [],
    unsupportedFeatures: [],
  };

  const summary = compareDryRunSuite(suite, createPhoenixDatasetPayload(suite));

  expect(summary.status).toBe('passed');
  expect(summary.baselineCount).toBe(1);
});
