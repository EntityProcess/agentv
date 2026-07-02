import { afterEach, describe, expect, it } from 'bun:test';
import { type Server, createServer } from 'node:http';

import type { EvaluationContext } from '../../../src/evaluation/graders/types.js';
import { createBuiltinRegistry } from '../../../src/evaluation/registry/builtin-graders.js';
import type { GraderConfig } from '../../../src/evaluation/types.js';

const baseContext: EvaluationContext = {
  evalCase: {
    id: 'case-1',
    question: 'Question',
    input: [{ role: 'user', content: 'Question' }],
    expected_output: [{ role: 'assistant', content: { answer: 'Paris' } }],
    reference_answer: 'Paris',
    file_paths: [],
    criteria: 'Answer correctly',
  },
  candidate: 'Paris is the capital of France.',
  target: { name: 'mock', kind: 'mock', config: {} },
  provider: {
    id: 'mock',
    kind: 'mock',
    targetName: 'mock',
    async invoke() {
      return { output: [{ role: 'assistant', content: 'ok' }] };
    },
  },
  attempt: 1,
  promptInputs: { question: 'Question' },
  now: new Date('2026-07-02T00:00:00Z'),
};

async function run(config: GraderConfig) {
  const registry = createBuiltinRegistry();
  const grader = await registry.create(config, {
    llmGrader: {
      kind: 'llm-grader',
      evaluate() {
        throw new Error('not used');
      },
    },
    registry,
  });
  return grader.evaluate(baseContext);
}

describe('promptfoo-compatible built-in assertions', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = undefined;
    }
  });

  it('runs javascript assertions in-process', async () => {
    const result = await run({
      name: 'js',
      type: 'javascript',
      value: "output.includes('Paris') && context.expectedOutput[0].content.answer === 'Paris'",
    });

    expect(result.score).toBe(1);
    expect(result.verdict).toBe('pass');
  });

  it('uses assertion thresholds for numeric script results', async () => {
    const result = await run({
      name: 'js-threshold',
      type: 'javascript',
      value: '0.5',
      threshold: 0.75,
    });

    expect(result.score).toBe(0.5);
    expect(result.verdict).toBe('fail');
    expect(result.assertions[0].passed).toBe(false);
  });

  it('runs python assertions in a subprocess', async () => {
    const result = await run({
      name: 'py',
      type: 'python',
      value: "'Paris' in output and context['expected_output'][0]['content']['answer'] == 'Paris'",
    });

    expect(result.score).toBe(1);
    expect(result.verdict).toBe('pass');
  });

  it('runs webhook assertions against an HTTP endpoint', async () => {
    const url = await new Promise<string>((resolve) => {
      server = createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          const payload = JSON.parse(body) as { output: string };
          res.setHeader('content-type', 'application/json');
          res.end(
            JSON.stringify({
              score: payload.output.includes('Paris') ? 1 : 0,
              assertions: [{ text: 'saw output', passed: payload.output.includes('Paris') }],
            }),
          );
        });
      }).listen(0, () => {
        const address = server?.address();
        if (address && typeof address === 'object') {
          resolve(`http://127.0.0.1:${address.port}`);
        }
      });
    });

    const result = await run({ name: 'webhook', type: 'webhook', value: url });
    expect(result.score).toBe(1);
    expect(result.assertions[0].text).toBe('saw output');
  });

  it('aggregates nested assert-set children', async () => {
    const result = await run({
      name: 'set',
      type: 'assert-set',
      threshold: 0.5,
      assertions: [
        { name: 'contains', type: 'contains', value: 'Paris' },
        { name: 'starts', type: 'starts-with', value: 'Paris' },
      ],
    });

    expect(result.score).toBe(1);
    expect(result.scores?.map((score) => score.type)).toEqual(['contains', 'starts-with']);
  });

  it('runs similar with an OpenAI-compatible embeddings provider', async () => {
    const url = await new Promise<string>((resolve) => {
      server = createServer((req, res) => {
        req.resume();
        req.on('end', () => {
          res.setHeader('content-type', 'application/json');
          res.end(
            JSON.stringify({
              data: [{ embedding: [1, 0, 0] }, { embedding: [1, 0, 0] }],
            }),
          );
        });
      }).listen(0, () => {
        const address = server?.address();
        if (address && typeof address === 'object') {
          resolve(`http://127.0.0.1:${address.port}`);
        }
      });
    });

    const result = await run({
      name: 'similar',
      type: 'similar',
      value: 'Paris is the capital of France.',
      threshold: 0.9,
      config: { embedding_provider: { base_url: url, model: 'test-embedding' } },
    });

    expect(result.score).toBe(1);
    expect(result.verdict).toBe('pass');
  });
});
