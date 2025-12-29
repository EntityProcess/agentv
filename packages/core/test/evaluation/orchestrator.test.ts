import { afterEach, describe, expect, it, mock } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { LlmJudgeEvaluator, ToolTrajectoryEvaluator } from '../../src/evaluation/evaluators.js';
import { type EvaluationCache, runEvalCase } from '../../src/evaluation/orchestrator.js';
import type { ResolvedTarget } from '../../src/evaluation/providers/targets.js';
import type {
  Provider,
  ProviderRequest,
  ProviderResponse,
} from '../../src/evaluation/providers/types.js';
import type { TraceEvent } from '../../src/evaluation/trace.js';
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
      responses: [{ text: 'You should add structured logging and avoid global state.' }],
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
      responses: [{ text: 'Use structured logging.' }],
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

    expect(first.candidate_answer).toContain('structured logging');

    const second = await runEvalCase({
      evalCase: baseTestCase,
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
      cache,
      useCache: true,
    });

    expect(second.candidate_answer).toBe(first.candidate_answer);
    expect(provider.callIndex).toBe(1);
  });

  it('retries timeout errors up to maxRetries', async () => {
    const provider = new SequenceProvider('mock', {
      errors: [new Error('Request timeout')],
      responses: [{ text: 'Add structured logging.' }],
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
      responses: [{ text: 'Add structured logging.' }],
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
      responses: [{ text: 'Answer text' }],
    });

    const judgeProvider = new CapturingJudgeProvider('judge', {
      text: JSON.stringify({
        score: 0.9,
        hits: ['used prompt'],
        misses: [],
      }),
      reasoning: 'ok',
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

    expect(result.evaluator_results?.[0]?.evaluator_provider_request?.userPrompt).toContain(
      'CUSTOM PROMPT CONTENT',
    );
    expect(result.evaluator_results?.[0]?.evaluator_provider_request?.systemPrompt).toContain(
      'You must respond with a single JSON object',
    );
    expect(result.evaluator_results?.[0]?.evaluator_provider_request?.systemPrompt).not.toContain(
      'CUSTOM PROMPT CONTENT',
    );
  });

  it('passes chatPrompt for multi-turn evals', async () => {
    const provider = new CapturingProvider('mock', { text: 'Candidate' });

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
    expect(result.lm_provider_request?.chat_prompt).toBeDefined();
  });

  it('omits chatPrompt for single-turn evals', async () => {
    const provider = new CapturingProvider('mock', { text: 'Candidate' });

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
        return { text: 'ok' };
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

    expect(result.agent_provider_request).toBeDefined();
    expect(result.lm_provider_request).toBeUndefined();
    expect(result.agent_provider_request?.question).toBe('Explain logging improvements');
  });
});

// Provider that returns trace data with responses
class TraceProvider implements Provider {
  readonly id: string;
  readonly kind = 'mock' as const;
  readonly targetName: string;

  constructor(
    targetName: string,
    private readonly response: ProviderResponse,
    private readonly trace?: readonly TraceEvent[],
  ) {
    this.id = `trace:${targetName}`;
    this.targetName = targetName;
  }

