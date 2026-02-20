import { afterEach, describe, expect, it, mock } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { LlmJudgeEvaluator, ToolTrajectoryEvaluator } from '../../src/evaluation/evaluators.js';
import {
  type EvaluationCache,
  runEvalCase,
  runEvaluation,
} from '../../src/evaluation/orchestrator.js';
import type { ResolvedTarget } from '../../src/evaluation/providers/targets.js';
import type {
  OutputMessage,
  Provider,
  ProviderRequest,
  ProviderResponse,
  ToolCall,
} from '../../src/evaluation/providers/types.js';
import type { EvalTest, TrialsConfig } from '../../src/evaluation/types.js';

class SequenceProvider implements Provider {
  readonly id: string;
  readonly kind = 'mock' as const;
  readonly targetName: string;

  private readonly sequence: Array<() => ProviderResponse>;
  private readonly errors: Array<() => Error>;
  callIndex = 0;

  constructor(targetName: string, options: { responses?: ProviderResponse[]; errors?: Error[] }) {
    this.id = `mock:${targetName}`;
    this.targetName = targetName;
    this.sequence = (options.responses ?? []).map((response) => () => response);
    this.errors = (options.errors ?? []).map((error) => () => error);
  }

  async invoke(): Promise<ProviderResponse> {
    if (this.callIndex < this.errors.length) {
      const errorFactory = this.errors[this.callIndex];
      this.callIndex += 1;
      throw errorFactory();
    }
    if (this.callIndex - this.errors.length < this.sequence.length) {
      const responseFactory = this.sequence[this.callIndex - this.errors.length];
      this.callIndex += 1;
      return responseFactory();
    }
    throw new Error('No more responses configured');
  }
}

class CapturingJudgeProvider implements Provider {
  readonly id: string;
  readonly kind = 'mock' as const;
  readonly targetName: string;
  lastRequest?: ProviderRequest;

  constructor(
    targetName: string,
    private readonly response: ProviderResponse,
  ) {
    this.id = `judge:${targetName}`;
    this.targetName = targetName;
  }

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    this.lastRequest = request;
    return this.response;
  }
}

class CapturingProvider implements Provider {
  readonly id: string;
  readonly kind = 'mock' as const;
  readonly targetName: string;
  lastRequest?: ProviderRequest;

  constructor(
    targetName: string,
    private readonly response: ProviderResponse,
  ) {
    this.id = `cap:${targetName}`;
    this.targetName = targetName;
  }

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    this.lastRequest = request;
    return this.response;
  }
}

class CapturingCliProvider implements Provider {
  readonly id: string;
  readonly kind = 'cli' as const;
  readonly targetName: string;
  lastRequest?: ProviderRequest;

  constructor(
    targetName: string,
    private readonly response: ProviderResponse,
  ) {
    this.id = `cli:${targetName}`;
    this.targetName = targetName;
  }

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    this.lastRequest = request;
    return this.response;
  }
}

const baseTestCase: EvalTest = {
  id: 'case-1',
  dataset: 'test-dataset',
  question: 'Explain logging improvements',
  input: [{ role: 'user', content: 'Explain logging improvements' }],
  input_segments: [{ type: 'text', value: 'Explain logging improvements' }],
  expected_output: [],
  reference_answer: '- add structured logging\n- avoid global state',
  guideline_paths: [],
  file_paths: [],
  criteria: 'Logging improved',
  evaluator: 'llm_judge',
};

const baseTarget: ResolvedTarget = {
  kind: 'mock',
  name: 'mock',
  config: { response: '{}' },
};

const evaluatorRegistry = {
  llm_judge: {
    kind: 'llm_judge',
    async evaluate() {
      return {
        score: 0.8,
        verdict: 'pass' as const,
        hits: ['hit'],
        misses: [],
        expectedAspectCount: 1,
      };
    },
  },
};

