import { expect, test } from 'bun:test';
import type { NormalizedSuite } from '../src/agentv/types.js';
import { createPhoenixDatasetPayload } from '../src/phoenix/datasets.js';
import { unwrapPhoenixExpectedOutput } from '../src/phoenix/run-experiment.js';

test('creates deterministic Phoenix dataset payloads from normalized suites', () => {
  const suite: NormalizedSuite = {
    name: 'assert-demo',
    source: {
      path: '/tmp/dataset.eval.yaml',
      relativePath: 'examples/features/assert/evals/dataset.eval.yaml',
      kind: 'eval-yaml',
    },
    cases: [
      {
        id: 'contains-check',
        criteria: 'Must contain Hello',
        input: [{ role: 'user', content: 'Say hello' }],
        expectedOutput: 'Hello',
        assertions: [{ type: 'contains', source: { type: 'contains', value: 'Hello' } }],
        metadata: { tag: 'demo' },
        sourcePath: 'examples/features/assert/evals/dataset.eval.yaml',
      },
    ],
    suiteAssertions: [],
    warnings: [],
    unsupportedFeatures: [],
  };

  const dataset = createPhoenixDatasetPayload(suite);

  expect(dataset.name).toStartWith('agentv-examples-examples-features-assert-evals-dataset-eval');
  expect(dataset.examples[0]?.input.messages[0]?.content).toBe('Say hello');
  expect(dataset.examples[0]?.metadata.agentv_test_id).toBe('contains-check');
  expect(dataset.examples[0]?.metadata.agentv_assertions).toEqual(['contains']);
});

test('unwraps Phoenix expected answer payloads for AgentV deterministic graders', () => {
  expect(unwrapPhoenixExpectedOutput({ answer: 'done' })).toBe('done');
  expect(unwrapPhoenixExpectedOutput({ answer: { ok: true } })).toEqual({ ok: true });
  expect(unwrapPhoenixExpectedOutput({ other: 'shape' })).toEqual({ other: 'shape' });
});
