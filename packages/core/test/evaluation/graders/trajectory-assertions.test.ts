import { describe, expect, it } from 'bun:test';

import type { EvaluationContext, Grader } from '../../../src/evaluation/graders/types.js';
import { createBuiltinRegistry } from '../../../src/evaluation/registry/builtin-graders.js';
import type { Trace } from '../../../src/evaluation/trace.js';
import type { GraderConfig } from '../../../src/evaluation/types.js';

const trace: Trace = {
  eventCount: 3,
  toolCalls: {
    search_orders: 2,
    compose_reply: 1,
  },
  errorCount: 0,
  llmCallCount: 2,
  messages: [],
  events: [
    {
      eventId: 'message-0',
      ordinal: 0,
      type: 'message',
      timestamp: '2026-07-01T00:00:00.000Z',
      message: { role: 'assistant', content: 'I will search first.' },
    },
    {
      eventId: 'tool-0',
      ordinal: 1,
      type: 'tool_call',
      timestamp: '2026-07-01T00:00:01.000Z',
      tool: {
        name: 'search_orders',
        input: { order_id: '123', page: 1, request_id: 'volatile' },
        status: 'ok',
      },
    },
    {
      eventId: 'tool-1',
      ordinal: 2,
      type: 'tool_call',
      timestamp: '2026-07-01T00:00:02.000Z',
      tool: {
        name: 'search_orders',
        input: { order_id: '456', page: 2 },
        status: 'ok',
      },
    },
    {
      eventId: 'tool-2',
      ordinal: 3,
      type: 'tool_call',
      timestamp: '2026-07-01T00:00:03.000Z',
      tool: {
        name: 'compose_reply',
        input: { tone: 'friendly', citations: ['doc_1', 'doc_2'] },
        status: 'ok',
      },
    },
    {
      eventId: 'tool-3',
      ordinal: 4,
      type: 'tool_call',
      timestamp: '2026-07-01T00:00:04.000Z',
      tool: {
        name: 'exec_command',
        input: { cmd: 'npm test' },
        status: 'ok',
      },
    },
  ],
};

const baseContext: EvaluationContext = {
  evalCase: {
    id: 'case-1',
    question: 'Question',
    input: [{ role: 'user', content: 'Question' }],
    expected_output: 'ok',
    reference_answer: 'ok',
    file_paths: [],
    criteria: 'Answer correctly',
  },
  candidate: 'Done.',
  trace,
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
  now: new Date('2026-07-01T00:00:00Z'),
};

async function createGrader(config: GraderConfig, llmGrader?: Grader) {
  const registry = createBuiltinRegistry();
  return registry.create(config, {
    registry,
    llmGrader:
      llmGrader ??
      ({
        kind: 'llm-grader',
        evaluate() {
          throw new Error('llm grader not used');
        },
      } satisfies Grader),
  });
}

async function evaluate(config: GraderConfig, context: EvaluationContext = baseContext) {
  const grader = await createGrader(config);
  return grader.evaluate(context);
}