describe('runTestCase', () => {
  afterEach(() => {
    // Bun uses real timers by default
  });

  it('produces evaluation result using default grader', async () => {
    const provider = new SequenceProvider('mock', {
      responses: [
        {
          outputMessages: [
            {
              role: 'assistant',
              content: 'You should add structured logging and avoid global state.',
            },
          ],
        },
      ],
    });

    const result = await runEvalCase({
      evalCase: baseTestCase,
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
      now: () => new Date('2024-01-01T00:00:00Z'),
    });

    expect(result.score).toBeGreaterThan(0);
    expect(result.hits).toHaveLength(1);
    expect(result.misses).toHaveLength(0);
    expect(result.timestamp).toBe('2024-01-01T00:00:00.000Z');
  });

  it('reuses cached provider response when available', async () => {
    const provider = new SequenceProvider('mock', {
      responses: [
        {
          outputMessages: [{ role: 'assistant', content: 'Use structured logging.' }],
        },
      ],
    });

    const cache: EvaluationCache = {
      store: new Map<string, ProviderResponse>(),
      async get(key: string) {
        return (this as unknown as { store: Map<string, ProviderResponse> }).store.get(key);
      },
      async set(key: string, value: ProviderResponse) {
        (this as unknown as { store: Map<string, ProviderResponse> }).store.set(key, value);
      },
    } as EvaluationCache & { store: Map<string, ProviderResponse> };

    const first = await runEvalCase({
      evalCase: baseTestCase,
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
      cache,
      useCache: true,
    });

    expect(first.candidateAnswer).toContain('structured logging');

    const second = await runEvalCase({
      evalCase: baseTestCase,
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
      cache,
      useCache: true,
    });

    expect(second.candidateAnswer).toBe(first.candidateAnswer);
    expect(provider.callIndex).toBe(1);
  });

  it('retries timeout errors up to maxRetries', async () => {
    const provider = new SequenceProvider('mock', {
      errors: [new Error('Request timeout')],
      responses: [
        {
          outputMessages: [{ role: 'assistant', content: 'Add structured logging.' }],
        },
      ],
    });

    const result = await runEvalCase({
      evalCase: baseTestCase,
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
      maxRetries: 1,
    });

    expect(result.score).toBeGreaterThan(0);
  });

  it('returns error result on unrecoverable failure', async () => {
    const provider = new SequenceProvider('mock', {
      errors: [new Error('Provider failure')],
    });

    const result = await runEvalCase({
      evalCase: baseTestCase,
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
    });

    expect(result.score).toBe(0);
    expect(result.misses[0]).toContain('Provider failure');
  });

  it('surfaces provider raw.error as evaluation error', async () => {
    const provider = new SequenceProvider('mock', {
      responses: [
        {
          outputMessages: [{ role: 'assistant', content: 'Some response text.' }],
          raw: { error: "Batch output missing id 'case-1'" },
        },
      ],
    });

    const result = await runEvalCase({
      evalCase: baseTestCase,
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
    });

    expect(result.error).toBe("Batch output missing id 'case-1'");
  });

  it('reports failed progress status for batch item errors', async () => {
    class BatchProvider implements Provider {
      readonly id = 'batch:mock';
      readonly kind = 'mock' as const;
      readonly targetName = 'mock';
      readonly supportsBatch = true;

      async invoke(): Promise<ProviderResponse> {
        throw new Error('invoke not used');
      }

      async invokeBatch(
        requests: readonly ProviderRequest[],
      ): Promise<readonly ProviderResponse[]> {
        return requests.map((request) => {
          if (request.evalCaseId === 'case-2') {
            return {
              outputMessages: [
                { role: 'assistant', content: "Error: Batch output missing id 'case-2'" },
              ],
              raw: { error: "Batch output missing id 'case-2'" },
            };
          }

          return {
            outputMessages: [{ role: 'assistant', content: 'OK' }],
          };
        });
      }
    }

    const events: Array<{ testId: string; status: string; error?: string }> = [];

    const evalCases: EvalTest[] = [
      { ...baseTestCase, id: 'case-1' },
      { ...baseTestCase, id: 'case-2' },
    ];

    const results = await runEvaluation({
      testFilePath: 'in-memory.yaml',
      repoRoot: 'in-memory',
      target: {
        ...baseTarget,
        providerBatching: true,
        workers: 1,
      },
      providerFactory: () => new BatchProvider(),
      evaluators: evaluatorRegistry,
      evalCases,
      onProgress: async (event) => {
        if (event.status === 'completed' || event.status === 'failed') {
          events.push({ testId: event.testId, status: event.status, error: event.error });
        }
      },
    });

    expect(results).toHaveLength(2);
    expect(events.find((e) => e.testId === 'case-1')?.status).toBe('completed');
    const case2 = events.find((e) => e.testId === 'case-2');
    expect(case2?.status).toBe('failed');
    expect(case2?.error).toBe("Batch output missing id 'case-2'");
  });

  it('uses a custom evaluator prompt when provided', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'agentv-custom-judge-'));
    const promptPath = path.join(directory, 'judge.md');
    writeFileSync(promptPath, 'CUSTOM PROMPT CONTENT with {{ candidate_answer }}', 'utf8');

    const provider = new SequenceProvider('mock', {
      responses: [
        {
          outputMessages: [{ role: 'assistant', content: 'Answer text' }],
        },
      ],
    });

    const judgeProvider = new CapturingJudgeProvider('judge', {
      outputMessages: [
        {
          role: 'assistant',
          content: JSON.stringify({
            score: 0.9,
            hits: ['used prompt'],
            misses: [],
          }),
        },
      ],
    });

    const evaluatorRegistry = {
      llm_judge: new LlmJudgeEvaluator({
        resolveJudgeProvider: async () => judgeProvider,
      }),
    };

    const result = await runEvalCase({
      evalCase: {
        ...baseTestCase,
        evaluators: [{ name: 'semantic', type: 'llm_judge', promptPath }],
      },
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
      now: () => new Date('2024-01-01T00:00:00Z'),
    });

    // Custom template goes in user prompt, system prompt only has output schema
    expect(judgeProvider.lastRequest?.question).toContain('CUSTOM PROMPT CONTENT');
    expect(judgeProvider.lastRequest?.systemPrompt).toContain(
      'You must respond with a single JSON object',
    );
    expect(judgeProvider.lastRequest?.systemPrompt).not.toContain('CUSTOM PROMPT CONTENT');

    expect(result.evaluatorResults?.[0]?.evaluatorProviderRequest?.userPrompt).toContain(
      'CUSTOM PROMPT CONTENT',
    );
    expect(result.evaluatorResults?.[0]?.evaluatorProviderRequest?.systemPrompt).toContain(
      'You must respond with a single JSON object',
    );
    expect(result.evaluatorResults?.[0]?.evaluatorProviderRequest?.systemPrompt).not.toContain(
      'CUSTOM PROMPT CONTENT',
    );
  });

  it('passes chatPrompt for multi-turn evals', async () => {
    const provider = new CapturingProvider('mock', {
      outputMessages: [{ role: 'assistant', content: 'Candidate' }],
    });

    const result = await runEvalCase({
      evalCase: {
        id: 'multi',
        dataset: 'ds',
        question: '',
        input: [
          { role: 'system', content: 'Guide' },
          {
            role: 'user',
            content: [
              { type: 'file', value: 'snippet.txt' },
              { type: 'text', value: 'Review' },
            ],
          },
          { role: 'assistant', content: 'Ack' },
        ],
        input_segments: [
          { type: 'text', value: 'Guide' },
          { type: 'file', path: 'snippet.txt', text: 'code()' },
          { type: 'text', value: 'Review' },
          { type: 'text', value: 'Ack' },
        ],
        expected_output: [],
        reference_answer: '',
        guideline_paths: [],
        file_paths: [],
        criteria: '',
        evaluator: 'llm_judge',
      },
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
    });

    const chatPrompt = provider.lastRequest?.chatPrompt;
    expect(chatPrompt).toBeDefined();
    if (!chatPrompt) throw new Error('chatPrompt is undefined');
    expect(chatPrompt[0].role).toBe('system');
    expect(chatPrompt[1]).toEqual({
      role: 'user',
      content: '<file path="snippet.txt">\ncode()\n</file>\nReview',
    });
    expect(chatPrompt[2]).toEqual({ role: 'assistant', content: 'Ack' });
    expect(result.lmProviderRequest?.chat_prompt).toBeDefined();
  });

  it('omits chatPrompt for single-turn evals', async () => {
    const provider = new CapturingProvider('mock', {
      outputMessages: [{ role: 'assistant', content: 'Candidate' }],
    });

    await runEvalCase({
      evalCase: {
        id: 'single',
        dataset: 'ds',
        question: '',
        input: [{ role: 'user', content: 'Hello' }],
        input_segments: [{ type: 'text', value: 'Hello' }],
        expected_output: [],
        reference_answer: '',
        guideline_paths: [],
        file_paths: [],
        criteria: '',
        evaluator: 'llm_judge',
      },
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
    });

    expect(provider.lastRequest?.chatPrompt).toBeUndefined();
    expect(provider.lastRequest?.question.trim()).toBe('Hello');
  });

  it('populates agent_provider_request for agent providers', async () => {
    class AgentProvider implements Provider {
      readonly id = 'agent';
      readonly kind = 'codex'; // Agent provider kind
      readonly targetName = 'agent';
      async invoke() {
        return { outputMessages: [{ role: 'assistant', content: 'ok' }] };
      }
    }

    const provider = new AgentProvider();

    const result = await runEvalCase({
      evalCase: baseTestCase,
      provider,
      target: {
        ...baseTarget,
        kind: 'codex',
        config: { executable: 'echo' },
      },
      evaluators: evaluatorRegistry,
    });

    expect(result.agentProviderRequest).toBeDefined();
    expect(result.lmProviderRequest).toBeUndefined();
    expect(result.agentProviderRequest?.question).toBe('Explain logging improvements');
  });

  it('uses file references (not embedded contents) for cli providers', async () => {
    const provider = new CapturingCliProvider('cli', {
      outputMessages: [{ role: 'assistant', content: 'ok' }],
    });

    const result = await runEvalCase({
      evalCase: {
        ...baseTestCase,
        input: [
          {
            role: 'user',
            content: [
              { type: 'file', value: 'input.json' },
              { type: 'text', value: 'Summarize the file.' },
            ],
          },
        ],
        input_segments: [
          { type: 'file', path: 'input.json', text: '{"secret":true}' },
          { type: 'text', value: 'Summarize the file.' },
        ],
        file_paths: ['/abs/path/input.json'],
      },
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
    });

    expect(result.lmProviderRequest).toBeDefined();
    expect(result.lmProviderRequest?.question).toContain('<file: path="input.json">');
    expect(result.lmProviderRequest?.question).not.toContain('<file path="input.json">');
    expect(result.lmProviderRequest?.question).not.toContain('{"secret":true}');
  });
});