  async invoke(): Promise<ProviderResponse> {
    return {
      ...this.response,
      trace: this.trace,
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

  it('includes trace_summary in result when provider returns trace', async () => {
    const trace: TraceEvent[] = [
      { type: 'model_step', timestamp: '2024-01-01T00:00:00Z', text: 'Thinking...' },
      {
        type: 'tool_call',
        timestamp: '2024-01-01T00:00:01Z',
        id: 'call-1',
        name: 'getWeather',
        input: { city: 'NYC' },
      },
      {
        type: 'tool_result',
        timestamp: '2024-01-01T00:00:02Z',
        id: 'call-1',
        name: 'getWeather',
        output: '72°F',
      },
      { type: 'message', timestamp: '2024-01-01T00:00:03Z', text: 'The weather is 72°F' },
    ];

    const provider = new TraceProvider('mock', { text: 'The weather is 72°F' }, trace);

    const result = await runEvalCase({
      evalCase: traceTestCase,
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
    });

    expect(result.trace_summary).toBeDefined();
    expect(result.trace_summary?.eventCount).toBe(4);
    expect(result.trace_summary?.toolNames).toEqual(['getWeather']);
    expect(result.trace_summary?.toolCallsByName).toEqual({ getWeather: 1 });
    expect(result.trace_summary?.errorCount).toBe(0);
  });

  it('omits trace_summary when provider returns no trace', async () => {
    const provider = new TraceProvider('mock', { text: 'The weather is sunny' });

    const result = await runEvalCase({
      evalCase: traceTestCase,
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
    });

    expect(result.trace_summary).toBeUndefined();
  });

  it('runs tool_trajectory evaluator with trace data', async () => {
    const trace: TraceEvent[] = [
      {
        type: 'tool_call',
        timestamp: '2024-01-01T00:00:00Z',
        id: 'call-1',
        name: 'search',
        input: { query: 'weather' },
      },
      {
        type: 'tool_result',
        timestamp: '2024-01-01T00:00:01Z',
        id: 'call-1',
        name: 'search',
        output: 'result',
      },
      {
        type: 'tool_call',
        timestamp: '2024-01-01T00:00:02Z',
        id: 'call-2',
        name: 'analyze',
        input: {},
      },
      {
        type: 'tool_result',
        timestamp: '2024-01-01T00:00:03Z',
        id: 'call-2',
        name: 'analyze',
        output: 'analyzed',
      },
    ];

    const provider = new TraceProvider('mock', { text: 'Result' }, trace);

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
    expect(result.evaluator_results).toHaveLength(1);
    expect(result.evaluator_results?.[0]?.name).toBe('tool-check');
    expect(result.evaluator_results?.[0]?.verdict).toBe('pass');
  });

  it('fails tool_trajectory evaluator when no trace available', async () => {
    const provider = new TraceProvider('mock', { text: 'Result' });

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
    expect(result.evaluator_results?.[0]?.verdict).toBe('fail');
    expect(result.evaluator_results?.[0]?.misses).toContain('No trace available for evaluation');
  });

  it('computes correct trace summary with multiple tool calls', async () => {
    const trace: TraceEvent[] = [
      { type: 'tool_call', timestamp: '2024-01-01T00:00:00Z', name: 'toolA' },
      { type: 'tool_call', timestamp: '2024-01-01T00:00:01Z', name: 'toolB' },
      { type: 'tool_call', timestamp: '2024-01-01T00:00:02Z', name: 'toolA' },
      { type: 'tool_call', timestamp: '2024-01-01T00:00:03Z', name: 'toolC' },
      { type: 'error', timestamp: '2024-01-01T00:00:04Z', text: 'Something failed' },
    ];

    const provider = new TraceProvider('mock', { text: 'Done' }, trace);

    const result = await runEvalCase({
      evalCase: traceTestCase,
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
    });

    expect(result.trace_summary).toBeDefined();
    expect(result.trace_summary?.eventCount).toBe(5);
    expect(result.trace_summary?.toolNames).toEqual(['toolA', 'toolB', 'toolC']);
    expect(result.trace_summary?.toolCallsByName).toEqual({ toolA: 2, toolB: 1, toolC: 1 });
    expect(result.trace_summary?.errorCount).toBe(1);
  });

  describe('weighted evaluators', () => {
    it('computes weighted mean across multiple evaluators', async () => {
      const provider = new SequenceProvider('mock', {
        responses: [{ text: 'Candidate answer' }],
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
      expect(result.evaluator_results).toHaveLength(2);
      expect(result.evaluator_results?.[0]?.weight).toBe(2.0);
      expect(result.evaluator_results?.[1]?.weight).toBe(1.0);
    });

    it('defaults missing weights to 1.0', async () => {
      const provider = new SequenceProvider('mock', {
        responses: [{ text: 'Candidate answer' }],
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
      expect(result.evaluator_results?.[0]?.weight).toBe(3.0);
      expect(result.evaluator_results?.[1]?.weight).toBe(1.0);
    });

    it('excludes evaluators with weight 0', async () => {
      const provider = new SequenceProvider('mock', {
        responses: [{ text: 'Candidate answer' }],
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
      expect(result.evaluator_results?.[0]?.weight).toBe(0);
      expect(result.evaluator_results?.[1]?.weight).toBe(1.0);
    });

    it('returns 0 when all evaluators have weight 0', async () => {
      const provider = new SequenceProvider('mock', {
        responses: [{ text: 'Candidate answer' }],
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