describe('Promptfoo trajectory assertions', () => {
  it('checks required tool usage by string, array, and count matcher', async () => {
    await expect(
      evaluate({ name: 'tool-used', type: 'trajectory:tool-used', value: 'search_orders' }),
    ).resolves.toMatchObject({ score: 1, verdict: 'pass' });

    await expect(
      evaluate({
        name: 'tools-used',
        type: 'trajectory:tool-used',
        value: ['search_orders', 'compose_reply'],
      }),
    ).resolves.toMatchObject({ score: 1, verdict: 'pass' });

    const result = await evaluate({
      name: 'search-count',
      type: 'trajectory:tool-used',
      value: { pattern: 'search*', min: 2, max: 2 },
    });

    expect(result.score).toBe(1);
    expect(result.assertions[0].text).toContain('Matched tool "search*" 2 time(s)');
  });

  it('inverts trajectory assertions through inverse', async () => {
    const result = await evaluate({
      name: 'forbid-delete',
      type: 'trajectory:tool-used',
      value: 'delete_order',
      inverse: true,
    });

    expect(result.score).toBe(1);
    expect(result.verdict).toBe('pass');
    expect(result.assertions[0].text).toContain('Forbidden tool(s) were not used');
  });

  it('requires trace data with a Promptfoo-style diagnostic', async () => {
    const result = await evaluate(
      { name: 'missing-trace', type: 'trajectory:tool-used', value: 'search_orders' },
      { ...baseContext, trace: undefined },
    );

    expect(result.score).toBe(0);
    expect(result.verdict).toBe('fail');
    expect(result.assertions[0]).toEqual({
      text: 'No trace data available for trajectory:tool-used assertion',
      passed: false,
    });
  });

  it('matches tool arguments in partial and exact modes with defaults and ignore', async () => {
    await expect(
      evaluate({
        name: 'args-partial',
        type: 'trajectory:tool-args-match',
        value: { name: 'search_orders', args: { order_id: '123' } },
      }),
    ).resolves.toMatchObject({ score: 1, verdict: 'pass' });

    await expect(
      evaluate({
        name: 'args-exact-defaults-ignore',
        type: 'trajectory:tool-args-match',
        value: {
          name: 'search_orders',
          mode: 'exact',
          args: { order_id: '123' },
          defaults: { page: 1 },
          ignore: 'request_id',
        },
      }),
    ).resolves.toMatchObject({ score: 1, verdict: 'pass' });

    await expect(
      evaluate({
        name: 'args-exact-fail',
        type: 'trajectory:tool-args-match',
        value: { name: 'search_orders', mode: 'exact', args: { order_id: '123' } },
      }),
    ).resolves.toMatchObject({ score: 0, verdict: 'fail' });
  });

  it('reports value-shape errors for invalid argument matchers', async () => {
    const grader = await createGrader({
      name: 'bad-args',
      type: 'trajectory:tool-args-match',
      value: { name: 'search_orders' },
    });

    expect(() => grader.evaluate(baseContext)).toThrow(
      'trajectory:tool-args-match assertion must include an args or arguments property',
    );
  });

  it('checks tool sequence in in_order and exact modes', async () => {
    await expect(
      evaluate({
        name: 'sequence-in-order',
        type: 'trajectory:tool-sequence',
        value: { steps: ['search_orders', 'compose_reply'] },
      }),
    ).resolves.toMatchObject({ score: 1, verdict: 'pass' });

    await expect(
      evaluate({
        name: 'sequence-exact',
        type: 'trajectory:tool-sequence',
        value: { mode: 'exact', steps: ['search_orders', 'compose_reply'] },
      }),
    ).resolves.toMatchObject({ score: 0, verdict: 'fail' });
  });

  it('counts trajectory steps by type and pattern', async () => {
    await expect(
      evaluate({
        name: 'tool-count',
        type: 'trajectory:step-count',
        value: { type: 'tool', min: 3 },
      }),
    ).resolves.toMatchObject({ score: 1, verdict: 'pass' });

    const result = await evaluate({
      name: 'command-count',
      type: 'trajectory:step-count',
      value: { type: 'command', pattern: 'npm*', min: 1, max: 1 },
    });

    expect(result.score).toBe(1);
    expect(result.assertions[0].text).toContain('type=command');
  });

  it('delegates goal-success checks to the configured LLM grader with a trajectory summary', async () => {
    let observedCriteria = '';
    const llmGrader: Grader = {
      kind: 'llm-grader',
      evaluate(context) {
        observedCriteria = context.evalCase.criteria;
        return {
          score: 1,
          verdict: 'pass',
          assertions: [{ text: 'goal achieved', passed: true }],
          expectedAspectCount: 1,
        };
      },
    };
    const grader = await createGrader(
      {
        name: 'goal',
        type: 'trajectory:goal-success',
        value: { goal: 'Find the order and compose a reply' },
      },
      llmGrader,
    );

    const result = await grader.evaluate(baseContext);

    expect(result.score).toBe(1);
    expect(observedCriteria).toContain('Find the order and compose a reply');
    expect(observedCriteria).toContain('"stepCount"');
    expect(observedCriteria).toContain('compose_reply');
  });
});