// Provider that returns outputMessages with tool calls
class TraceProvider implements Provider {
  readonly id: string;
  readonly kind = 'mock' as const;
  readonly targetName: string;

  constructor(
    targetName: string,
    private readonly response: ProviderResponse,
    private readonly outputMessages?: readonly OutputMessage[],
  ) {
    this.id = `trace:${targetName}`;
    this.targetName = targetName;
  }

  async invoke(): Promise<ProviderResponse> {
    return {
      ...this.response,
      outputMessages: this.outputMessages,
    };
  }
}

describe('runEvalCase trace integration', () => {
  const traceTestCase: EvalTest = {
    id: 'trace-case',
    dataset: 'trace-dataset',
    question: 'What is the weather?',
    input: [{ role: 'user', content: 'What is the weather?' }],
    input_segments: [{ type: 'text', value: 'What is the weather?' }],
    expected_output: [],
    reference_answer: 'The weather is sunny',
    guideline_paths: [],
    file_paths: [],
    criteria: 'Weather information provided',
    evaluator: 'llm_judge',
  };

  it('includes traceSummary in result when provider returns outputMessages with tool calls', async () => {
    const outputMessages: OutputMessage[] = [
      {
        role: 'assistant',
        content: 'The weather is 72°F',
        toolCalls: [
          {
            tool: 'getWeather',
            input: { city: 'NYC' },
            output: '72°F',
            id: 'call-1',
            startTime: '2024-01-01T00:00:01Z',
          },
        ],
      },
    ];

    const provider = new TraceProvider(
      'mock',
      { outputMessages: [{ role: 'assistant', content: 'The weather is 72°F' }] },
      outputMessages,
    );

    const result = await runEvalCase({
      evalCase: traceTestCase,
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
    });

    expect(result.traceSummary).toBeDefined();
    expect(result.traceSummary?.eventCount).toBe(1);
    expect(result.traceSummary?.toolNames).toEqual(['getWeather']);
    expect(result.traceSummary?.toolCallsByName).toEqual({ getWeather: 1 });
    expect(result.traceSummary?.errorCount).toBe(0);
  });

  it('omits traceSummary when provider returns no outputMessages', async () => {
    const provider = new TraceProvider('mock', {
      outputMessages: [{ role: 'assistant', content: 'The weather is sunny' }],
    });

    const result = await runEvalCase({
      evalCase: traceTestCase,
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
    });

    expect(result.traceSummary).toBeUndefined();
  });

  it('includes traceSummary when provider reports tokenUsage without outputMessages', async () => {
    const provider = new TraceProvider('mock', {
      tokenUsage: { input: 10, output: 20, cached: 5 },
    });

    const result = await runEvalCase({
      evalCase: {
        ...traceTestCase,
        evaluators: [
          {
            name: 'token-budget',
            type: 'token_usage',
            max_total: 1000,
          },
        ],
      },
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
    });

    expect(result.traceSummary).toBeDefined();
    expect(result.traceSummary?.tokenUsage).toEqual({ input: 10, output: 20, cached: 5 });
    expect(result.score).toBe(1);
  });

  it('runs tool_trajectory evaluator with outputMessages', async () => {
    const outputMessages: OutputMessage[] = [
      {
        role: 'assistant',
        content: 'Result',
        toolCalls: [
          {
            tool: 'search',
            input: { query: 'weather' },
            output: 'result',
            id: 'call-1',
            startTime: '2024-01-01T00:00:00Z',
          },
          {
            tool: 'analyze',
            input: {},
            output: 'analyzed',
            id: 'call-2',
            startTime: '2024-01-01T00:00:02Z',
          },
        ],
      },
    ];

    const provider = new TraceProvider(
      'mock',
      { outputMessages: [{ role: 'assistant', content: 'Result' }] },
      outputMessages,
    );

    const trajectoryEvaluator = new ToolTrajectoryEvaluator({
      config: {
        name: 'tool-check',
        type: 'tool_trajectory',
        mode: 'any_order',
        minimums: { search: 1, analyze: 1 },
      },
    });

    const result = await runEvalCase({
      evalCase: {
        ...traceTestCase,
        evaluators: [
          {
            name: 'tool-check',
            type: 'tool_trajectory',
            mode: 'any_order',
            minimums: { search: 1, analyze: 1 },
          },
        ],
      },
      provider,
      target: baseTarget,
      evaluators: {
        llm_judge: evaluatorRegistry.llm_judge,
        tool_trajectory: trajectoryEvaluator,
      },
    });

    expect(result.score).toBe(1);
    expect(result.evaluatorResults).toHaveLength(1);
    expect(result.evaluatorResults?.[0]?.name).toBe('tool-check');
    expect(result.evaluatorResults?.[0]?.verdict).toBe('pass');
  });

  it('fails tool_trajectory evaluator when no trace available', async () => {
    const provider = new TraceProvider('mock', {
      outputMessages: [{ role: 'assistant', content: 'Result' }],
    });

    const trajectoryEvaluator = new ToolTrajectoryEvaluator({
      config: {
        name: 'tool-check',
        type: 'tool_trajectory',
        mode: 'any_order',
        minimums: { search: 1 },
      },
    });

    const result = await runEvalCase({
      evalCase: {
        ...traceTestCase,
        evaluators: [
          {
            name: 'tool-check',
            type: 'tool_trajectory',
            mode: 'any_order',
            minimums: { search: 1 },
          },
        ],
      },
      provider,
      target: baseTarget,
      evaluators: {
        llm_judge: evaluatorRegistry.llm_judge,
        tool_trajectory: trajectoryEvaluator,
      },
    });

    expect(result.score).toBe(0);
    expect(result.evaluatorResults?.[0]?.verdict).toBe('fail');
    expect(result.evaluatorResults?.[0]?.misses).toContain('No trace available for evaluation');
  });

  it('runs latency/cost evaluators inside composite using traceSummary', async () => {
    const outputMessages: OutputMessage[] = [{ role: 'assistant', content: 'Done' }];

    const provider = new TraceProvider('mock', { costUsd: 0.05, durationMs: 1200 }, outputMessages);

    const result = await runEvalCase({
      evalCase: {
        ...traceTestCase,
        evaluators: [
          {
            name: 'metrics',
            type: 'composite',
            evaluators: [
              { name: 'latency', type: 'latency', threshold: 1500 },
              { name: 'cost', type: 'cost', budget: 0.1 },
            ],
            aggregator: { type: 'weighted_average' },
          },
        ],
      },
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
    });

    expect(result.score).toBe(1);
    expect(result.evaluatorResults).toHaveLength(1);
    expect(result.evaluatorResults?.[0]?.name).toBe('metrics');
    expect(result.evaluatorResults?.[0]?.verdict).toBe('pass');
    expect(result.evaluatorResults?.[0]?.evaluatorResults).toHaveLength(2);
    const childNames = result.evaluatorResults?.[0]?.evaluatorResults?.map((child) => child.name);
    expect(childNames).toEqual(['latency', 'cost']);
    const childVerdicts = result.evaluatorResults?.[0]?.evaluatorResults?.map(
      (child) => child.verdict,
    );
    expect(childVerdicts).toEqual(['pass', 'pass']);
  });

  it('computes correct trace summary with multiple tool calls', async () => {
    const outputMessages: OutputMessage[] = [
      {
        role: 'assistant',
        content: 'Done',
        toolCalls: [
          { tool: 'toolA', startTime: '2024-01-01T00:00:00Z' },
          { tool: 'toolB', startTime: '2024-01-01T00:00:01Z' },
          { tool: 'toolA', startTime: '2024-01-01T00:00:02Z' },
          { tool: 'toolC', startTime: '2024-01-01T00:00:03Z' },
        ],
      },
    ];

    const provider = new TraceProvider(
      'mock',
      { outputMessages: [{ role: 'assistant', content: 'Done' }] },
      outputMessages,
    );

    const result = await runEvalCase({
      evalCase: traceTestCase,
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
    });

    expect(result.traceSummary).toBeDefined();
    expect(result.traceSummary?.eventCount).toBe(4);
    expect(result.traceSummary?.toolNames).toEqual(['toolA', 'toolB', 'toolC']);
    expect(result.traceSummary?.toolCallsByName).toEqual({ toolA: 2, toolB: 1, toolC: 1 });
    expect(result.traceSummary?.errorCount).toBe(0);
  });

  describe('weighted evaluators', () => {
    it('computes weighted mean across multiple evaluators', async () => {
      const provider = new SequenceProvider('mock', {
        responses: [
          {
            outputMessages: [{ role: 'assistant', content: 'Candidate answer' }],
          },
        ],
      });

      const result = await runEvalCase({
        evalCase: {
          ...baseTestCase,
          evaluators: [
            { name: 'eval1', type: 'llm_judge', weight: 2.0 },
            { name: 'eval2', type: 'llm_judge', weight: 1.0 },
          ],
        },
        provider,
        target: baseTarget,
        evaluators: evaluatorRegistry,
      });

      // Both evaluators return 0.8 from the mock registry
      // eval1 weight=2.0, score=0.8 -> 1.6
      // eval2 weight=1.0, score=0.8 -> 0.8
      // Total: (1.6 + 0.8) / (2.0 + 1.0) = 2.4 / 3.0 = 0.8
      expect(result.score).toBeCloseTo(0.8);
      expect(result.evaluatorResults).toHaveLength(2);
      expect(result.evaluatorResults?.[0]?.weight).toBe(2.0);
      expect(result.evaluatorResults?.[1]?.weight).toBe(1.0);
    });

    it('defaults missing weights to 1.0', async () => {
      const provider = new SequenceProvider('mock', {
        responses: [
          {
            outputMessages: [{ role: 'assistant', content: 'Candidate answer' }],
          },
        ],
      });

      const result = await runEvalCase({
        evalCase: {
          ...baseTestCase,
          evaluators: [
            { name: 'eval1', type: 'llm_judge', weight: 3.0 },
            { name: 'eval2', type: 'llm_judge' }, // no weight specified
          ],
        },
        provider,
        target: baseTarget,
        evaluators: evaluatorRegistry,
      });

      // Both evaluators return 0.8 from the mock registry
      // eval1 weight=3.0, score=0.8 -> 2.4
      // eval2 weight=1.0 (default), score=0.8 -> 0.8
      // Total: (2.4 + 0.8) / (3.0 + 1.0) = 3.2 / 4.0 = 0.8
      expect(result.score).toBeCloseTo(0.8);
      expect(result.evaluatorResults?.[0]?.weight).toBe(3.0);
      expect(result.evaluatorResults?.[1]?.weight).toBe(1.0);
    });

    it('excludes evaluators with weight 0', async () => {
      const provider = new SequenceProvider('mock', {
        responses: [
          {
            outputMessages: [{ role: 'assistant', content: 'Candidate answer' }],
          },
        ],
      });

      const result = await runEvalCase({
        evalCase: {
          ...baseTestCase,
          evaluators: [
            { name: 'eval1', type: 'llm_judge', weight: 0 },
            { name: 'eval2', type: 'llm_judge', weight: 1.0 },
          ],
        },
        provider,
        target: baseTarget,
        evaluators: evaluatorRegistry,
      });

      // Both evaluators return 0.8 from the mock registry
      // eval1 weight=0, score=0.8 -> 0
      // eval2 weight=1.0, score=0.8 -> 0.8
      // Total: (0 + 0.8) / (0 + 1.0) = 0.8 / 1.0 = 0.8
      expect(result.score).toBeCloseTo(0.8);
      expect(result.evaluatorResults?.[0]?.weight).toBe(0);
      expect(result.evaluatorResults?.[1]?.weight).toBe(1.0);
    });

    it('returns 0 when all evaluators have weight 0', async () => {
      const provider = new SequenceProvider('mock', {
        responses: [
          {
            outputMessages: [{ role: 'assistant', content: 'Candidate answer' }],
          },
        ],
      });

      const result = await runEvalCase({
        evalCase: {
          ...baseTestCase,
          evaluators: [
            { name: 'eval1', type: 'llm_judge', weight: 0 },
            { name: 'eval2', type: 'llm_judge', weight: 0 },
          ],
        },
        provider,
        target: baseTarget,
        evaluators: evaluatorRegistry,
      });

      // Total weight is 0, so result should be 0
      expect(result.score).toBe(0);
    });
  });

  describe('executable prompt templates', () => {
    it('executes TypeScript prompt template and uses output as custom prompt', async () => {
      const tmpDir = mkdtempSync(path.join(tmpdir(), 'prompt-template-'));
      const promptPath = path.join(tmpDir, 'my-prompt.ts');

      // Write a simple TypeScript prompt template that reads stdin manually
      // (avoiding dependency on @agentv/eval which won't resolve from temp dir)
      writeFileSync(
        promptPath,
        `import { readFileSync } from 'fs';
const stdin = readFileSync(0, 'utf8');
const input = JSON.parse(stdin);
console.log(\`Question: \${input.question}
Candidate: \${input.candidate_answer}
Reference: \${input.reference_answer ?? 'none'}\`);
`,
      );

      // Custom judge that captures the prompt it receives
      let receivedQuestion = '';
      const captureJudge = {
        kind: 'llm_judge' as const,
        async evaluate(context: { evalCase: EvalTest; evaluatorTemplateOverride?: string }) {
          // The evaluatorTemplateOverride should contain our custom prompt
          receivedQuestion = context.evaluatorTemplateOverride ?? '';
          return {
            score: 1.0,
            verdict: 'pass' as const,
            hits: ['Test passed'],
            misses: [],
            expectedAspectCount: 1,
          };
        },
      };

      const provider = new SequenceProvider('mock', {
        responses: [
          {
            outputMessages: [{ role: 'assistant', content: 'The answer is 4' }],
          },
        ],
      });

      const result = await runEvalCase({
        evalCase: {
          ...baseTestCase,
          question: 'What is 2+2?',
          reference_answer: 'The sum is 4',
          evaluators: [
            {
              name: 'ts-prompt-eval',
              type: 'llm_judge',
              // Use explicit script array (matches code_judge pattern)
              resolvedPromptScript: ['bun', 'run', promptPath],
            },
          ],
        },
        provider,
        target: baseTarget,
        evaluators: { llm_judge: captureJudge },
      });

      expect(result.score).toBe(1.0);
      expect(receivedQuestion).toContain('Question: What is 2+2?');
      expect(receivedQuestion).toContain('Candidate: The answer is 4');
      expect(receivedQuestion).toContain('Reference: The sum is 4');
    });

    it('executes JavaScript prompt template', async () => {
      const tmpDir = mkdtempSync(path.join(tmpdir(), 'prompt-template-js-'));
      const promptPath = path.join(tmpDir, 'my-prompt.js');

      // Write a simple JS prompt template that reads stdin manually
      writeFileSync(
        promptPath,
        `const fs = require('fs');
const stdin = fs.readFileSync(0, 'utf8');
const input = JSON.parse(stdin);
console.log('Question: ' + input.question + '\\nAnswer: ' + input.candidate_answer);
`,
      );

      let receivedPrompt = '';
      const captureJudge = {
        kind: 'llm_judge' as const,
        async evaluate(context: { evaluatorTemplateOverride?: string }) {
          receivedPrompt = context.evaluatorTemplateOverride ?? '';
          return {
            score: 1.0,
            verdict: 'pass' as const,
            hits: [],
            misses: [],
            expectedAspectCount: 1,
          };
        },
      };

      const provider = new SequenceProvider('mock', {
        responses: [
          {
            outputMessages: [{ role: 'assistant', content: 'Test response' }],
          },
        ],
      });

      const result = await runEvalCase({
        evalCase: {
          ...baseTestCase,
          question: 'Test question',
          evaluators: [
            {
              name: 'js-prompt-eval',
              type: 'llm_judge',
              // Use explicit script array - node for JavaScript files
              resolvedPromptScript: ['node', promptPath],
            },
          ],
        },
        provider,
        target: baseTarget,
        evaluators: { llm_judge: captureJudge },
      });

      expect(result.score).toBe(1.0);
      expect(receivedPrompt).toContain('Question: Test question');
      expect(receivedPrompt).toContain('Answer: Test response');
    });

    it('falls back to text file reading for .txt files', async () => {
      const tmpDir = mkdtempSync(path.join(tmpdir(), 'prompt-txt-'));
      const promptPath = path.join(tmpDir, 'my-prompt.txt');

      // Write a static text prompt
      writeFileSync(promptPath, 'Static prompt content from text file');

      let receivedPrompt = '';
      const captureJudge = {
        kind: 'llm_judge' as const,
        async evaluate(context: { evaluatorTemplateOverride?: string }) {
          receivedPrompt = context.evaluatorTemplateOverride ?? '';
          return {
            score: 1.0,
            verdict: 'pass' as const,
            hits: [],
            misses: [],
            expectedAspectCount: 1,
          };
        },
      };

      const provider = new SequenceProvider('mock', {
        responses: [
          {
            outputMessages: [{ role: 'assistant', content: 'Response' }],
          },
        ],
      });

      const result = await runEvalCase({
        evalCase: {
          ...baseTestCase,
          evaluators: [
            {
              name: 'txt-prompt-eval',
              type: 'llm_judge',
              promptPath: promptPath,
              resolvedPromptPath: promptPath,
            },
          ],
        },
        provider,
        target: baseTarget,
        evaluators: { llm_judge: captureJudge },
      });

      expect(result.score).toBe(1.0);
      expect(receivedPrompt).toBe('Static prompt content from text file');
    });
  });
});

