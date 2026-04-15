import { afterEach, describe, expect, it, mock } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { LlmGrader, ToolTrajectoryGrader } from '../../src/evaluation/graders.js';
import {
  type EvaluationCache,
  runEvalCase,
  runEvaluation,
} from '../../src/evaluation/orchestrator.js';
import type { ResolvedTarget } from '../../src/evaluation/providers/targets.js';
import type {
  Message,
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

class CapturingGraderProvider implements Provider {
  readonly id: string;
  readonly kind = 'mock' as const;
  readonly targetName: string;
  lastRequest?: ProviderRequest;

  constructor(
    targetName: string,
    private readonly response: ProviderResponse,
  ) {
    this.id = `grader:${targetName}`;
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
  suite: 'test-dataset',
  question: 'Explain logging improvements',
  input: [{ role: 'user', content: 'Explain logging improvements' }],
  expected_output: [],
  reference_answer: '- add structured logging\n- avoid global state',
  file_paths: [],
  criteria: 'Logging improved',
  evaluator: 'llm-grader',
};

const baseTarget: ResolvedTarget = {
  kind: 'mock',
  name: 'mock',
  config: { response: '{}' },
};

const evaluatorRegistry = {
  'llm-grader': {
    kind: 'llm-grader',
    async evaluate() {
      return {
        score: 0.8,
        verdict: 'pass' as const,
        assertions: [{ text: 'hit', passed: true }],
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
          output: [
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
    expect(result.assertions.filter((a) => a.passed)).toHaveLength(1);
    expect(result.assertions.filter((a) => !a.passed)).toHaveLength(0);
    expect(result.timestamp).toBe('2024-01-01T00:00:00.000Z');
    expect(result.input).toEqual([{ role: 'user', content: 'Explain logging improvements' }]);
    expect(result.executionStatus).toBe('ok');
    expect(result.failureStage).toBeUndefined();
    expect(result.failureReasonCode).toBeUndefined();
  });

  it('applies suite-level preprocessors to the implicit default llm-grader', async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'agentv-orchestrator-preprocessor-'));
    const reportPath = path.join(tempDir, 'report.xlsx');
    const scriptPath = path.join(tempDir, 'xlsx-to-text.js');
    writeFileSync(reportPath, Buffer.from([0, 159, 146, 150]));
    writeFileSync(
      scriptPath,
      `const fs = require('node:fs');
const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
if (!payload.path) throw new Error('missing path');
console.log('spreadsheet: revenue,total\\nQ1,42');`,
      'utf8',
    );

    const answerProvider = new SequenceProvider('file-output', {
      responses: [
        {
          output: [
            {
              role: 'assistant',
              content: [
                {
                  type: 'file',
                  media_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                  path: reportPath,
                },
              ],
            },
          ],
        },
      ],
    });
    const graderProvider = new CapturingGraderProvider('grader', {
      output: [
        {
          role: 'assistant',
          content: JSON.stringify({
            score: 1,
            assertions: [{ text: 'ok', passed: true }],
          }),
        },
      ],
    });

    const evalCase: EvalTest = {
      ...baseTestCase,
      id: 'implicit-preprocessors',
      assertions: undefined,
      preprocessors: [{ type: 'xlsx', command: [process.execPath, scriptPath] }],
    };

    const results = await runEvaluation({
      testFilePath: 'in-memory.yaml',
      repoRoot: tempDir,
      target: { ...baseTarget, name: 'file-output', graderTarget: 'grader' },
      targets: [
        { name: 'grader', provider: 'mock' },
        { name: 'file-output', provider: 'mock', grader_target: 'grader' },
      ],
      providerFactory: (target) => {
        if (target.name === 'grader') return graderProvider;
        return answerProvider;
      },
      evaluators: undefined,
      evalCases: [evalCase],
    });

    expect(results[0]?.score).toBe(1);
    expect(graderProvider.lastRequest?.question).toContain('spreadsheet: revenue,total');
    expect(graderProvider.lastRequest?.question).toContain('Q1,42');
  });

  it('reuses cached provider response when available', async () => {
    const provider = new SequenceProvider('mock', {
      responses: [
        {
          output: [{ role: 'assistant', content: 'Use structured logging.' }],
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

    expect(first.output).toBeDefined();
    expect(first.output.length).toBeGreaterThan(0);

    const second = await runEvalCase({
      evalCase: baseTestCase,
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
      cache,
      useCache: true,
    });

    expect(second.output).toEqual(first.output);
    expect(provider.callIndex).toBe(1);
  });

  it('preserves workspace cwd across retry attempts', async () => {
    const cwdsSeen: (string | undefined)[] = [];
    const provider: Provider = {
      id: 'mock:cwd-test',
      kind: 'mock' as const,
      targetName: 'cwd-test',
      async invoke(request: ProviderRequest): Promise<ProviderResponse> {
        cwdsSeen.push(request.cwd);
        if (cwdsSeen.length === 1) {
          throw new Error('Transient failure');
        }
        return {
          output: [{ role: 'assistant', content: 'Success on retry' }],
        };
      },
    };

    const result = await runEvalCase({
      evalCase: baseTestCase,
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
      maxRetries: 1,
      sharedWorkspacePath: '/fake/workspace/path',
    });

    expect(result.score).toBeGreaterThan(0);
    expect(cwdsSeen).toHaveLength(2);
    expect(cwdsSeen[0]).toBe('/fake/workspace/path');
    expect(cwdsSeen[1]).toBe('/fake/workspace/path');
  });

  it('retries provider errors up to maxRetries', async () => {
    const provider = new SequenceProvider('mock', {
      errors: [new Error('Request timeout')],
      responses: [
        {
          output: [{ role: 'assistant', content: 'Add structured logging.' }],
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

  it('retries non-timeout provider errors up to maxRetries', async () => {
    const provider = new SequenceProvider('mock', {
      errors: [new Error('Provider failure')],
      responses: [
        {
          output: [{ role: 'assistant', content: 'Add structured logging.' }],
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

  it('applies exponential backoff between retries', async () => {
    const provider = new SequenceProvider('mock', {
      errors: [new Error('Transient failure')],
      responses: [
        {
          output: [{ role: 'assistant', content: 'Add structured logging.' }],
        },
      ],
    });

    const startMs = Date.now();
    await runEvalCase({
      evalCase: baseTestCase,
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
      maxRetries: 1,
    });
    const elapsedMs = Date.now() - startMs;

    // First retry has 2^0 * 1000 = 1000ms backoff
    expect(elapsedMs).toBeGreaterThanOrEqual(900);
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
    expect(result.assertions.filter((a) => !a.passed)[0].text).toContain('Provider failure');
    expect(result.input).toEqual([{ role: 'user', content: 'Explain logging improvements' }]);
    expect(result.executionStatus).toBe('execution_error');
    expect(result.failureStage).toBe('agent');
    expect(result.failureReasonCode).toBe('provider_error');
    expect(result.executionError).toBeDefined();
    expect(result.executionError?.message).toContain('Provider failure');
  });

  it('surfaces JSON-RPC error objects with readable messages', async () => {
    // Simulates @agentclientprotocol/sdk rejecting with a plain JSON-RPC error object
    const jsonRpcError = { code: -32600, message: 'Invalid request' };
    const provider: Provider = {
      id: 'mock:jsonrpc',
      kind: 'mock' as const,
      targetName: 'mock',
      async invoke(): Promise<ProviderResponse> {
        throw jsonRpcError;
      },
    };

    const result = await runEvalCase({
      evalCase: baseTestCase,
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
    });

    expect(result.score).toBe(0);
    expect(result.executionStatus).toBe('execution_error');
    expect(result.error).toContain('Invalid request');
    expect(result.error).toContain('code -32600');
    expect(result.error).not.toContain('[object Object]');
  });

  it('surfaces provider raw.error as evaluation error', async () => {
    const provider = new SequenceProvider('mock', {
      responses: [
        {
          output: [{ role: 'assistant', content: 'Some response text.' }],
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
    expect(result.executionStatus).toBe('execution_error');
    expect(result.failureStage).toBe('agent');
    expect(result.failureReasonCode).toBe('provider_error');
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
              output: [{ role: 'assistant', content: "Error: Batch output missing id 'case-2'" }],
              raw: { error: "Batch output missing id 'case-2'" },
            };
          }

          return {
            output: [{ role: 'assistant', content: 'OK' }],
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
    const directory = mkdtempSync(path.join(tmpdir(), 'agentv-custom-grader-'));
    const promptPath = path.join(directory, 'grader-prompt.md');
    writeFileSync(promptPath, 'CUSTOM PROMPT CONTENT with {{ answer }}', 'utf8');

    const provider = new SequenceProvider('mock', {
      responses: [
        {
          output: [{ role: 'assistant', content: 'Answer text' }],
        },
      ],
    });

    const graderProvider = new CapturingGraderProvider('grader', {
      output: [
        {
          role: 'assistant',
          content: JSON.stringify({
            score: 0.9,
            assertions: [{ text: 'used prompt', passed: true }],
          }),
        },
      ],
    });

    const evaluatorRegistry = {
      'llm-grader': new LlmGrader({
        resolveGraderProvider: async () => graderProvider,
      }),
    };

    const result = await runEvalCase({
      evalCase: {
        ...baseTestCase,
        assertions: [{ name: 'semantic', type: 'llm-grader', promptPath }],
      },
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
      now: () => new Date('2024-01-01T00:00:00Z'),
    });

    // Custom template goes in user prompt, system prompt only has output schema
    expect(graderProvider.lastRequest?.question).toContain('CUSTOM PROMPT CONTENT');
    expect(graderProvider.lastRequest?.systemPrompt).toContain(
      'You must respond with a single JSON object',
    );
    expect(graderProvider.lastRequest?.systemPrompt).not.toContain('CUSTOM PROMPT CONTENT');

    expect(result.scores?.[0]?.input?.userPrompt).toContain('CUSTOM PROMPT CONTENT');
    expect(result.scores?.[0]?.input?.systemPrompt).toContain(
      'You must respond with a single JSON object',
    );
    expect(result.scores?.[0]?.input?.systemPrompt).not.toContain('CUSTOM PROMPT CONTENT');
  });

  it('passes chatPrompt for multi-turn evals', async () => {
    const provider = new CapturingProvider('mock', {
      output: [{ role: 'assistant', content: 'Candidate' }],
    });

    const result = await runEvalCase({
      evalCase: {
        id: 'multi',
        suite: 'ds',
        question: '',
        input: [
          { role: 'system', content: 'Guide' },
          {
            role: 'user',
            content: [
              { type: 'file', value: 'snippet.txt', path: 'snippet.txt', text: 'code()' },
              { type: 'text', value: 'Review' },
            ],
          },
          { role: 'assistant', content: 'Ack' },
        ],
        expected_output: [],
        reference_answer: '',
        file_paths: [],
        criteria: '',
        evaluator: 'llm-grader',
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
    expect(result.requests?.lm?.chat_prompt).toBeDefined();
    expect(result.input).toEqual(chatPrompt);
  });

  it('omits chatPrompt for single-turn evals', async () => {
    const provider = new CapturingProvider('mock', {
      output: [{ role: 'assistant', content: 'Candidate' }],
    });

    await runEvalCase({
      evalCase: {
        id: 'single',
        suite: 'ds',
        question: '',
        input: [{ role: 'user', content: 'Hello' }],
        expected_output: [],
        reference_answer: '',
        file_paths: [],
        criteria: '',
        evaluator: 'llm-grader',
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
        return { output: [{ role: 'assistant', content: 'ok' }] };
      }
    }

    const provider = new AgentProvider();

    // Without verbose, agent request should be omitted (no redundant content)
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

    expect(result.requests?.agent).toBeUndefined();
    expect(result.requests?.lm).toBeUndefined();

    // With verbose, agent request includes the input text
    const verboseResult = await runEvalCase({
      evalCase: baseTestCase,
      provider,
      target: {
        ...baseTarget,
        kind: 'codex',
        config: { executable: 'echo' },
      },
      evaluators: evaluatorRegistry,
      verbose: true,
    });

    expect(verboseResult.requests?.agent).toBeDefined();
    expect(verboseResult.requests?.lm).toBeUndefined();
    expect(verboseResult.requests?.agent?.input).toBe('Explain logging improvements');
  });

  it('uses file references (not embedded contents) for cli providers', async () => {
    const provider = new CapturingCliProvider('cli', {
      output: [{ role: 'assistant', content: 'ok' }],
    });

    const result = await runEvalCase({
      evalCase: {
        ...baseTestCase,
        input: [
          {
            role: 'user',
            content: [
              { type: 'file', value: 'input.json', path: 'input.json', text: '{"secret":true}' },
              { type: 'text', value: 'Summarize the file.' },
            ],
          },
        ],
        file_paths: ['/abs/path/input.json'],
      },
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
    });

    expect(result.requests?.lm).toBeDefined();
    expect(result.requests?.lm?.question).toContain('<file: path="input.json">');
    expect(result.requests?.lm?.question).not.toContain('<file path="input.json">');
    expect(result.requests?.lm?.question).not.toContain('{"secret":true}');
  });
});

// Provider that returns output with tool calls
class TraceProvider implements Provider {
  readonly id: string;
  readonly kind = 'mock' as const;
  readonly targetName: string;

  constructor(
    targetName: string,
    private readonly response: ProviderResponse,
    private readonly output?: readonly Message[],
  ) {
    this.id = `trace:${targetName}`;
    this.targetName = targetName;
  }

  async invoke(): Promise<ProviderResponse> {
    return {
      ...this.response,
      output: this.output,
    };
  }
}

describe('runEvalCase trace integration', () => {
  const traceTestCase: EvalTest = {
    id: 'trace-case',
    suite: 'trace-dataset',
    question: 'What is the weather?',
    input: [{ role: 'user', content: 'What is the weather?' }],
    expected_output: [],
    reference_answer: 'The weather is sunny',
    file_paths: [],
    criteria: 'Weather information provided',
    evaluator: 'llm-grader',
  };

  it('includes trace in result when provider returns output with tool calls', async () => {
    const output: Message[] = [
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
      { output: [{ role: 'assistant', content: 'The weather is 72°F' }] },
      output,
    );

    const result = await runEvalCase({
      evalCase: traceTestCase,
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
    });

    expect(result.trace).toBeDefined();
    expect(result.trace?.eventCount).toBe(1);
    expect(result.trace?.toolCalls).toEqual({ getWeather: 1 });
    expect(result.trace?.errorCount).toBe(0);
  });

  it('omits trace when provider returns no output', async () => {
    const provider = new TraceProvider('mock', {
      output: [{ role: 'assistant', content: 'The weather is sunny' }],
    });

    const result = await runEvalCase({
      evalCase: traceTestCase,
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
    });

    expect(result.trace).toBeUndefined();
  });

  it('includes trace when provider reports tokenUsage without output', async () => {
    const provider = new TraceProvider('mock', {
      tokenUsage: { input: 10, output: 20, cached: 5 },
    });

    const result = await runEvalCase({
      evalCase: {
        ...traceTestCase,
        assertions: [
          {
            name: 'token-budget',
            type: 'token-usage',
            max_total: 1000,
          },
        ],
      },
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
    });

    expect(result.trace).toBeDefined();
    expect(result.tokenUsage).toEqual({ input: 10, output: 20, cached: 5 });
    expect(result.score).toBe(1);
  });

  it('runs tool-trajectory evaluator with output', async () => {
    const output: Message[] = [
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
      { output: [{ role: 'assistant', content: 'Result' }] },
      output,
    );

    const trajectoryEvaluator = new ToolTrajectoryGrader({
      config: {
        name: 'tool-check',
        type: 'tool-trajectory',
        mode: 'any_order',
        minimums: { search: 1, analyze: 1 },
      },
    });

    const result = await runEvalCase({
      evalCase: {
        ...traceTestCase,
        assertions: [
          {
            name: 'tool-check',
            type: 'tool-trajectory',
            mode: 'any_order',
            minimums: { search: 1, analyze: 1 },
          },
        ],
      },
      provider,
      target: baseTarget,
      evaluators: {
        'llm-grader': evaluatorRegistry['llm-grader'],
        'tool-trajectory': trajectoryEvaluator,
      },
    });

    expect(result.score).toBe(1);
    expect(result.scores).toHaveLength(1);
    expect(result.scores?.[0]?.name).toBe('tool-check');
    expect(result.scores?.[0]?.verdict).toBe('pass');
  });

  it('fails tool-trajectory evaluator when no trace available', async () => {
    const provider = new TraceProvider('mock', {
      output: [{ role: 'assistant', content: 'Result' }],
    });

    const trajectoryEvaluator = new ToolTrajectoryGrader({
      config: {
        name: 'tool-check',
        type: 'tool-trajectory',
        mode: 'any_order',
        minimums: { search: 1 },
      },
    });

    const result = await runEvalCase({
      evalCase: {
        ...traceTestCase,
        assertions: [
          {
            name: 'tool-check',
            type: 'tool-trajectory',
            mode: 'any_order',
            minimums: { search: 1 },
          },
        ],
      },
      provider,
      target: baseTarget,
      evaluators: {
        'llm-grader': evaluatorRegistry['llm-grader'],
        'tool-trajectory': trajectoryEvaluator,
      },
    });

    expect(result.score).toBe(0);
    expect(result.scores?.[0]?.verdict).toBe('fail');
    expect(result.scores?.[0]?.assertions.filter((a) => !a.passed).map((a) => a.text)).toContain(
      'No trace available for evaluation',
    );
  });

  it('runs latency/cost evaluators inside composite using trace', async () => {
    const output: Message[] = [{ role: 'assistant', content: 'Done' }];

    const provider = new TraceProvider('mock', { costUsd: 0.05, durationMs: 1200 }, output);

    const result = await runEvalCase({
      evalCase: {
        ...traceTestCase,
        assertions: [
          {
            name: 'metrics',
            type: 'composite',
            assertions: [
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
    expect(result.scores).toHaveLength(1);
    expect(result.scores?.[0]?.name).toBe('metrics');
    expect(result.scores?.[0]?.verdict).toBe('pass');
    expect(result.scores?.[0]?.scores).toHaveLength(2);
    const childNames = result.scores?.[0]?.scores?.map((child) => child.name);
    expect(childNames).toEqual(['latency', 'cost']);
    const childVerdicts = result.scores?.[0]?.scores?.map((child) => child.verdict);
    expect(childVerdicts).toEqual(['pass', 'pass']);
  });

  it('computes correct trace summary with multiple tool calls', async () => {
    const output: Message[] = [
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
      { output: [{ role: 'assistant', content: 'Done' }] },
      output,
    );

    const result = await runEvalCase({
      evalCase: traceTestCase,
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
    });

    expect(result.trace).toBeDefined();
    expect(result.trace?.eventCount).toBe(4);
    expect(result.trace?.toolCalls).toEqual({ toolA: 2, toolB: 1, toolC: 1 });
    expect(result.trace?.errorCount).toBe(0);
  });

  describe('weighted evaluators', () => {
    it('computes weighted mean across multiple evaluators', async () => {
      const provider = new SequenceProvider('mock', {
        responses: [
          {
            output: [{ role: 'assistant', content: 'Candidate answer' }],
          },
        ],
      });

      const result = await runEvalCase({
        evalCase: {
          ...baseTestCase,
          assertions: [
            { name: 'eval1', type: 'llm-grader', weight: 2.0 },
            { name: 'eval2', type: 'llm-grader', weight: 1.0 },
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
      expect(result.scores).toHaveLength(2);
      expect(result.scores?.[0]?.weight).toBe(2.0);
      expect(result.scores?.[1]?.weight).toBe(1.0);
    });

    it('defaults missing weights to 1.0', async () => {
      const provider = new SequenceProvider('mock', {
        responses: [
          {
            output: [{ role: 'assistant', content: 'Candidate answer' }],
          },
        ],
      });

      const result = await runEvalCase({
        evalCase: {
          ...baseTestCase,
          assertions: [
            { name: 'eval1', type: 'llm-grader', weight: 3.0 },
            { name: 'eval2', type: 'llm-grader' }, // no weight specified
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
      expect(result.scores?.[0]?.weight).toBe(3.0);
      expect(result.scores?.[1]?.weight).toBe(1.0);
    });

    it('excludes evaluators with weight 0', async () => {
      const provider = new SequenceProvider('mock', {
        responses: [
          {
            output: [{ role: 'assistant', content: 'Candidate answer' }],
          },
        ],
      });

      const result = await runEvalCase({
        evalCase: {
          ...baseTestCase,
          assertions: [
            { name: 'eval1', type: 'llm-grader', weight: 0 },
            { name: 'eval2', type: 'llm-grader', weight: 1.0 },
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
      expect(result.scores?.[0]?.weight).toBe(0);
      expect(result.scores?.[1]?.weight).toBe(1.0);
    });

    it('returns 0 when all evaluators have weight 0', async () => {
      const provider = new SequenceProvider('mock', {
        responses: [
          {
            output: [{ role: 'assistant', content: 'Candidate answer' }],
          },
        ],
      });

      const result = await runEvalCase({
        evalCase: {
          ...baseTestCase,
          assertions: [
            { name: 'eval1', type: 'llm-grader', weight: 0 },
            { name: 'eval2', type: 'llm-grader', weight: 0 },
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
const question = (input.input || []).map((m) => String(m.content ?? '')).join('\\n');
const answer = (input.output || []).map((m) => String(m.content ?? '')).join('\\n');
const ref = (input.expected_output || []).map((m) => String(m.content ?? '')).join('\\n') || 'none';
console.log(\`Question: \${question}
Answer: \${answer}
Reference: \${ref}\`);
`,
      );

      // Custom grader that captures the prompt it receives
      let receivedQuestion = '';
      const captureGrader = {
        kind: 'llm-grader' as const,
        async evaluate(context: { evalCase: EvalTest; graderTemplateOverride?: string }) {
          // The graderTemplateOverride should contain our custom prompt
          receivedQuestion = context.graderTemplateOverride ?? '';
          return {
            score: 1.0,
            verdict: 'pass' as const,
            assertions: [{ text: 'Test passed', passed: true }],
            expectedAspectCount: 1,
          };
        },
      };

      const provider = new SequenceProvider('mock', {
        responses: [
          {
            output: [{ role: 'assistant', content: 'The answer is 4' }],
          },
        ],
      });

      const result = await runEvalCase({
        evalCase: {
          ...baseTestCase,
          question: 'What is 2+2?',
          input: [{ role: 'user', content: 'What is 2+2?' }],
          reference_answer: 'The sum is 4',
          expected_output: [{ role: 'assistant', content: 'The sum is 4' }],
          assertions: [
            {
              name: 'ts-prompt-eval',
              type: 'llm-grader',
              // Use explicit script array (matches code-grader pattern)
              resolvedPromptScript: ['bun', 'run', promptPath],
            },
          ],
        },
        provider,
        target: baseTarget,
        evaluators: { 'llm-grader': captureGrader },
      });

      expect(result.score).toBe(1.0);
      expect(receivedQuestion).toContain('Question: What is 2+2?');
      expect(receivedQuestion).toContain('Answer: The answer is 4');
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
const question = (input.input || []).map((m) => String(m.content || '')).join('\\n');
const answer = (input.output || []).map((m) => String(m.content || '')).join('\\n');
console.log('Question: ' + question + '\\nAnswer: ' + answer);
`,
      );

      let receivedPrompt = '';
      const captureGrader = {
        kind: 'llm-grader' as const,
        async evaluate(context: { graderTemplateOverride?: string }) {
          receivedPrompt = context.graderTemplateOverride ?? '';
          return {
            score: 1.0,
            verdict: 'pass' as const,
            assertions: [],
            expectedAspectCount: 1,
          };
        },
      };

      const provider = new SequenceProvider('mock', {
        responses: [
          {
            output: [{ role: 'assistant', content: 'Test response' }],
          },
        ],
      });

      const result = await runEvalCase({
        evalCase: {
          ...baseTestCase,
          question: 'Test question',
          input: [{ role: 'user', content: 'Test question' }],
          assertions: [
            {
              name: 'js-prompt-eval',
              type: 'llm-grader',
              // Use explicit script array - node for JavaScript files
              resolvedPromptScript: ['node', promptPath],
            },
          ],
        },
        provider,
        target: baseTarget,
        evaluators: { 'llm-grader': captureGrader },
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
      const captureGrader = {
        kind: 'llm-grader' as const,
        async evaluate(context: { graderTemplateOverride?: string }) {
          receivedPrompt = context.graderTemplateOverride ?? '';
          return {
            score: 1.0,
            verdict: 'pass' as const,
            assertions: [],
            expectedAspectCount: 1,
          };
        },
      };

      const provider = new SequenceProvider('mock', {
        responses: [
          {
            output: [{ role: 'assistant', content: 'Response' }],
          },
        ],
      });

      const result = await runEvalCase({
        evalCase: {
          ...baseTestCase,
          assertions: [
            {
              name: 'txt-prompt-eval',
              type: 'llm-grader',
              promptPath: promptPath,
              resolvedPromptPath: promptPath,
            },
          ],
        },
        provider,
        target: baseTarget,
        evaluators: { 'llm-grader': captureGrader },
      });

      expect(result.score).toBe(1.0);
      expect(receivedPrompt).toBe('Static prompt content from text file');
    });
  });
});

describe('runEvaluation with trials', () => {
  // Provider that returns configurable scores via alternating grader results
  class MultiCallProvider implements Provider {
    readonly id = 'multi:mock';
    readonly kind = 'mock' as const;
    readonly targetName = 'mock';
    callCount = 0;

    async invoke(): Promise<ProviderResponse> {
      this.callCount += 1;
      return {
        output: [{ role: 'assistant', content: `Response ${this.callCount}` }],
      };
    }
  }

  // Grader that returns different scores on successive calls
  function createScoringEvaluator(scores: number[]) {
    let callIndex = 0;
    return {
      'llm-grader': {
        kind: 'llm-grader' as const,
        async evaluate() {
          const score = scores[callIndex] ?? scores[scores.length - 1];
          callIndex += 1;
          return {
            score,
            verdict: (score >= 0.8 ? 'pass' : 'fail') as const,
            assertions:
              score >= 0.8
                ? [{ text: 'passed', passed: true }]
                : [{ text: 'failed', passed: false }],
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
          output: [{ role: 'assistant', content: 'response' }],
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

describe('workspace lifecycle hooks', () => {
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
          output: [{ role: 'assistant', content: [{ type: 'text', text: 'answer' }] }],
        },
      ],
    });

    const evalCase: EvalTest = {
      ...baseTestCase,
      workspace: {
        template: templateDir,
        hooks: {
          before_all: {
            command: ['node', setupScript],
            timeout_ms: 10000,
          },
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

    expect(result.beforeAllOutput).toContain('Setup done for case-1');
    expect(result.error).toBeUndefined();
    expect(result.executionStatus).toBe('ok');
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
      responses: [{ output: [{ role: 'assistant', content: [{ type: 'text', text: 'answer' }] }] }],
    });

    const evalCase: EvalTest = {
      ...baseTestCase,
      workspace: {
        template: templateDir,
        hooks: {
          before_all: {
            command: ['node', failingScript],
            timeout_ms: 5000,
          },
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

    expect(result.error).toContain('before_all script failed');
    expect(result.score).toBe(0);
    expect(result.executionStatus).toBe('execution_error');
    expect(result.failureStage).toBe('setup');
    expect(result.failureReasonCode).toBe('script_error');
    expect(result.executionError).toBeDefined();
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
          output: [{ role: 'assistant', content: [{ type: 'text', text: 'answer' }] }],
        },
      ],
    });

    const evalCase: EvalTest = {
      ...baseTestCase,
      workspace: {
        template: templateDir,
        hooks: {
          after_each: {
            command: ['node', teardownScript],
            timeout_ms: 10000,
          },
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

    expect(result.afterEachOutput).toContain('Teardown done for case-1');
    expect(result.error).toBeUndefined();
    expect(result.executionStatus).toBe('ok');
  });

  it('does not execute script for reset-only hooks', async () => {
    const { mkdtemp, writeFile, mkdir } = await import('node:fs/promises');
    testDir = await mkdtemp(path.join(tmpdir(), 'agentv-orch-ws-'));
    const templateDir = path.join(testDir, 'template');
    await mkdir(templateDir, { recursive: true });
    await writeFile(path.join(templateDir, 'hello.txt'), 'hello');

    const provider = new SequenceProvider('mock', {
      responses: [
        {
          output: [{ role: 'assistant', content: [{ type: 'text', text: 'answer' }] }],
        },
      ],
    });

    const evalCase: EvalTest = {
      ...baseTestCase,
      workspace: {
        template: templateDir,
        hooks: {
          before_each: {
            reset: 'fast',
          },
        },
      },
    };

    const result = await runEvalCase({
      evalCase,
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
      evalRunId: `test-run-reset-only-hook-${Date.now()}`,
      cleanupWorkspaces: true,
    });

    expect(result.error).toBeUndefined();
    expect(result.executionStatus).toBe('ok');
  });

  it('applies reset-only before_each hooks to a shared workspace root', async () => {
    const { mkdtemp, writeFile, mkdir, readFile, access } = await import('node:fs/promises');
    const { initializeBaseline } = await import('../../src/evaluation/workspace/file-changes.js');

    testDir = await mkdtemp(path.join(tmpdir(), 'agentv-orch-shared-reset-'));
    await mkdir(testDir, { recursive: true });
    await writeFile(path.join(testDir, 'seed.txt'), 'clean\n');
    const sharedBaselineCommit = await initializeBaseline(testDir);

    await writeFile(path.join(testDir, 'seed.txt'), 'dirty\n');
    await writeFile(path.join(testDir, 'stale.txt'), 'stale\n');

    const provider = new SequenceProvider('mock', {
      responses: [
        {
          output: [{ role: 'assistant', content: [{ type: 'text', text: 'answer' }] }],
        },
      ],
    });

    const evalCase: EvalTest = {
      ...baseTestCase,
      workspace: {
        path: testDir,
        hooks: {
          before_each: {
            reset: 'fast',
          },
        },
      },
    };

    const result = await runEvalCase({
      evalCase,
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
      evalRunId: 'test-run-shared-reset',
      cleanupWorkspaces: false,
      sharedWorkspacePath: testDir,
      sharedBaselineCommit,
    });

    expect(result.error).toBeUndefined();
    expect(result.executionStatus).toBe('ok');
    expect((await readFile(path.join(testDir, 'seed.txt'), 'utf8')).trim()).toBe('clean');
    await expect(access(path.join(testDir, 'stale.txt'))).rejects.toThrow();
  });

  it('refreshes the baseline after shared before_each scripts run', async () => {
    const { mkdtemp, writeFile, readFile } = await import('node:fs/promises');
    const { initializeBaseline } = await import('../../src/evaluation/workspace/file-changes.js');

    testDir = await mkdtemp(path.join(tmpdir(), 'agentv-orch-shared-baseline-'));
    const sharedBaselineCommit = await initializeBaseline(testDir);
    const beforeEachScript = path.join(testDir, 'before-each.js');
    writeFileSync(
      beforeEachScript,
      `const fs = require('node:fs');
const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
fs.writeFileSync(require('node:path').join(payload.workspace_path, 'setup.txt'), 'setup from hook\\n');
`,
      'utf8',
    );

    const provider: Provider = {
      id: 'writer:mock',
      kind: 'mock',
      targetName: 'mock',
      async invoke(request: ProviderRequest): Promise<ProviderResponse> {
        const cwd = request.cwd;
        if (!cwd) {
          throw new Error('cwd was not provided');
        }
        writeFileSync(path.join(cwd, 'agent.txt'), 'agent output\n');
        return {
          output: [{ role: 'assistant', content: 'done' }],
        };
      },
    };

    const evalCase: EvalTest = {
      ...baseTestCase,
      workspace: {
        path: testDir,
        hooks: {
          before_each: {
            command: [process.execPath, beforeEachScript],
          },
        },
      },
    };

    const result = await runEvalCase({
      evalCase,
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
      evalRunId: 'test-run-shared-before-each-script',
      cleanupWorkspaces: false,
      sharedWorkspacePath: testDir,
      sharedBaselineCommit,
    });

    expect(result.error).toBeUndefined();
    expect(result.executionStatus).toBe('ok');
    expect((await readFile(path.join(testDir, 'setup.txt'), 'utf8')).trim()).toBe(
      'setup from hook',
    );
    expect(result.fileChanges).toContain('agent.txt');
    expect(result.fileChanges).not.toContain('setup.txt');
  });
});

describe('deterministic assertion evaluators in orchestrator', () => {
  const assertionTestCase: EvalTest = {
    id: 'assert-1',
    suite: 'test-dataset',
    question: 'Test question',
    input: [{ role: 'user', content: 'Test question' }],
    expected_output: [],
    reference_answer: '',
    file_paths: [],
    criteria: '',
  };

  it.each([
    {
      label: 'contains pass',
      type: 'contains' as const,
      evaluator: { name: 'has-hello', type: 'contains' as const, value: 'hello world' },
      output: 'The answer is hello world today',
      expectedScore: 1,
      expectedVerdict: 'pass',
      expectedHit: 'Output contains "hello world"',
      expectedMissCount: 0,
    },
    {
      label: 'contains fail',
      type: 'contains' as const,
      evaluator: { name: 'has-hello', type: 'contains' as const, value: 'hello world' },
      output: 'The answer is goodbye',
      expectedScore: 0,
      expectedVerdict: 'fail',
      expectedMiss: 'Output does not contain "hello world"',
    },
    {
      label: 'regex pass',
      type: 'regex' as const,
      evaluator: { name: 'has-number', type: 'regex' as const, value: '\\d+' },
      output: 'The result is 42 units',
      expectedScore: 1,
      expectedVerdict: 'pass',
    },
    {
      label: 'regex fail',
      type: 'regex' as const,
      evaluator: { name: 'has-number', type: 'regex' as const, value: '^\\d+$' },
      output: 'No numbers here',
      expectedScore: 0,
      expectedVerdict: 'fail',
    },
    {
      label: 'is-json pass',
      type: 'is-json' as const,
      evaluator: { name: 'valid-json', type: 'is-json' as const },
      output: '{"key": "value"}',
      expectedScore: 1,
      expectedVerdict: 'pass',
    },
    {
      label: 'is-json fail',
      type: 'is-json' as const,
      evaluator: { name: 'valid-json', type: 'is-json' as const },
      output: 'not json at all',
      expectedScore: 0,
      expectedVerdict: 'fail',
    },
    {
      label: 'equals pass (trimmed)',
      type: 'equals' as const,
      evaluator: { name: 'exact', type: 'equals' as const, value: 'exact match' },
      output: '  exact match  ',
      expectedScore: 1,
      expectedVerdict: 'pass',
    },
    {
      label: 'equals fail',
      type: 'equals' as const,
      evaluator: { name: 'exact', type: 'equals' as const, value: 'exact match' },
      output: 'different text',
      expectedScore: 0,
      expectedVerdict: 'fail',
    },
  ])(
    '$label: $type grader scores $expectedScore',
    async ({
      evaluator,
      output,
      type,
      expectedScore,
      expectedVerdict,
      expectedHit,
      expectedMiss,
      expectedMissCount,
    }) => {
      const provider = new SequenceProvider('mock', {
        responses: [{ output: [{ role: 'assistant', content: output }] }],
      });

      const result = await runEvalCase({
        evalCase: {
          ...assertionTestCase,
          assertions: [evaluator],
        },
        provider,
        target: baseTarget,
        evaluators: evaluatorRegistry,
      });

      expect(result.score).toBe(expectedScore);
      expect(result.scores).toHaveLength(1);
      expect(result.scores?.[0].type).toBe(type);
      expect(result.scores?.[0].score).toBe(expectedScore);
      expect(result.scores?.[0].verdict).toBe(expectedVerdict);

      if (expectedHit !== undefined) {
        expect(result.assertions.filter((a) => a.passed).map((a) => a.text)).toContain(expectedHit);
      }
      if (expectedMiss !== undefined) {
        expect(result.assertions.filter((a) => !a.passed).map((a) => a.text)).toContain(
          expectedMiss,
        );
      }
      if (expectedMissCount !== undefined) {
        expect(result.assertions.filter((a) => !a.passed)).toHaveLength(expectedMissCount);
      }
    },
  );

  it('supports custom weight on assertion evaluators', async () => {
    const provider = new SequenceProvider('mock', {
      responses: [
        {
          output: [{ role: 'assistant', content: 'hello world' }],
        },
      ],
    });

    const result = await runEvalCase({
      evalCase: {
        ...assertionTestCase,
        assertions: [{ name: 'weighted', type: 'contains', value: 'hello', weight: 2.0 }],
      },
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
    });

    expect(result.score).toBe(1);
    expect(result.scores?.[0].weight).toBe(2.0);
  });

  it('combines multiple assertion evaluators with weighted average', async () => {
    const provider = new SequenceProvider('mock', {
      responses: [
        {
          output: [{ role: 'assistant', content: 'hello world' }],
        },
      ],
    });

    const result = await runEvalCase({
      evalCase: {
        ...assertionTestCase,
        assertions: [
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
    expect(result.scores).toHaveLength(2);
  });
});

describe('criteria with assert runs only declared evaluators (#452)', () => {
  const criteriaTestCase: EvalTest = {
    id: 'no-implicit-grader-1',
    suite: 'test-dataset',
    question: 'Test question',
    input: [{ role: 'user', content: 'Test question' }],
    expected_output: [],
    reference_answer: '',
    file_paths: [],
    criteria: 'Response should be polite',
  };

  it('does NOT inject implicit llm-grader when criteria is present with assert', async () => {
    const provider = new SequenceProvider('mock', {
      responses: [{ output: [{ role: 'assistant', content: 'hello world' }] }],
    });

    const targetWithGrader: ResolvedTarget = {
      ...baseTarget,
      graderTarget: 'grader-target',
    };

    const result = await runEvalCase({
      evalCase: {
        ...criteriaTestCase,
        criteria: 'Response should be polite',
        assertions: [{ name: 'has-hello', type: 'contains' as const, value: 'hello' }],
      },
      provider,
      target: targetWithGrader,
      evaluators: evaluatorRegistry,
    });

    // Only the declared contains evaluator — no implicit llm-grader
    expect(result.scores).toHaveLength(1);
    expect(result.scores?.[0].type).toBe('contains');
  });

  it('runs only declared evaluators even with criteria and graderTarget', async () => {
    const provider = new SequenceProvider('mock', {
      responses: [{ output: [{ role: 'assistant', content: 'hello world' }] }],
    });

    const targetWithGrader: ResolvedTarget = {
      ...baseTarget,
      graderTarget: 'grader-target',
    };

    const result = await runEvalCase({
      evalCase: {
        ...criteriaTestCase,
        criteria: 'Response should be polite',
        assertions: [
          { name: 'has-hello', type: 'contains' as const, value: 'hello' },
          { name: 'has-world', type: 'contains' as const, value: 'world' },
        ],
      },
      provider,
      target: targetWithGrader,
      evaluators: evaluatorRegistry,
    });

    // Only the 2 declared evaluators, no implicit grader
    expect(result.scores).toHaveLength(2);
    expect(result.scores?.[0].type).toBe('contains');
    expect(result.scores?.[1].type).toBe('contains');
    expect(result.score).toBeCloseTo(1.0);
  });

  it('criteria is available as evalCase data for evaluators that consume it', async () => {
    const provider = new SequenceProvider('mock', {
      responses: [{ output: [{ role: 'assistant', content: 'hello world' }] }],
    });

    const targetWithGrader: ResolvedTarget = {
      ...baseTarget,
      graderTarget: 'grader-target',
    };

    // When user explicitly adds llm-grader to assert, it runs and reads criteria
    const result = await runEvalCase({
      evalCase: {
        ...criteriaTestCase,
        criteria: 'Response should be polite',
        assertions: [
          { name: 'quality-check', type: 'llm-grader' as const },
          { name: 'has-hello', type: 'contains' as const, value: 'hello' },
        ],
      },
      provider,
      target: targetWithGrader,
      evaluators: evaluatorRegistry,
    });

    // Both run: explicit llm-grader + contains
    expect(result.scores).toHaveLength(2);
    expect(result.scores?.[0].type).toBe('llm-grader');
    expect(result.scores?.[1].type).toBe('contains');
  });
});

describe('required gates', () => {
  const assertionTestCase: EvalTest = {
    id: 'required-gate-1',
    suite: 'test-dataset',
    question: 'Test question',
    input: [{ role: 'user', content: 'Test question' }],
    expected_output: [],
    reference_answer: '',
    file_paths: [],
    criteria: '',
  };

  it.each([
    {
      label: 'boolean required gate triggers when required evaluator fails',
      output: 'The answer is goodbye',
      assertions: [
        {
          name: 'must-have',
          type: 'contains' as const,
          value: 'hello',
          required: true as boolean | number,
        },
        { name: 'nice-to-have', type: 'contains' as const, value: 'goodbye' },
      ],
      expectedScore: 0,
      expectedIndividualScores: [0, 1],
    },
    {
      label: 'boolean required gate passes when required evaluator passes',
      output: 'hello world',
      assertions: [
        {
          name: 'must-have',
          type: 'contains' as const,
          value: 'hello',
          required: true as boolean | number,
        },
        { name: 'nice-to-have', type: 'contains' as const, value: 'foo' },
      ],
      expectedScore: 0.5,
      expectedIndividualScores: undefined,
    },
    {
      label: 'numeric required threshold triggers gate when score is below threshold',
      output: 'The answer is goodbye',
      assertions: [
        {
          name: 'must-pass',
          type: 'contains' as const,
          value: 'hello',
          required: 0.6 as boolean | number,
        },
        { name: 'optional', type: 'contains' as const, value: 'goodbye' },
      ],
      expectedScore: 0,
      expectedIndividualScores: undefined,
    },
    {
      label: 'numeric required threshold passes when score meets threshold',
      output: 'hello world',
      assertions: [
        {
          name: 'must-pass',
          type: 'contains' as const,
          value: 'hello',
          required: 0.6 as boolean | number,
        },
        { name: 'optional', type: 'contains' as const, value: 'foo' },
      ],
      expectedScore: 0.5,
      expectedIndividualScores: undefined,
    },
  ])(
    '$label',
    async ({ output, assertions: evalEvaluators, expectedScore, expectedIndividualScores }) => {
      const provider = new SequenceProvider('mock', {
        responses: [{ output: [{ role: 'assistant', content: output }] }],
      });

      const result = await runEvalCase({
        evalCase: {
          ...assertionTestCase,
          assertions: evalEvaluators,
        },
        provider,
        target: baseTarget,
        evaluators: evaluatorRegistry,
      });

      expect(result.score).toBe(expectedScore);
      expect(result.scores).toHaveLength(evalEvaluators.length);

      if (expectedIndividualScores !== undefined) {
        for (let i = 0; i < expectedIndividualScores.length; i++) {
          expect(result.scores?.[i]?.score).toBe(expectedIndividualScores[i]);
        }
      }
    },
  );

  it('does not gate when non-required evaluator fails', async () => {
    const provider = new SequenceProvider('mock', {
      responses: [
        {
          output: [{ role: 'assistant', content: 'hello world' }],
        },
      ],
    });

    const result = await runEvalCase({
      evalCase: {
        ...assertionTestCase,
        assertions: [
          { name: 'pass-eval', type: 'contains', value: 'hello' },
          { name: 'fail-eval', type: 'contains', value: 'foo' },
        ],
      },
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
    });

    // Neither evaluator is required, so no gating. Normal average: (1 + 0) / 2 = 0.5
    expect(result.score).toBe(0.5);
    expect(result.scores).toHaveLength(2);
  });

  it('required: true uses 0.8 threshold (llm-grader score below 0.8 triggers gate)', async () => {
    // Create an grader registry where llm-grader returns 0.7 (below 0.8 threshold)
    const lowScoreEvaluatorRegistry = {
      'llm-grader': {
        kind: 'llm-grader' as const,
        async evaluate() {
          return {
            score: 0.7,
            verdict: 'fail' as const,
            assertions: [
              { text: 'partial', passed: true },
              { text: 'incomplete', passed: false },
            ],
            expectedAspectCount: 1,
          };
        },
      },
    };

    const provider = new SequenceProvider('mock', {
      responses: [
        {
          output: [{ role: 'assistant', content: 'Some response' }],
        },
      ],
    });

    const result = await runEvalCase({
      evalCase: {
        ...assertionTestCase,
        assertions: [{ name: 'quality-check', type: 'llm-grader', required: true }],
      },
      provider,
      target: baseTarget,
      evaluators: lowScoreEvaluatorRegistry,
    });

    // llm-grader returns 0.7 which is below the 0.8 default threshold for required: true
    expect(result.score).toBe(0);
  });

  it('required: true passes when score >= 0.8', async () => {
    const provider = new SequenceProvider('mock', {
      responses: [
        {
          output: [{ role: 'assistant', content: 'hello world' }],
        },
      ],
    });

    const result = await runEvalCase({
      evalCase: {
        ...assertionTestCase,
        assertions: [{ name: 'must-contain', type: 'contains', value: 'hello', required: true }],
      },
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
    });

    // contains returns 1.0 which is >= 0.8 threshold -> gate passes
    expect(result.score).toBe(1);
  });
});

describe('workspace.template .code-workspace resolution', () => {
  let testDir: string;

  afterEach(async () => {
    if (testDir) {
      const { rm } = await import('node:fs/promises');
      await rm(testDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('threads workspaceFile to provider when workspace.template is a .code-workspace file', async () => {
    const { mkdtemp, writeFile, mkdir, rm } = await import('node:fs/promises');
    testDir = await mkdtemp(path.join(tmpdir(), 'agentv-orch-ws-resolve-'));

    // Create a workspace template directory with a .code-workspace file and a source file
    const templateDir = path.join(testDir, 'template');
    await mkdir(templateDir, { recursive: true });
    const wsFile = path.join(templateDir, 'project.code-workspace');
    await writeFile(wsFile, JSON.stringify({ folders: [{ path: '.' }] }));
    await writeFile(path.join(templateDir, 'index.ts'), 'export {}');

    const provider = new CapturingProvider('mock', {
      output: [{ role: 'assistant', content: [{ type: 'text', text: 'answer' }] }],
    });

    // Point workspace.template at the .code-workspace FILE (not directory)
    const evalCase: EvalTest = {
      ...baseTestCase,
      workspace: {
        template: wsFile,
      },
    };

    const evalRunId = `test-ws-resolve-${Date.now()}`;
    const result = await runEvalCase({
      evalCase,
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
      evalRunId,
      keepWorkspaces: true,
    });

    const capturedCwd = provider.lastRequest?.cwd;
    try {
      expect(result.error).toBeUndefined();
      expect(provider.lastRequest).toBeDefined();
      // cwd should be a temp workspace directory (copied from the parent of the .code-workspace file)
      expect(capturedCwd).toBeDefined();
      expect(capturedCwd).not.toBe(templateDir);
      // The temp workspace should contain the copied files
      const cwdContents = readdirSync(capturedCwd as string);
      expect(cwdContents).toContain('index.ts');
      expect(cwdContents).toContain('project.code-workspace');
      // workspaceFile should point to the copy in the temp workspace, not the original
      expect(provider.lastRequest?.workspaceFile).toBe(
        path.join(capturedCwd as string, 'project.code-workspace'),
      );
    } finally {
      if (capturedCwd) {
        await rm(capturedCwd, { recursive: true, force: true }).catch(() => {});
      }
    }
  });

  it('threads workspaceFile when directory contains exactly 1 .code-workspace', async () => {
    const { mkdtemp, writeFile, mkdir } = await import('node:fs/promises');
    testDir = await mkdtemp(path.join(tmpdir(), 'agentv-orch-ws-resolve-'));

    const templateDir = path.join(testDir, 'template');
    await mkdir(templateDir, { recursive: true });
    await writeFile(
      path.join(templateDir, 'auto-detected.code-workspace'),
      JSON.stringify({ folders: [{ path: '.' }] }),
    );
    await writeFile(path.join(templateDir, 'main.ts'), 'console.log("hi")');

    const provider = new CapturingProvider('mock', {
      output: [{ role: 'assistant', content: [{ type: 'text', text: 'answer' }] }],
    });

    // Point workspace.template at the DIRECTORY (should auto-detect the single .code-workspace)
    const evalCase: EvalTest = {
      ...baseTestCase,
      workspace: {
        template: templateDir,
      },
    };

    const { rm } = await import('node:fs/promises');
    const result = await runEvalCase({
      evalCase,
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
      evalRunId: 'test-ws-auto-detect',
      keepWorkspaces: true,
    });

    const capturedCwd = provider.lastRequest?.cwd;
    try {
      expect(result.error).toBeUndefined();
      expect(provider.lastRequest).toBeDefined();
      expect(capturedCwd).toBeDefined();
      // Auto-detected workspaceFile should point to the copy in the temp workspace
      expect(provider.lastRequest?.workspaceFile).toBe(
        path.join(capturedCwd as string, 'auto-detected.code-workspace'),
      );
    } finally {
      if (capturedCwd) {
        await rm(capturedCwd, { recursive: true, force: true }).catch(() => {});
      }
    }
  });

  it('does not set workspaceFile when directory has no .code-workspace files', async () => {
    const { mkdtemp, writeFile, mkdir } = await import('node:fs/promises');
    testDir = await mkdtemp(path.join(tmpdir(), 'agentv-orch-ws-resolve-'));

    const templateDir = path.join(testDir, 'template');
    await mkdir(templateDir, { recursive: true });
    await writeFile(path.join(templateDir, 'README.md'), '# hello');

    const provider = new CapturingProvider('mock', {
      output: [{ role: 'assistant', content: [{ type: 'text', text: 'answer' }] }],
    });

    const evalCase: EvalTest = {
      ...baseTestCase,
      workspace: {
        template: templateDir,
      },
    };

    const { rm } = await import('node:fs/promises');
    const result = await runEvalCase({
      evalCase,
      provider,
      target: baseTarget,
      evaluators: evaluatorRegistry,
      evalRunId: 'test-ws-no-wsfile',
      keepWorkspaces: true,
    });

    const capturedCwd = provider.lastRequest?.cwd;
    try {
      expect(result.error).toBeUndefined();
      expect(provider.lastRequest).toBeDefined();
      // No .code-workspace files → workspaceFile should be undefined
      expect(provider.lastRequest?.workspaceFile).toBeUndefined();
      expect(capturedCwd).toBeDefined();
    } finally {
      if (capturedCwd) {
        await rm(capturedCwd, { recursive: true, force: true }).catch(() => {});
      }
    }
  });
});

describe('suite-level total budget guardrail', () => {
  it('completes normally when totalBudgetUsd is not set', async () => {
    const provider: Provider = {
      id: 'budget:mock',
      kind: 'mock' as const,
      targetName: 'mock',
      async invoke(): Promise<ProviderResponse> {
        return {
          output: [{ role: 'assistant', content: 'response' }],
          costUsd: 1.0,
        };
      },
    };

    const evalCases: EvalTest[] = [
      { ...baseTestCase, id: 'case-1' },
      { ...baseTestCase, id: 'case-2' },
      { ...baseTestCase, id: 'case-3' },
    ];

    const results = await runEvaluation({
      testFilePath: 'in-memory.yaml',
      repoRoot: 'in-memory',
      target: baseTarget,
      providerFactory: () => provider,
      evaluators: evaluatorRegistry,
      evalCases,
    });

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.budgetExceeded === undefined)).toBe(true);
  });

  it('completes normally when budget is not exceeded', async () => {
    const provider: Provider = {
      id: 'budget:mock',
      kind: 'mock' as const,
      targetName: 'mock',
      async invoke(): Promise<ProviderResponse> {
        return {
          output: [{ role: 'assistant', content: 'response' }],
          costUsd: 1.0,
        };
      },
    };

    const evalCases: EvalTest[] = [
      { ...baseTestCase, id: 'case-1' },
      { ...baseTestCase, id: 'case-2' },
    ];

    const results = await runEvaluation({
      testFilePath: 'in-memory.yaml',
      repoRoot: 'in-memory',
      target: baseTarget,
      providerFactory: () => provider,
      evaluators: evaluatorRegistry,
      evalCases,
      totalBudgetUsd: 10.0,
    });

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.budgetExceeded === undefined)).toBe(true);
  });

  it('stops dispatching when budget is exceeded mid-run', async () => {
    const provider: Provider = {
      id: 'budget:mock',
      kind: 'mock' as const,
      targetName: 'mock',
      async invoke(): Promise<ProviderResponse> {
        return {
          output: [{ role: 'assistant', content: 'response' }],
          costUsd: 3.0,
        };
      },
    };

    const evalCases: EvalTest[] = [
      { ...baseTestCase, id: 'case-1' },
      { ...baseTestCase, id: 'case-2' },
      { ...baseTestCase, id: 'case-3' },
      { ...baseTestCase, id: 'case-4' },
    ];

    const results = await runEvaluation({
      testFilePath: 'in-memory.yaml',
      repoRoot: 'in-memory',
      target: baseTarget,
      providerFactory: () => provider,
      evaluators: evaluatorRegistry,
      evalCases,
      totalBudgetUsd: 5.0,
      maxConcurrency: 1,
    });

    expect(results).toHaveLength(4);

    // First two should run normally ($3 + $3 = $6 >= $5)
    expect(results[0].budgetExceeded).toBeUndefined();
    expect(results[1].budgetExceeded).toBeUndefined();

    // Remaining should be budget-exceeded
    expect(results[2].budgetExceeded).toBe(true);
    expect(results[3].budgetExceeded).toBe(true);
    expect(results[2].error).toContain('Suite budget exceeded');
    expect(results[3].error).toContain('Suite budget exceeded');
    expect(results[2].score).toBe(0);
    expect(results[3].score).toBe(0);
  });

  it('works correctly with trials and budget', async () => {
    const provider: Provider = {
      id: 'budget:mock',
      kind: 'mock' as const,
      targetName: 'mock',
      async invoke(): Promise<ProviderResponse> {
        return {
          output: [{ role: 'assistant', content: 'response' }],
          costUsd: 2.0,
        };
      },
    };

    const evalCases: EvalTest[] = [
      { ...baseTestCase, id: 'case-1' },
      { ...baseTestCase, id: 'case-2' },
      { ...baseTestCase, id: 'case-3' },
      { ...baseTestCase, id: 'case-4' },
    ];

    // evaluatorRegistry always returns 0.8 (pass), so pass_at_k exits after 1 trial per case.
    // Each case costs $2. Budget of $5 is exceeded after case-3 ($6 >= $5).
    // Case-4 should be budget-exceeded.
    const results = await runEvaluation({
      testFilePath: 'in-memory.yaml',
      repoRoot: 'in-memory',
      target: baseTarget,
      providerFactory: () => provider,
      evaluators: evaluatorRegistry,
      evalCases,
      totalBudgetUsd: 5.0,
      maxConcurrency: 1,
      trials: { count: 2, strategy: 'pass_at_k' },
    });

    expect(results).toHaveLength(4);
    // First three run normally
    expect(results[0].budgetExceeded).toBeUndefined();
    expect(results[1].budgetExceeded).toBeUndefined();
    expect(results[2].budgetExceeded).toBeUndefined();
    // Fourth should be budget-exceeded
    expect(results[3].budgetExceeded).toBe(true);
    expect(results[3].error).toContain('Suite budget exceeded');
  });
});

describe('fail_on_error tolerance', () => {
  it('fail_on_error: true halts on first execution error', async () => {
    let callCount = 0;
    const errorOnFirstProvider: Provider = {
      id: 'mock:error-on-first',
      kind: 'mock' as const,
      targetName: 'error-on-first',
      async invoke(): Promise<ProviderResponse> {
        callCount++;
        if (callCount === 1) {
          throw new Error('Provider failed');
        }
        return { output: [{ role: 'assistant', content: 'ok' }] };
      },
    };

    const evalCases: EvalTest[] = [
      { ...baseTestCase, id: 'fail-case' },
      { ...baseTestCase, id: 'skip-case-1' },
      { ...baseTestCase, id: 'skip-case-2' },
    ];

    const results = await runEvaluation({
      testFilePath: 'in-memory.yaml',
      repoRoot: 'in-memory',
      target: baseTarget,
      providerFactory: () => errorOnFirstProvider,
      evaluators: evaluatorRegistry,
      evalCases,
      failOnError: true,
      maxConcurrency: 1,
    });

    expect(results).toHaveLength(3);
    // First case is execution_error from provider
    expect(results[0].executionStatus).toBe('execution_error');
    expect(results[0].failureReasonCode).toBe('provider_error');
    // Remaining cases should be halted by error_threshold_exceeded
    expect(results[1].executionStatus).toBe('execution_error');
    expect(results[1].failureReasonCode).toBe('error_threshold_exceeded');
    expect(results[2].executionStatus).toBe('execution_error');
    expect(results[2].failureReasonCode).toBe('error_threshold_exceeded');
  });

  it('fail_on_error: false never halts on errors', async () => {
    let callCount = 0;
    const alwaysErrorProvider: Provider = {
      id: 'mock:always-error',
      kind: 'mock' as const,
      targetName: 'always-error',
      async invoke(): Promise<ProviderResponse> {
        callCount++;
        throw new Error(`Provider failed call ${callCount}`);
      },
    };

    const evalCases: EvalTest[] = [
      { ...baseTestCase, id: 'err-1' },
      { ...baseTestCase, id: 'err-2' },
      { ...baseTestCase, id: 'err-3' },
    ];

    const results = await runEvaluation({
      testFilePath: 'in-memory.yaml',
      repoRoot: 'in-memory',
      target: baseTarget,
      providerFactory: () => alwaysErrorProvider,
      evaluators: evaluatorRegistry,
      evalCases,
      failOnError: false,
      maxConcurrency: 1,
    });

    expect(results).toHaveLength(3);
    // All are actual provider errors, none are halted
    for (const r of results) {
      expect(r.executionStatus).toBe('execution_error');
      expect(r.failureReasonCode).toBe('provider_error');
    }
  });
});

describe('--workspace flag', () => {
  let testDir: string;

  afterEach(async () => {
    if (testDir) {
      const { rm } = await import('node:fs/promises');
      await rm(testDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('uses user-provided workspace directory directly', async () => {
    const { mkdtemp } = await import('node:fs/promises');
    testDir = await mkdtemp(path.join(tmpdir(), 'agentv-ws-flag-'));

    const provider = new SequenceProvider('mock', {
      responses: [{ output: [{ role: 'assistant', content: [{ type: 'text', text: 'answer' }] }] }],
    });

    const results = await runEvaluation({
      testFilePath: 'in-memory.yaml',
      repoRoot: 'in-memory',
      target: baseTarget,
      providerFactory: () => provider,
      evaluators: evaluatorRegistry,
      evalCases: [baseTestCase],
      workspace: testDir,
      keepWorkspaces: true,
    });

    expect(results).toHaveLength(1);
    expect(results[0].error).toBeUndefined();
  });

  it('errors when workspace is combined with per_test isolation', async () => {
    const { mkdtemp } = await import('node:fs/promises');
    testDir = await mkdtemp(path.join(tmpdir(), 'agentv-ws-flag-'));

    const provider = new SequenceProvider('mock', {
      responses: [{ output: [{ role: 'assistant', content: [{ type: 'text', text: 'answer' }] }] }],
    });

    const evalCase: EvalTest = {
      ...baseTestCase,
      workspace: {
        isolation: 'per_test',
      },
    };

    await expect(
      runEvaluation({
        testFilePath: 'in-memory.yaml',
        repoRoot: 'in-memory',
        target: baseTarget,
        providerFactory: () => provider,
        evaluators: evaluatorRegistry,
        evalCases: [evalCase],
        workspace: testDir,
      }),
    ).rejects.toThrow('static workspace mode is incompatible with isolation: per_test');
  });

  it('never deletes user-provided workspace after run', async () => {
    const { mkdtemp, writeFile, access: fsAccess } = await import('node:fs/promises');
    testDir = await mkdtemp(path.join(tmpdir(), 'agentv-ws-flag-'));
    await writeFile(path.join(testDir, 'file.txt'), 'content');

    const provider = new SequenceProvider('mock', {
      responses: [{ output: [{ role: 'assistant', content: [{ type: 'text', text: 'answer' }] }] }],
    });

    // Even with cleanupWorkspaces=true, user workspace must survive
    await runEvaluation({
      testFilePath: 'in-memory.yaml',
      repoRoot: 'in-memory',
      target: baseTarget,
      providerFactory: () => provider,
      evaluators: evaluatorRegistry,
      evalCases: [baseTestCase],
      workspace: testDir,
      cleanupWorkspaces: true,
    });

    // Workspace should still exist
    // Workspace should still exist (access resolves without throwing)
    await fsAccess(testDir);
    await fsAccess(path.join(testDir, 'file.txt'));
  });

  it('does not delete user workspace when before_all fails', async () => {
    const { mkdtemp, writeFile, access: fsAccess } = await import('node:fs/promises');
    testDir = await mkdtemp(path.join(tmpdir(), 'agentv-ws-flag-'));
    await writeFile(path.join(testDir, 'marker.txt'), 'keep-me');

    const provider = new SequenceProvider('mock', {
      responses: [{ output: [{ role: 'assistant', content: [{ type: 'text', text: 'answer' }] }] }],
    });

    const evalCase: EvalTest = {
      ...baseTestCase,
      workspace: {
        hooks: { before_all: { command: ['false'] } },
      },
    };

    await expect(
      runEvaluation({
        testFilePath: 'in-memory.yaml',
        repoRoot: 'in-memory',
        target: baseTarget,
        providerFactory: () => provider,
        evaluators: evaluatorRegistry,
        evalCases: [evalCase],
        workspace: testDir,
      }),
    ).rejects.toThrow('before_all script failed');

    // Workspace must still exist despite the error
    // Workspace must still exist (access resolves without throwing)
    await fsAccess(testDir);
    await fsAccess(path.join(testDir, 'marker.txt'));
  });

  it('executes lifecycle hooks with user-provided workspace', async () => {
    const { mkdtemp } = await import('node:fs/promises');
    testDir = await mkdtemp(path.join(tmpdir(), 'agentv-ws-flag-'));

    const provider = new SequenceProvider('mock', {
      responses: [{ output: [{ role: 'assistant', content: [{ type: 'text', text: 'answer' }] }] }],
    });

    const evalCase: EvalTest = {
      ...baseTestCase,
      workspace: {
        hooks: {
          before_each: {
            command: [process.execPath, '-e', "process.stdout.write('setup-done')"],
          },
        },
      },
    };

    const results = await runEvaluation({
      testFilePath: 'in-memory.yaml',
      repoRoot: 'in-memory',
      target: baseTarget,
      providerFactory: () => provider,
      evaluators: evaluatorRegistry,
      evalCases: [evalCase],
      workspace: testDir,
      keepWorkspaces: true,
    });

    expect(results).toHaveLength(1);
    expect(results[0].error).toBeUndefined();
    expect(results[0].beforeEachOutput).toBeDefined();
  });

  it('creates per-test workspaces for hook-only suites when isolation is per_test', async () => {
    const { mkdtemp, mkdir, writeFile, access: fsAccess } = await import('node:fs/promises');
    testDir = await mkdtemp(path.join(tmpdir(), 'agentv-per-test-hooks-'));

    const beforeAllScript = path.join(testDir, 'before-all.js');
    writeFileSync(
      beforeAllScript,
      `const fs = require('node:fs');
const path = require('node:path');
const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
fs.mkdirSync(payload.workspace_path, { recursive: true });
fs.writeFileSync(path.join(payload.workspace_path, 'hook.txt'), payload.test_id || 'unknown');
`,
      'utf8',
    );

    const workspacesSeen: string[] = [];

    const provider: Provider = {
      id: 'mock:per-test-hooks',
      kind: 'mock',
      targetName: 'mock',
      async invoke(request: ProviderRequest): Promise<ProviderResponse> {
        if (!request.cwd) {
          throw new Error('cwd was not provided');
        }
        workspacesSeen.push(request.cwd);
        writeFileSync(path.join(request.cwd, 'agent.txt'), 'answer\n');
        return {
          output: [{ role: 'assistant', content: [{ type: 'text', text: 'answer' }] }],
        };
      },
    };

    const workspaceConfig = {
      isolation: 'per_test' as const,
      hooks: {
        before_all: {
          command: [process.execPath, beforeAllScript],
        },
      },
    };

    const evalCases: EvalTest[] = [
      {
        ...baseTestCase,
        id: 'case-a',
        workspace: workspaceConfig,
      },
      {
        ...baseTestCase,
        id: 'case-b',
        workspace: workspaceConfig,
      },
    ];

    const results = await runEvaluation({
      testFilePath: 'in-memory.yaml',
      repoRoot: 'in-memory',
      target: baseTarget,
      providerFactory: () => provider,
      evaluators: evaluatorRegistry,
      evalCases,
      keepWorkspaces: true,
      cleanupWorkspaces: false,
      retainOnSuccess: 'keep',
    });

    expect(results).toHaveLength(2);
    expect(workspacesSeen).toHaveLength(2);
    expect(workspacesSeen[0]).not.toContain(`${path.sep}shared`);
    expect(workspacesSeen[1]).not.toContain(`${path.sep}shared`);
    expect(workspacesSeen[0]).not.toBe(workspacesSeen[1]);

    await fsAccess(path.join(workspacesSeen[0], 'hook.txt'));
    await fsAccess(path.join(workspacesSeen[1], 'hook.txt'));
  });

  it('skips template copy and repo materialization when workspace provided', async () => {
    const { mkdtemp } = await import('node:fs/promises');
    testDir = await mkdtemp(path.join(tmpdir(), 'agentv-ws-flag-'));

    const provider = new SequenceProvider('mock', {
      responses: [{ output: [{ role: 'assistant', content: [{ type: 'text', text: 'answer' }] }] }],
    });

    // Workspace config with repos — should be skipped when --workspace is provided
    const evalCase: EvalTest = {
      ...baseTestCase,
      workspace: {
        repos: [
          {
            path: 'repo-a',
            source: { type: 'git', url: 'https://github.com/example/repo.git' },
            checkout: { ref: 'main' },
          },
        ],
      },
    };

    // Should succeed because repo materialization is skipped with --workspace
    const results = await runEvaluation({
      testFilePath: 'in-memory.yaml',
      repoRoot: 'in-memory',
      target: baseTarget,
      providerFactory: () => provider,
      evaluators: evaluatorRegistry,
      evalCases: [evalCase],
      workspace: testDir,
      keepWorkspaces: true,
    });

    expect(results).toHaveLength(1);
    expect(results[0].error).toBeUndefined();
  });

  it('materializes only missing repos in YAML-configured static workspace', async () => {
    const {
      mkdtemp,
      mkdir: fsMkdir,
      writeFile,
      access: fsAccess,
    } = await import('node:fs/promises');
    testDir = await mkdtemp(path.join(tmpdir(), 'agentv-ws-static-'));

    // Pre-create repo-a to simulate an existing local checkout
    const repoADir = path.join(testDir, 'repo-a');
    await fsMkdir(repoADir, { recursive: true });
    await writeFile(path.join(repoADir, 'marker.txt'), 'pre-existing');

    const provider = new SequenceProvider('mock', {
      responses: [{ output: [{ role: 'assistant', content: [{ type: 'text', text: 'answer' }] }] }],
    });

    // Use YAML workspace.path (not CLI --workspace) with type: git repos.
    // repo-a exists → should be reused. repo-b is missing but uses a fake URL → should fail clone.
    // Since repo-a is reused (skipped) and repo-b clone fails, this proves per-repo logic works.
    const evalCase: EvalTest = {
      ...baseTestCase,
      workspace: {
        mode: 'static',
        path: testDir,
        repos: [
          {
            path: 'repo-a',
            source: { type: 'git', url: 'https://github.com/example/repo-a.git' },
            checkout: { ref: 'main' },
          },
          {
            path: 'repo-b',
            source: { type: 'git', url: 'https://github.com/example/repo-b.git' },
            checkout: { ref: 'main' },
          },
        ],
      },
    };

    // repo-b clone will fail (fake URL), which proves repo-a was skipped (per-repo check)
    // and only repo-b was attempted
    await expect(
      runEvaluation({
        testFilePath: 'in-memory.yaml',
        repoRoot: 'in-memory',
        target: baseTarget,
        providerFactory: () => provider,
        evaluators: evaluatorRegistry,
        evalCases: [evalCase],
        keepWorkspaces: true,
      }),
    ).rejects.toThrow('Failed to materialize repos');

    // repo-a marker should still exist (not deleted by static workspace cleanup)
    await fsAccess(path.join(repoADir, 'marker.txt'));
  });

  it('skips all repos when all exist in YAML-configured static workspace', async () => {
    const { mkdtemp, mkdir: fsMkdir, writeFile } = await import('node:fs/promises');
    testDir = await mkdtemp(path.join(tmpdir(), 'agentv-ws-static-'));

    // Pre-create both repos
    await fsMkdir(path.join(testDir, 'repo-a'), { recursive: true });
    await writeFile(path.join(testDir, 'repo-a', 'file.txt'), 'a');
    await fsMkdir(path.join(testDir, 'repo-b'), { recursive: true });
    await writeFile(path.join(testDir, 'repo-b', 'file.txt'), 'b');

    const provider = new SequenceProvider('mock', {
      responses: [{ output: [{ role: 'assistant', content: [{ type: 'text', text: 'answer' }] }] }],
    });

    // Both repos exist → no clone attempts → should succeed without network
    const evalCase: EvalTest = {
      ...baseTestCase,
      workspace: {
        mode: 'static',
        path: testDir,
        repos: [
          {
            path: 'repo-a',
            source: { type: 'git', url: 'https://github.com/example/repo-a.git' },
            checkout: { ref: 'main' },
          },
          {
            path: 'repo-b',
            source: { type: 'git', url: 'https://github.com/example/repo-b.git' },
            checkout: { ref: 'main' },
          },
        ],
      },
    };

    const results = await runEvaluation({
      testFilePath: 'in-memory.yaml',
      repoRoot: 'in-memory',
      target: baseTarget,
      providerFactory: () => provider,
      evaluators: evaluatorRegistry,
      evalCases: [evalCase],
      keepWorkspaces: true,
    });

    expect(results).toHaveLength(1);
    expect(results[0].error).toBeUndefined();
  });

  it('falls back to temp mode when workspaceMode is static with no path and no repos', async () => {
    const provider = new SequenceProvider('mock', {
      responses: [{ output: [{ role: 'assistant', content: [{ type: 'text', text: 'answer' }] }] }],
    });

    const results = await runEvaluation({
      testFilePath: 'in-memory.yaml',
      repoRoot: 'in-memory',
      target: baseTarget,
      providerFactory: () => provider,
      evaluators: evaluatorRegistry,
      evalCases: [baseTestCase],
      workspaceMode: 'static',
    });

    expect(results).toHaveLength(1);
    expect(results[0].error).toBeUndefined();
  });

  it('errors when workspaceMode is static without workspace path but with repos', async () => {
    const provider = new SequenceProvider('mock', {
      responses: [{ output: [{ role: 'assistant', content: [{ type: 'text', text: 'answer' }] }] }],
    });

    const evalCase = {
      ...baseTestCase,
      workspace: {
        repos: [{ source: { type: 'git' as const, url: 'https://example.com/repo.git' } }],
      },
    };

    await expect(
      runEvaluation({
        testFilePath: 'in-memory.yaml',
        repoRoot: 'in-memory',
        target: baseTarget,
        providerFactory: () => provider,
        evaluators: evaluatorRegistry,
        evalCases: [evalCase],
        workspaceMode: 'static',
      }),
    ).rejects.toThrow('workspace.mode=static requires workspace.path or --workspace-path');
  });

  it('errors when workspace path is combined with non-static workspaceMode', async () => {
    const { mkdtemp } = await import('node:fs/promises');
    testDir = await mkdtemp(path.join(tmpdir(), 'agentv-ws-flag-'));
    const provider = new SequenceProvider('mock', {
      responses: [{ output: [{ role: 'assistant', content: [{ type: 'text', text: 'answer' }] }] }],
    });

    await expect(
      runEvaluation({
        testFilePath: 'in-memory.yaml',
        repoRoot: 'in-memory',
        target: baseTarget,
        providerFactory: () => provider,
        evaluators: evaluatorRegistry,
        evalCases: [baseTestCase],
        workspacePath: testDir,
        workspaceMode: 'temp',
      }),
    ).rejects.toThrow('--workspace-path requires --workspace-mode static when both are provided');
  });

  it('includes per-grader timing in scores', async () => {
    const provider = new SequenceProvider('mock', {
      responses: [
        {
          output: [{ role: 'assistant', content: 'Structured logging added.' }],
        },
      ],
    });

    // Use a slow evaluator to ensure measurable duration
    const slowEvaluatorRegistry = {
      'llm-grader': {
        kind: 'llm-grader',
        async evaluate() {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return {
            score: 0.9,
            verdict: 'pass' as const,
            assertions: [{ text: 'good', passed: true }],
            expectedAspectCount: 1,
          };
        },
      },
    };

    const beforeTest = new Date();
    const result = await runEvalCase({
      evalCase: {
        ...baseTestCase,
        assertions: [{ name: 'quality', type: 'llm-grader' }],
      },
      provider,
      target: baseTarget,
      evaluators: slowEvaluatorRegistry,
    });
    const afterTest = new Date();

    expect(result.scores).toHaveLength(1);
    const graderScore = result.scores?.[0];

    // durationMs should be present and reflect real wall-clock time
    expect(graderScore?.durationMs).toBeGreaterThanOrEqual(50);

    // startedAt and endedAt should be valid ISO 8601 UTC strings
    expect(graderScore?.startedAt).toBeDefined();
    expect(graderScore?.endedAt).toBeDefined();
    const started = new Date(graderScore?.startedAt ?? '');
    const ended = new Date(graderScore?.endedAt ?? '');
    expect(started.getTime()).toBeGreaterThanOrEqual(beforeTest.getTime());
    expect(ended.getTime()).toBeLessThanOrEqual(afterTest.getTime());
    expect(ended.getTime()).toBeGreaterThanOrEqual(started.getTime());

    // durationMs should match the difference between startedAt and endedAt
    expect(graderScore?.durationMs).toBe(ended.getTime() - started.getTime());
  });

  it('includes per-grader timing even when evaluator fails', async () => {
    const provider = new SequenceProvider('mock', {
      responses: [
        {
          output: [{ role: 'assistant', content: 'Some response.' }],
        },
      ],
    });

    const failingEvaluatorRegistry = {
      'llm-grader': {
        kind: 'llm-grader',
        async evaluate() {
          await new Promise((resolve) => setTimeout(resolve, 20));
          throw new Error('Grader crashed');
        },
      },
    };

    const result = await runEvalCase({
      evalCase: {
        ...baseTestCase,
        assertions: [{ name: 'broken', type: 'llm-grader' }],
      },
      provider,
      target: baseTarget,
      evaluators: failingEvaluatorRegistry,
    });

    expect(result.scores).toHaveLength(1);
    const graderScore = result.scores?.[0];

    // Timing should still be present even on failure
    expect(graderScore?.durationMs).toBeGreaterThanOrEqual(20);
    expect(graderScore?.startedAt).toBeDefined();
    expect(graderScore?.endedAt).toBeDefined();
  });
});
