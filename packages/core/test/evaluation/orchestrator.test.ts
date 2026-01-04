import { afterEach, describe, expect, it, mock } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { LlmJudgeEvaluator, ToolTrajectoryEvaluator } from '../../src/evaluation/evaluators.js';
import { type EvaluationCache, runEvalCase } from '../../src/evaluation/orchestrator.js';
import type { ResolvedTarget } from '../../src/evaluation/providers/targets.js';
import type {
  OutputMessage,
  Provider,
  ProviderRequest,
  ProviderResponse,
  ToolCall,
} from '../../src/evaluation/providers/types.js';
import type { EvalCase } from '../../src/evaluation/types.js';

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

const baseTestCase: EvalCase = {
  id: 'case-1',
  dataset: 'test-dataset',
  question: 'Explain logging improvements',
  input_messages: [{ role: 'user', content: 'Explain logging improvements' }],
  input_segments: [{ type: 'text', value: 'Explain logging improvements' }],
  expected_messages: [],
  reference_answer: '- add structured logging\n- avoid global state',
  guideline_paths: [],
  file_paths: [],
  code_snippets: [],
  expected_outcome: 'Logging improved',
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

  it('dumps prompt payloads when directory provided', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'agentv-prompts-'));
    const provider = new SequenceProvider('mock', {
      responses: [
        {
          outputMessages: [{ role: 'assistant', content: 'Add structured logging.' }],
        },
      ],
    });

    await runEvalCase({
      evalCase: baseTestCase,
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
      promptDumpDir: directory,
    });

    const files = readdirSync(directory);
    expect(files.length).toBeGreaterThan(0);

    const payload = JSON.parse(readFileSync(path.join(directory, files[0]), 'utf8')) as {
      question: string;
      guideline_paths: unknown;
    };
    expect(payload.question).toContain('Explain logging improvements');
    expect(Array.isArray(payload.guideline_paths)).toBe(true);
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
        input_messages: [
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
        expected_messages: [],
        reference_answer: '',
        guideline_paths: [],
        file_paths: [],
        code_snippets: [],
        expected_outcome: '',
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
        input_messages: [{ role: 'user', content: 'Hello' }],
        input_segments: [{ type: 'text', value: 'Hello' }],
        expected_messages: [],
        reference_answer: '',
        guideline_paths: [],
        file_paths: [],
        code_snippets: [],
        expected_outcome: '',
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
        input_messages: [
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
  const traceTestCase: EvalCase = {
    id: 'trace-case',
    dataset: 'trace-dataset',
    question: 'What is the weather?',
    input_messages: [{ role: 'user', content: 'What is the weather?' }],
    input_segments: [{ type: 'text', value: 'What is the weather?' }],
    expected_messages: [],
    reference_answer: 'The weather is sunny',
    guideline_paths: [],
    file_paths: [],
    code_snippets: [],
    expected_outcome: 'Weather information provided',
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
            timestamp: '2024-01-01T00:00:01Z',
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
            timestamp: '2024-01-01T00:00:00Z',
          },
          {
            tool: 'analyze',
            input: {},
            output: 'analyzed',
            id: 'call-2',
            timestamp: '2024-01-01T00:00:02Z',
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
          { tool: 'toolA', timestamp: '2024-01-01T00:00:00Z' },
          { tool: 'toolB', timestamp: '2024-01-01T00:00:01Z' },
          { tool: 'toolA', timestamp: '2024-01-01T00:00:02Z' },
          { tool: 'toolC', timestamp: '2024-01-01T00:00:03Z' },
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
});