describe('runEvaluation with trials', () => {
  // Provider that returns configurable scores via alternating evaluator results
  class MultiCallProvider implements Provider {
    readonly id = 'multi:mock';
    readonly kind = 'mock' as const;
    readonly targetName = 'mock';
    callCount = 0;

    async invoke(): Promise<ProviderResponse> {
      this.callCount += 1;
      return {
        outputMessages: [{ role: 'assistant', content: `Response ${this.callCount}` }],
      };
    }
  }

  // Evaluator that returns different scores on successive calls
  function createScoringEvaluator(scores: number[]) {
    let callIndex = 0;
    return {
      llm_judge: {
        kind: 'llm_judge' as const,
        async evaluate() {
          const score = scores[callIndex] ?? scores[scores.length - 1];
          callIndex += 1;
          return {
            score,
            verdict: (score >= 0.8 ? 'pass' : score >= 0.6 ? 'borderline' : 'fail') as const,
            hits: score >= 0.8 ? ['passed'] : [],
            misses: score < 0.8 ? ['failed'] : [],
            expectedAspectCount: 1,
          };
        },
      },
    };
  }

  it('pass_at_k: passes on second trial and early exits', async () => {
    const provider = new MultiCallProvider();
    const evalRegistry = createScoringEvaluator([0.4, 0.9]);
    const trials: TrialsConfig = { count: 5, strategy: 'pass_at_k' };

    const results = await runEvaluation({
      testFilePath: 'in-memory.yaml',
      repoRoot: 'in-memory',
      target: baseTarget,
      providerFactory: () => provider,
      evaluators: evalRegistry,
      evalCases: [baseTestCase],
      trials,
    });

    expect(results).toHaveLength(1);
    const result = results[0];
    expect(result.score).toBe(0.9);
    expect(result.trials).toHaveLength(2); // Early exit after pass
    expect(result.trials?.[0].verdict).toBe('fail');
    expect(result.trials?.[1].verdict).toBe('pass');
    expect(result.aggregation?.strategy).toBe('pass_at_k');
    if (result.aggregation?.strategy === 'pass_at_k') {
      expect(result.aggregation.passedAttempts).toBe(1);
      expect(result.aggregation.totalAttempts).toBe(2);
    }
    // Provider should have been called exactly 2 times
    expect(provider.callCount).toBe(2);
  });

  it('pass_at_k: all fail runs all trials', async () => {
    const provider = new MultiCallProvider();
    const evalRegistry = createScoringEvaluator([0.3, 0.4, 0.2]);
    const trials: TrialsConfig = { count: 3, strategy: 'pass_at_k' };

    const results = await runEvaluation({
      testFilePath: 'in-memory.yaml',
      repoRoot: 'in-memory',
      target: baseTarget,
      providerFactory: () => provider,
      evaluators: evalRegistry,
      evalCases: [baseTestCase],
      trials,
    });

    const result = results[0];
    expect(result.trials).toHaveLength(3);
    expect(result.score).toBe(0.4); // Best score
    expect(provider.callCount).toBe(3);
  });

  it('mean: averages scores correctly', async () => {
    const provider = new MultiCallProvider();
    const evalRegistry = createScoringEvaluator([0.6, 0.8, 1.0]);
    const trials: TrialsConfig = { count: 3, strategy: 'mean' };

    const results = await runEvaluation({
      testFilePath: 'in-memory.yaml',
      repoRoot: 'in-memory',
      target: baseTarget,
      providerFactory: () => provider,
      evaluators: evalRegistry,
      evalCases: [baseTestCase],
      trials,
    });

    const result = results[0];
    expect(result.score).toBeCloseTo(0.8);
    expect(result.aggregation?.strategy).toBe('mean');
    if (result.aggregation?.strategy === 'mean') {
      expect(result.aggregation.mean).toBeCloseTo(0.8);
      expect(result.aggregation.min).toBe(0.6);
      expect(result.aggregation.max).toBe(1.0);
    }
  });

  it('confidence_interval: computes CI bounds', async () => {
    const provider = new MultiCallProvider();
    const evalRegistry = createScoringEvaluator([0.7, 0.8, 0.9]);
    const trials: TrialsConfig = { count: 3, strategy: 'confidence_interval' };

    const results = await runEvaluation({
      testFilePath: 'in-memory.yaml',
      repoRoot: 'in-memory',
      target: baseTarget,
      providerFactory: () => provider,
      evaluators: evalRegistry,
      evalCases: [baseTestCase],
      trials,
    });

    const result = results[0];
    expect(result.aggregation?.strategy).toBe('confidence_interval');
    if (result.aggregation?.strategy === 'confidence_interval') {
      expect(result.aggregation.mean).toBeCloseTo(0.8);
      expect(result.aggregation.ci95Lower).toBeLessThan(0.8);
      expect(result.aggregation.ci95Upper).toBeGreaterThan(0.8);
    }
  });

  it('cost_limit_usd: stops early and sets costLimited flag', async () => {
    const provider: Provider = {
      id: 'cost:mock',
      kind: 'mock' as const,
      targetName: 'mock',
      async invoke(): Promise<ProviderResponse> {
        return {
          outputMessages: [{ role: 'assistant', content: 'response' }],
          costUsd: 3.0, // Each call costs $3
        };
      },
    };
    const evalRegistry = createScoringEvaluator([0.5, 0.5, 0.5, 0.5, 0.5]);
    const trials: TrialsConfig = { count: 5, strategy: 'pass_at_k', costLimitUsd: 5.0 };

    const results = await runEvaluation({
      testFilePath: 'in-memory.yaml',
      repoRoot: 'in-memory',
      target: baseTarget,
      providerFactory: () => provider,
      evaluators: evalRegistry,
      evalCases: [baseTestCase],
      trials,
    });

    const result = results[0];
    expect(result.costLimited).toBe(true);
    // Should have stopped after 2 trials ($3 + $3 = $6 >= $5 limit)
    expect(result.trials?.length).toBeLessThanOrEqual(2);
  });

  it('count=1: no trial metadata in result (handled by orchestrator)', async () => {
    const provider = new MultiCallProvider();

    // count=1 should not produce trials metadata — extractTrialsConfig returns
    // undefined for count=1, so trials option won't be set. Verify normal behavior.
    const results = await runEvaluation({
      testFilePath: 'in-memory.yaml',
      repoRoot: 'in-memory',
      target: baseTarget,
      providerFactory: () => provider,
      evaluators: evaluatorRegistry,
      evalCases: [baseTestCase],
      // No trials option
    });

    const result = results[0];
    expect(result.trials).toBeUndefined();
    expect(result.aggregation).toBeUndefined();
    expect(result.costLimited).toBeUndefined();
  });

  it('disables cache when trials > 1', async () => {
    const provider = new MultiCallProvider();
    const evalRegistry = createScoringEvaluator([0.5, 0.9]);
    const trials: TrialsConfig = { count: 2, strategy: 'pass_at_k' };

    const cache: EvaluationCache = {
      async get() {
        return undefined;
      },
      async set() {},
    };

    const results = await runEvaluation({
      testFilePath: 'in-memory.yaml',
      repoRoot: 'in-memory',
      target: baseTarget,
      providerFactory: () => provider,
      evaluators: evalRegistry,
      evalCases: [baseTestCase],
      trials,
      cache,
      useCache: true, // Should be overridden to false
    });

    // Provider should have been called for each trial (cache disabled)
    expect(provider.callCount).toBe(2);
    expect(results[0].trials).toHaveLength(2);
  });
});

describe('workspace setup/teardown', () => {
  let testDir: string;

  afterEach(async () => {
    if (testDir) {
      const { rm } = await import('node:fs/promises');
      await rm(testDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('executes setup script and captures output in result', async () => {
    const { mkdtemp, writeFile, mkdir } = await import('node:fs/promises');
    testDir = await mkdtemp(path.join(tmpdir(), 'agentv-orch-ws-'));
    const scriptsDir = path.join(testDir, 'scripts');
    await mkdir(scriptsDir, { recursive: true });
    const templateDir = path.join(testDir, 'template');
    await mkdir(templateDir, { recursive: true });
    await writeFile(path.join(templateDir, 'hello.txt'), 'hello');

    // Create a setup script that outputs a message
    const setupScript = path.join(scriptsDir, 'setup.js');
    await writeFile(
      setupScript,
      `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
let data = '';
rl.on('line', (line) => { data += line; });
rl.on('close', () => {
  const ctx = JSON.parse(data);
  console.log('Setup done for ' + ctx.test_id);
  process.exit(0);
});
`,
    );

    const provider = new SequenceProvider('mock', {
      responses: [
        {
          outputMessages: [{ role: 'assistant', content: [{ type: 'text', text: 'answer' }] }],
        },
      ],
    });

    const evalCase: EvalTest = {
      ...baseTestCase,
      workspace: {
        template: templateDir,
        setup: {
          script: ['node', setupScript],
          timeout_ms: 10000,
        },
      },
    };

    const result = await runEvalCase({
      evalCase,
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
      evalRunId: 'test-run',
      cleanupWorkspaces: true,
    });

    expect(result.setupOutput).toContain('Setup done for case-1');
    expect(result.error).toBeUndefined();
  });

  it('returns error result when setup script fails', async () => {
    const { mkdtemp, writeFile, mkdir } = await import('node:fs/promises');
    testDir = await mkdtemp(path.join(tmpdir(), 'agentv-orch-ws-'));
    const scriptsDir = path.join(testDir, 'scripts');
    await mkdir(scriptsDir, { recursive: true });
    const templateDir = path.join(testDir, 'template');
    await mkdir(templateDir, { recursive: true });
    await writeFile(path.join(templateDir, 'hello.txt'), 'hello');

    const failingScript = path.join(scriptsDir, 'fail.js');
    await writeFile(failingScript, 'console.error("setup boom"); process.exit(1);');

    const provider = new SequenceProvider('mock', {
      responses: [
        { outputMessages: [{ role: 'assistant', content: [{ type: 'text', text: 'answer' }] }] },
      ],
    });

    const evalCase: EvalTest = {
      ...baseTestCase,
      workspace: {
        template: templateDir,
        setup: {
          script: ['node', failingScript],
          timeout_ms: 5000,
        },
      },
    };

    const result = await runEvalCase({
      evalCase,
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
      evalRunId: 'test-run-fail',
      cleanupWorkspaces: true,
    });

    expect(result.error).toContain('Workspace setup failed');
    expect(result.score).toBe(0);
  });

  it('executes teardown script and captures output in result', async () => {
    const { mkdtemp, writeFile, mkdir } = await import('node:fs/promises');
    testDir = await mkdtemp(path.join(tmpdir(), 'agentv-orch-ws-'));
    const scriptsDir = path.join(testDir, 'scripts');
    await mkdir(scriptsDir, { recursive: true });
    const templateDir = path.join(testDir, 'template');
    await mkdir(templateDir, { recursive: true });
    await writeFile(path.join(templateDir, 'hello.txt'), 'hello');

    const teardownScript = path.join(scriptsDir, 'teardown.js');
    await writeFile(
      teardownScript,
      `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
let data = '';
rl.on('line', (line) => { data += line; });
rl.on('close', () => {
  const ctx = JSON.parse(data);
  console.log('Teardown done for ' + ctx.test_id);
  process.exit(0);
});
`,
    );

    const provider = new SequenceProvider('mock', {
      responses: [
        {
          outputMessages: [{ role: 'assistant', content: [{ type: 'text', text: 'answer' }] }],
        },
      ],
    });

    const evalCase: EvalTest = {
      ...baseTestCase,
      workspace: {
        template: templateDir,
        teardown: {
          script: ['node', teardownScript],
          timeout_ms: 10000,
        },
      },
    };

    const result = await runEvalCase({
      evalCase,
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
      evalRunId: 'test-run-td',
      cleanupWorkspaces: true,
    });

    expect(result.teardownOutput).toContain('Teardown done for case-1');
    expect(result.error).toBeUndefined();
  });
});

describe('deterministic assertion evaluators in orchestrator', () => {
  const assertionTestCase: EvalTest = {
    id: 'assert-1',
    dataset: 'test-dataset',
    question: 'Test question',
    input: [{ role: 'user', content: 'Test question' }],
    input_segments: [{ type: 'text', value: 'Test question' }],
    expected_output: [],
    reference_answer: '',
    guideline_paths: [],
    file_paths: [],
    criteria: '',
  };

  it('contains evaluator scores 1 when output contains value', async () => {
    const provider = new SequenceProvider('mock', {
      responses: [
        {
          outputMessages: [{ role: 'assistant', content: 'The answer is hello world today' }],
        },
      ],
    });

    const result = await runEvalCase({
      evalCase: {
        ...assertionTestCase,
        evaluators: [{ name: 'has-hello', type: 'contains', value: 'hello world' }],
      },
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
    });

    expect(result.score).toBe(1);
    expect(result.hits).toContain('Output contains "hello world"');
    expect(result.misses).toHaveLength(0);
    expect(result.evaluatorResults).toHaveLength(1);
    expect(result.evaluatorResults?.[0].type).toBe('contains');
    expect(result.evaluatorResults?.[0].score).toBe(1);
    expect(result.evaluatorResults?.[0].verdict).toBe('pass');
  });

  it('contains evaluator scores 0 when output does not contain value', async () => {
    const provider = new SequenceProvider('mock', {
      responses: [
        {
          outputMessages: [{ role: 'assistant', content: 'The answer is goodbye' }],
        },
      ],
    });

    const result = await runEvalCase({
      evalCase: {
        ...assertionTestCase,
        evaluators: [{ name: 'has-hello', type: 'contains', value: 'hello world' }],
      },
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
    });

    expect(result.score).toBe(0);
    expect(result.misses).toContain('Output does not contain "hello world"');
    expect(result.evaluatorResults).toHaveLength(1);
    expect(result.evaluatorResults?.[0].type).toBe('contains');
    expect(result.evaluatorResults?.[0].score).toBe(0);
    expect(result.evaluatorResults?.[0].verdict).toBe('fail');
  });

  it('regex evaluator scores 1 when output matches pattern', async () => {
    const provider = new SequenceProvider('mock', {
      responses: [
        {
          outputMessages: [{ role: 'assistant', content: 'The result is 42 units' }],
        },
      ],
    });

    const result = await runEvalCase({
      evalCase: {
        ...assertionTestCase,
        evaluators: [{ name: 'has-number', type: 'regex', value: '\\d+' }],
      },
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
    });

    expect(result.score).toBe(1);
    expect(result.evaluatorResults).toHaveLength(1);
    expect(result.evaluatorResults?.[0].type).toBe('regex');
    expect(result.evaluatorResults?.[0].score).toBe(1);
    expect(result.evaluatorResults?.[0].verdict).toBe('pass');
  });

  it('regex evaluator scores 0 when output does not match pattern', async () => {
    const provider = new SequenceProvider('mock', {
      responses: [
        {
          outputMessages: [{ role: 'assistant', content: 'No numbers here' }],
        },
      ],
    });

    const result = await runEvalCase({
      evalCase: {
        ...assertionTestCase,
        evaluators: [{ name: 'has-number', type: 'regex', value: '^\\d+$' }],
      },
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
    });

    expect(result.score).toBe(0);
    expect(result.evaluatorResults).toHaveLength(1);
    expect(result.evaluatorResults?.[0].type).toBe('regex');
    expect(result.evaluatorResults?.[0].score).toBe(0);
    expect(result.evaluatorResults?.[0].verdict).toBe('fail');
  });

  it('is_json evaluator scores 1 when output is valid JSON', async () => {
    const provider = new SequenceProvider('mock', {
      responses: [
        {
          outputMessages: [{ role: 'assistant', content: '{"key": "value"}' }],
        },
      ],
    });

    const result = await runEvalCase({
      evalCase: {
        ...assertionTestCase,
        evaluators: [{ name: 'valid-json', type: 'is_json' }],
      },
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
    });

    expect(result.score).toBe(1);
    expect(result.evaluatorResults).toHaveLength(1);
    expect(result.evaluatorResults?.[0].type).toBe('is_json');
    expect(result.evaluatorResults?.[0].score).toBe(1);
    expect(result.evaluatorResults?.[0].verdict).toBe('pass');
  });

  it('is_json evaluator scores 0 when output is not valid JSON', async () => {
    const provider = new SequenceProvider('mock', {
      responses: [
        {
          outputMessages: [{ role: 'assistant', content: 'not json at all' }],
        },
      ],
    });

    const result = await runEvalCase({
      evalCase: {
        ...assertionTestCase,
        evaluators: [{ name: 'valid-json', type: 'is_json' }],
      },
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
    });

    expect(result.score).toBe(0);
    expect(result.evaluatorResults).toHaveLength(1);
    expect(result.evaluatorResults?.[0].type).toBe('is_json');
    expect(result.evaluatorResults?.[0].score).toBe(0);
    expect(result.evaluatorResults?.[0].verdict).toBe('fail');
  });

  it('equals evaluator scores 1 when output exactly matches value (trimmed)', async () => {
    const provider = new SequenceProvider('mock', {
      responses: [
        {
          outputMessages: [{ role: 'assistant', content: '  exact match  ' }],
        },
      ],
    });

    const result = await runEvalCase({
      evalCase: {
        ...assertionTestCase,
        evaluators: [{ name: 'exact', type: 'equals', value: 'exact match' }],
      },
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
    });

    expect(result.score).toBe(1);
    expect(result.evaluatorResults).toHaveLength(1);
    expect(result.evaluatorResults?.[0].type).toBe('equals');
    expect(result.evaluatorResults?.[0].score).toBe(1);
    expect(result.evaluatorResults?.[0].verdict).toBe('pass');
  });

  it('equals evaluator scores 0 when output does not match value', async () => {
    const provider = new SequenceProvider('mock', {
      responses: [
        {
          outputMessages: [{ role: 'assistant', content: 'different text' }],
        },
      ],
    });

    const result = await runEvalCase({
      evalCase: {
        ...assertionTestCase,
        evaluators: [{ name: 'exact', type: 'equals', value: 'exact match' }],
      },
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
    });

    expect(result.score).toBe(0);
    expect(result.evaluatorResults).toHaveLength(1);
    expect(result.evaluatorResults?.[0].type).toBe('equals');
    expect(result.evaluatorResults?.[0].score).toBe(0);
    expect(result.evaluatorResults?.[0].verdict).toBe('fail');
  });

  it('supports custom weight on assertion evaluators', async () => {
    const provider = new SequenceProvider('mock', {
      responses: [
        {
          outputMessages: [{ role: 'assistant', content: 'hello world' }],
        },
      ],
    });

    const result = await runEvalCase({
      evalCase: {
        ...assertionTestCase,
        evaluators: [{ name: 'weighted', type: 'contains', value: 'hello', weight: 2.0 }],
      },
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
    });

    expect(result.score).toBe(1);
    expect(result.evaluatorResults?.[0].weight).toBe(2.0);
  });

  it('combines multiple assertion evaluators with weighted average', async () => {
    const provider = new SequenceProvider('mock', {
      responses: [
        {
          outputMessages: [{ role: 'assistant', content: 'hello world' }],
        },
      ],
    });

    const result = await runEvalCase({
      evalCase: {
        ...assertionTestCase,
        evaluators: [
          { name: 'has-hello', type: 'contains', value: 'hello' },
          { name: 'has-foo', type: 'contains', value: 'foo' },
        ],
      },
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
    });

    // One passes (score=1), one fails (score=0), average = 0.5
    expect(result.score).toBe(0.5);
    expect(result.evaluatorResults).toHaveLength(2);
  });
});
