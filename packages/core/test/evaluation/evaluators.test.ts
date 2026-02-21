import { describe, expect, it } from 'bun:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CodeEvaluator,
  CostEvaluator,
  FieldAccuracyEvaluator,
  LatencyEvaluator,
  LlmJudgeEvaluator,
  TokenUsageEvaluator,
} from '../../src/evaluation/evaluators.js';
import type { ResolvedTarget } from '../../src/evaluation/providers/targets.js';
import type {
  Provider,
  ProviderRequest,
  ProviderResponse,
} from '../../src/evaluation/providers/types.js';
import type { EvalTest } from '../../src/evaluation/types.js';

/** Helper to create a ProviderResponse with text wrapped in output */
function textResponse(text: string): ProviderResponse {
  return {
    output: [{ role: 'assistant', content: text }],
  };
}

class StubProvider implements Provider {
  readonly id = 'stub';
  readonly kind = 'mock' as const;
  readonly targetName = 'stub';

  constructor(private readonly response: ProviderResponse) {}

  async invoke(): Promise<ProviderResponse> {
    return this.response;
  }
}

class CapturingProvider implements Provider {
  readonly id = 'capturing';
  readonly kind = 'mock' as const;
  readonly targetName = 'capturing';
  lastRequest?: ProviderRequest;

  constructor(private readonly response: ProviderResponse) {}

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    this.lastRequest = request;
    return this.response;
  }
}

const baseTestCase: EvalTest = {
  id: 'case-1',
  dataset: 'test-dataset',
  question: 'Improve the logging implementation',
  input: [{ role: 'user', content: 'Please add logging' }],
  input_segments: [{ type: 'text', value: 'Please add logging' }],
  expected_output: [],
  reference_answer: '- add structured logging\n- avoid global state',
  guideline_paths: [],
  file_paths: [],
  criteria: 'Logging improvements applied',
  evaluator: 'llm_judge',
};

const baseTarget: ResolvedTarget = {
  kind: 'mock',
  name: 'mock',
  config: { response: '{}' },
};

describe('LlmJudgeEvaluator', () => {
  it('parses JSON response and returns evaluation score', async () => {
    const judgeProvider = new StubProvider({
      output: [
        {
          role: 'assistant',
          content: JSON.stringify({
            score: 0.8,
            hits: ['Captured logging requirement'],
            misses: ['Did not mention tests'],
            reasoning: 'Solid coverage with minor omissions',
          }),
        },
      ],
    });

    const evaluator = new LlmJudgeEvaluator({
      resolveJudgeProvider: async () => judgeProvider,
    });

    const result = await evaluator.evaluate({
      evalCase: { ...baseTestCase, evaluator: 'llm_judge' },
      candidate: 'Answer',
      target: baseTarget,
      provider: judgeProvider,
      attempt: 0,
      promptInputs: { question: '', guidelines: '' },
      now: new Date(),
    });

    expect(result.score).toBeCloseTo(0.8);
    expect(result.verdict).toBe('pass');
    expect(result.hits).toContain('Captured logging requirement');
    expect(result.misses).toContain('Did not mention tests');
    expect(result.reasoning).toBe('Solid coverage with minor omissions');
    expect(result.evaluatorRawRequest).toBeDefined();
  });

  it('parses JSON from markdown code block', async () => {
    const judgeProvider = new StubProvider({
      output: [
        {
          role: 'assistant',
          content: `Here is the evaluation:\n\n\`\`\`json\n${JSON.stringify({
            score: 0.75,
            hits: ['Clear structure', 'Good examples'],
            misses: ['Missing edge cases'],
            reasoning: 'Well done overall.',
          })}\n\`\`\``,
        },
      ],
    });

    const evaluator = new LlmJudgeEvaluator({
      resolveJudgeProvider: async () => judgeProvider,
    });

    const result = await evaluator.evaluate({
      evalCase: { ...baseTestCase, evaluator: 'llm_judge' },
      candidate: 'Answer',
      target: baseTarget,
      provider: judgeProvider,
      attempt: 0,
      promptInputs: { question: '', guidelines: '' },
      now: new Date(),
    });

    expect(result.score).toBeCloseTo(0.75);
    expect(result.verdict).toBe('borderline');
    expect(result.hits).toHaveLength(2);
    expect(result.misses).toHaveLength(1);
  });

  it('validates score is in range [0.0, 1.0]', async () => {
    const judgeProvider = new StubProvider({
      output: [
        {
          role: 'assistant',
          content: JSON.stringify({
            score: 1.5, // Invalid: out of range
            hits: ['Good'],
            misses: [],
            reasoning: 'Too high',
          }),
        },
      ],
    });

    const evaluator = new LlmJudgeEvaluator({
      resolveJudgeProvider: async () => judgeProvider,
    });

    const result = await evaluator.evaluate({
      evalCase: { ...baseTestCase, evaluator: 'llm_judge' },
      candidate: 'Answer',
      target: baseTarget,
      provider: judgeProvider,
      attempt: 0,
      promptInputs: { question: '', guidelines: '' },
      now: new Date(),
    });

    // Should fall back to defaults when validation fails
    expect(result.score).toBe(0);
    expect(result.verdict).toBe('fail');
    expect(result.hits).toHaveLength(0);
    expect(result.misses).toHaveLength(0);
  });

  it('enforces max 4 entries for hits and misses', async () => {
    const judgeProvider = new StubProvider({
      output: [
        {
          role: 'assistant',
          content: JSON.stringify({
            score: 0.9,
            hits: ['Item 1', 'Item 2', 'Item 3', 'Item 4', 'Item 5', 'Item 6'],
            misses: ['Miss 1', 'Miss 2', 'Miss 3', 'Miss 4', 'Miss 5'],
            reasoning: 'Too many items',
          }),
        },
      ],
    });

    const evaluator = new LlmJudgeEvaluator({
      resolveJudgeProvider: async () => judgeProvider,
    });

    const result = await evaluator.evaluate({
      evalCase: { ...baseTestCase, evaluator: 'llm_judge' },
      candidate: 'Answer',
      target: baseTarget,
      provider: judgeProvider,
      attempt: 0,
      promptInputs: { question: '', guidelines: '' },
      now: new Date(),
    });

    expect(result.score).toBeCloseTo(0.9);
    expect(result.verdict).toBe('pass');
    expect(result.hits).toHaveLength(4); // Truncated to max 4
    expect(result.misses).toHaveLength(4); // Truncated to max 4
  });

  it('uses a custom system prompt when provided', async () => {
    const customPrompt = 'Custom grading system prompt';

    class CapturingProvider implements Provider {
      readonly id = 'capturing';
      readonly kind = 'mock' as const;
      readonly targetName = 'capturing';
      lastRequest?: ProviderRequest;

      constructor(private readonly response: ProviderResponse) {}

      async invoke(request: ProviderRequest): Promise<ProviderResponse> {
        this.lastRequest = request;
        return this.response;
      }
    }

    const judgeProvider = new CapturingProvider({
      output: [
        {
          role: 'assistant',
          content: JSON.stringify({
            score: 0.7,
            hits: ['Used custom prompt'],
            misses: [],
          }),
        },
      ],
    });

    const evaluator = new LlmJudgeEvaluator({
      resolveJudgeProvider: async () => judgeProvider,
      evaluatorTemplate: customPrompt,
    });

    const result = await evaluator.evaluate({
      evalCase: { ...baseTestCase, evaluator: 'llm_judge' },
      candidate: 'Answer',
      target: baseTarget,
      provider: judgeProvider,
      attempt: 0,
      promptInputs: { question: '', guidelines: '' },
      now: new Date(),
    });

    expect(result.score).toBeCloseTo(0.7);
    expect(result.verdict).toBe('borderline');

    // Custom template goes in user prompt (question), system prompt only has output schema
    expect(judgeProvider.lastRequest?.question).toContain(customPrompt);
    expect(judgeProvider.lastRequest?.systemPrompt).toContain(
      'You must respond with a single JSON object',
    );
    expect(judgeProvider.lastRequest?.systemPrompt).not.toContain(customPrompt);

    expect(result.evaluatorRawRequest?.userPrompt).toContain(customPrompt);
    expect(result.evaluatorRawRequest?.systemPrompt).toContain(
      'You must respond with a single JSON object',
    );
    expect(result.evaluatorRawRequest?.systemPrompt).not.toContain(customPrompt);
  });

  it('rejects JSON with invalid hits/misses types', async () => {
    const judgeProvider = new StubProvider({
      output: [
        {
          role: 'assistant',
          content: JSON.stringify({
            score: 0.8,
            hits: 'Not an array', // Invalid type
            misses: [],
            reasoning: 'Invalid hits',
          }),
        },
      ],
    });

    const evaluator = new LlmJudgeEvaluator({
      resolveJudgeProvider: async () => judgeProvider,
    });

    const result = await evaluator.evaluate({
      evalCase: { ...baseTestCase, evaluator: 'llm_judge' },
      candidate: 'Answer',
      target: baseTarget,
      provider: judgeProvider,
      attempt: 0,
      promptInputs: { question: '', guidelines: '' },
      now: new Date(),
    });

    // Should fall back to defaults when validation fails
    expect(result.score).toBe(0);
    expect(result.verdict).toBe('fail');
    expect(result.hits).toHaveLength(0);
    expect(result.misses).toHaveLength(0);
  });

  it('tolerates non-JSON output by falling back to defaults', async () => {
    const judgeProvider = new StubProvider(textResponse('Final score: 0.5'));
    const evaluator = new LlmJudgeEvaluator({
      resolveJudgeProvider: async () => judgeProvider,
    });

    const result = await evaluator.evaluate({
      evalCase: { ...baseTestCase, evaluator: 'llm_judge' },
      candidate: 'Answer',
      target: baseTarget,
      provider: judgeProvider,
      attempt: 0,
      promptInputs: { question: '', guidelines: '' },
      now: new Date(),
    });

    expect(result.score).toBe(0);
    expect(result.verdict).toBe('fail');
    expect(result.hits).toHaveLength(0);
    expect(result.misses).toHaveLength(0);
  });

  it('supports rubric mode when rubrics are provided in config', async () => {
    const judgeProvider = new StubProvider({
      output: [
        {
          role: 'assistant',
          content: JSON.stringify({
            checks: [
              { id: 'r1', satisfied: true, reasoning: 'Present' },
              { id: 'r2', satisfied: false, reasoning: 'Missing' },
            ],
            overall_reasoning: 'Mixed compliance.',
          }),
        },
      ],
    });

    const evaluator = new LlmJudgeEvaluator({
      resolveJudgeProvider: async () => judgeProvider,
    });

    const result = await evaluator.evaluate({
      evalCase: { ...baseTestCase, evaluator: 'llm_judge' },
      candidate: 'Answer',
      target: baseTarget,
      provider: judgeProvider,
      attempt: 0,
      promptInputs: { question: '', guidelines: '' },
      now: new Date(),
      evaluator: {
        name: 'rubric',
        type: 'llm_judge',
        rubrics: [
          { id: 'r1', outcome: 'Mentions logging', weight: 1.0, required: true },
          { id: 'r2', outcome: 'Mentions tests', weight: 1.0, required: false },
        ],
      },
    });

    expect(result.score).toBeCloseTo(0.5);
    expect(result.verdict).toBe('fail');
    expect(result.hits.join('\n')).toContain('[r1]');
    expect(result.misses.join('\n')).toContain('[r2]');
    expect(result.reasoning).toBe('Mixed compliance.');
  });

  it('passes multi-turn role markers through to evaluator prompts', async () => {
    const judgeProvider = new CapturingProvider({
      output: [
        { role: 'assistant', content: JSON.stringify({ score: 0.65, hits: [], misses: [] }) },
      ],
    });
    const evaluator = new LlmJudgeEvaluator({
      resolveJudgeProvider: async () => judgeProvider,
    });

    const multiTurnQuestion =
      '@[System]:\nFollow the coding guidelines.\n\n@[User]:\nDebug the failing test.\n\n@[Assistant]:\nPlease share the stack trace.';

    const result = await evaluator.evaluate({
      evalCase: { ...baseTestCase, evaluator: 'llm_judge' },
      candidate: 'Candidate answer',
      target: baseTarget,
      provider: judgeProvider,
      attempt: 0,
      promptInputs: { question: multiTurnQuestion, guidelines: '' },
      now: new Date(),
    });

    expect(judgeProvider.lastRequest?.question).toContain(multiTurnQuestion);
    expect(result.evaluatorRawRequest?.userPrompt).toContain('@[Assistant]:');
    expect(result.evaluatorRawRequest?.userPrompt).toContain('@[System]:');
  });

  it('keeps single-turn prompts flat when no markers are needed', async () => {
    const judgeProvider = new CapturingProvider({
      output: [
        { role: 'assistant', content: JSON.stringify({ score: 0.8, hits: [], misses: [] }) },
      ],
    });
    const evaluator = new LlmJudgeEvaluator({
      resolveJudgeProvider: async () => judgeProvider,
    });

    const flatQuestion = 'Summarize the architecture in two sentences.';

    const result = await evaluator.evaluate({
      evalCase: { ...baseTestCase, evaluator: 'llm_judge' },
      candidate: 'Candidate answer',
      target: baseTarget,
      provider: judgeProvider,
      attempt: 0,
      promptInputs: { question: flatQuestion, guidelines: '' },
      now: new Date(),
    });

    expect(judgeProvider.lastRequest?.question).toContain(flatQuestion);
    expect(judgeProvider.lastRequest?.question).not.toContain('@[User]:');
    expect(result.evaluatorRawRequest?.userPrompt).toContain(flatQuestion);
    expect(result.evaluatorRawRequest?.userPrompt).not.toContain('@[User]:');
  });
});

describe('CodeEvaluator', () => {
  it('passes required fields to code_judge scripts', async () => {
    const judgeProvider = new StubProvider(textResponse('{}'));

    const evalCaseWithExpectedMessages: EvalTest = {
      ...baseTestCase,
      expected_output: [{ role: 'assistant', content: { decision: 'ACCEPT' } }],
    };

    const expectedCandidate = '{"decision":"ACCEPT"}';

    // Use external script file for cross-platform compatibility
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const script = ['node', join(__dirname, '../fixtures/test-judge.cjs')];

    const evaluator = new CodeEvaluator({ script });

    const result = await evaluator.evaluate({
      evalCase: evalCaseWithExpectedMessages,
      candidate: expectedCandidate,
      target: baseTarget,
      provider: judgeProvider,
      attempt: 0,
      promptInputs: { question: '', guidelines: '' },
      now: new Date(),
    });

    expect(result.score).toBe(1);
    expect(result.verdict).toBe('pass');
    expect(result.hits).toContain('expected_output present');
    expect(result.hits).toContain('candidate_answer present');
    expect(result.hits).toContain('candidate_answer parses');
  });

  it('surfaces stderr and exit code on failure', async () => {
    const judgeProvider = new StubProvider(textResponse('{}'));

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const script = ['node', join(__dirname, '../fixtures/test-judge-error.cjs')];

    const evaluator = new CodeEvaluator({ script });

    const result = await evaluator.evaluate({
      evalCase: baseTestCase,
      candidate: 'Candidate answer',
      target: baseTarget,
      provider: judgeProvider,
      attempt: 0,
      promptInputs: { question: '', guidelines: '' },
      now: new Date(),
    });

    expect(result.verdict).toBe('fail');
    expect(result.misses[0]).toContain('exited with code');
    expect(result.misses[0]).toContain('test-error');
  });

  it('works with defineCodeJudge-based code judge', async () => {
    const judgeProvider = new StubProvider(textResponse('Logging improvements applied'));

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const script = ['bun', 'run', join(__dirname, '../fixtures/test-define-judge.ts')];

    const evaluator = new CodeEvaluator({ script });

    const result = await evaluator.evaluate({
      evalCase: baseTestCase,
      candidate: 'Added logging to the implementation',
      target: baseTarget,
      provider: judgeProvider,
      attempt: 0,
      promptInputs: { question: '', guidelines: '' },
      now: new Date(),
    });

    expect(result.score).toBe(1);
    expect(result.verdict).toBe('pass');
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.reasoning).toContain('matching keywords');
  });

  it('captures optional details from code judge output', async () => {
    const judgeProvider = new StubProvider(textResponse('{}'));

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const script = ['node', join(__dirname, '../fixtures/test-judge-with-details.cjs')];

    const evaluator = new CodeEvaluator({ script });

    const result = await evaluator.evaluate({
      evalCase: {
        ...baseTestCase,
        expected_output: [{ role: 'assistant', content: 'test' }],
      },
      candidate: 'Test candidate',
      target: baseTarget,
      provider: judgeProvider,
      attempt: 0,
      promptInputs: { question: '', guidelines: '' },
      now: new Date(),
    });

    expect(result.score).toBeCloseTo(0.75);
    expect(result.reasoning).toBe('Testing details passthrough');
    expect(result.details).toBeDefined();
    expect(result.details?.metrics).toEqual({ tp: 5, tn: 2, fp: 1, fn: 2 });
    expect(result.details?.alignment).toHaveLength(2);
    expect(result.details?.precision).toBeCloseTo(0.833);
    expect(result.details?.recall).toBeCloseTo(0.714);
    expect(result.details?.f1).toBeCloseTo(0.769);
  });

  it('passes workspace_path to code judge via payload and env var', async () => {
    const judgeProvider = new StubProvider(textResponse('{}'));

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const script = ['node', join(__dirname, '../fixtures/test-judge-workspace.cjs')];

    const evaluator = new CodeEvaluator({ script });

    const result = await evaluator.evaluate({
      evalCase: baseTestCase,
      candidate: 'Test candidate',
      target: baseTarget,
      provider: judgeProvider,
      attempt: 0,
      promptInputs: { question: '', guidelines: '' },
      now: new Date(),
      workspacePath: '/tmp/test-workspace',
    });

    expect(result.score).toBe(1);
    expect(result.verdict).toBe('pass');
    expect(result.hits).toContain('workspace_path present in payload');
    expect(result.hits).toContain('AGENTV_WORKSPACE_PATH env var set');
    expect(result.hits).toContain('payload and env var match');
  });

  it('omits details when not returned by code judge', async () => {
    const judgeProvider = new StubProvider(textResponse('{}'));

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const script = ['node', join(__dirname, '../fixtures/test-judge.cjs')];

    const evaluator = new CodeEvaluator({ script });

    const result = await evaluator.evaluate({
      evalCase: {
        ...baseTestCase,
        expected_output: [{ role: 'assistant', content: { decision: 'ACCEPT' } }],
      },
      candidate: '{"decision":"ACCEPT"}',
      target: baseTarget,
      provider: judgeProvider,
      attempt: 0,
      promptInputs: { question: '', guidelines: '' },
      now: new Date(),
    });

    expect(result.score).toBe(1);
    expect(result.details).toBeUndefined();
  });
});

describe('FieldAccuracyEvaluator', () => {
  const baseTestCaseWithExpected: EvalTest = {
    ...baseTestCase,
    expected_output: [
      {
        role: 'assistant',
        content: {
          invoice_number: 'INV-001',
          amount: 1500,
          date: '15-JAN-2025',
          vendor: { name: 'Acme Shipping', address: '123 Main St' },
        },
      },
    ],
  };

  const judgeProvider = new StubProvider(textResponse('{}'));

  it('evaluates exact match fields correctly', () => {
    const evaluator = new FieldAccuracyEvaluator({
      config: {
        name: 'test',
        type: 'field_accuracy',
        fields: [
          { path: 'invoice_number', match: 'exact', required: true, weight: 1.0 },
          { path: 'amount', match: 'exact', required: true, weight: 1.0 },
        ],
      },
    });

    const result = evaluator.evaluate({
      evalCase: baseTestCaseWithExpected,
      candidate: JSON.stringify({ invoice_number: 'INV-001', amount: 1500 }),
      target: baseTarget,
      provider: judgeProvider,
      attempt: 0,
      promptInputs: { question: '', guidelines: '' },
      now: new Date(),
    });

    expect(result.score).toBe(1.0);
    expect(result.verdict).toBe('pass');
    expect(result.hits).toHaveLength(2);
    expect(result.misses).toHaveLength(0);
  });

  it('handles missing required fields', () => {
    const evaluator = new FieldAccuracyEvaluator({
      config: {
        name: 'test',
        type: 'field_accuracy',
        fields: [
          { path: 'invoice_number', match: 'exact', required: true, weight: 1.0 },
          { path: 'amount', match: 'exact', required: true, weight: 1.0 },
        ],
      },
    });

    const result = evaluator.evaluate({
      evalCase: baseTestCaseWithExpected,
      candidate: JSON.stringify({ invoice_number: 'INV-001' }), // Missing amount
      target: baseTarget,
      provider: judgeProvider,
      attempt: 0,
      promptInputs: { question: '', guidelines: '' },
      now: new Date(),
    });

    expect(result.score).toBe(0.5);
    expect(result.verdict).toBe('fail');
    expect(result.hits).toHaveLength(1);
    expect(result.misses).toHaveLength(1);
    expect(result.misses[0]).toContain('amount');
    expect(result.misses[0]).toContain('required');
  });

  it('applies numeric tolerance matching', () => {
    const evaluator = new FieldAccuracyEvaluator({
      config: {
        name: 'test',
        type: 'field_accuracy',
        fields: [
          {
            path: 'amount',
            match: 'numeric_tolerance',
            tolerance: 1.0,
            relative: false,
            required: true,
            weight: 1.0,
          },
        ],
      },
    });

    // 1500.5 vs 1500 - within tolerance of 1.0
    const result = evaluator.evaluate({
      evalCase: baseTestCaseWithExpected,
      candidate: JSON.stringify({ amount: 1500.5 }),
      target: baseTarget,
      provider: judgeProvider,
      attempt: 0,
      promptInputs: { question: '', guidelines: '' },
      now: new Date(),
    });

    expect(result.score).toBe(1.0);
    expect(result.verdict).toBe('pass');
  });

  it('fails numeric tolerance when outside range', () => {
    const evaluator = new FieldAccuracyEvaluator({
      config: {
        name: 'test',
        type: 'field_accuracy',
        fields: [
          {
            path: 'amount',
            match: 'numeric_tolerance',
            tolerance: 1.0,
            relative: false,
            required: true,
            weight: 1.0,
          },
        ],
      },
    });

    // 1502 vs 1500 - outside tolerance of 1.0
    const result = evaluator.evaluate({
      evalCase: baseTestCaseWithExpected,
      candidate: JSON.stringify({ amount: 1502 }),
      target: baseTarget,
      provider: judgeProvider,
      attempt: 0,
      promptInputs: { question: '', guidelines: '' },
      now: new Date(),
    });

    expect(result.score).toBe(0);
    expect(result.verdict).toBe('fail');
    expect(result.misses[0]).toContain('outside tolerance');
  });

  it('applies date matching with format normalization', () => {
    const evaluator = new FieldAccuracyEvaluator({
      config: {
        name: 'test',
        type: 'field_accuracy',
        fields: [
          {
            path: 'date',
            match: 'date',
            formats: ['DD-MMM-YYYY', 'YYYY-MM-DD'],
            required: true,
            weight: 1.0,
          },
        ],
      },
    });

    // "2025-01-15" vs "15-JAN-2025" - same date, different formats
    const result = evaluator.evaluate({
      evalCase: baseTestCaseWithExpected,
      candidate: JSON.stringify({ date: '2025-01-15' }),
      target: baseTarget,
      provider: judgeProvider,
      attempt: 0,
      promptInputs: { question: '', guidelines: '' },
      now: new Date(),
    });

    expect(result.score).toBe(1.0);
    expect(result.verdict).toBe('pass');
  });

  it('respects weighted averaging', () => {
    const evaluator = new FieldAccuracyEvaluator({
      config: {
        name: 'test',
        type: 'field_accuracy',
        fields: [
          { path: 'invoice_number', match: 'exact', required: true, weight: 2.0 }, // 2x weight
          { path: 'amount', match: 'exact', required: true, weight: 1.0 },
        ],
        aggregation: 'weighted_average',
      },
    });

    // Correct invoice_number (weight 2), wrong amount (weight 1)
    const result = evaluator.evaluate({
      evalCase: baseTestCaseWithExpected,
      candidate: JSON.stringify({ invoice_number: 'INV-001', amount: 9999 }),
      target: baseTarget,
      provider: judgeProvider,
      attempt: 0,
      promptInputs: { question: '', guidelines: '' },
      now: new Date(),
    });

    // Score should be (1.0 * 2.0 + 0.0 * 1.0) / (2.0 + 1.0) = 2/3 ≈ 0.667
    expect(result.score).toBeCloseTo(0.667, 2);
    expect(result.verdict).toBe('borderline');
  });

  it('supports all_or_nothing aggregation', () => {
    const evaluator = new FieldAccuracyEvaluator({
      config: {
        name: 'test',
        type: 'field_accuracy',
        fields: [
          { path: 'invoice_number', match: 'exact', required: true, weight: 1.0 },
          { path: 'amount', match: 'exact', required: true, weight: 1.0 },
        ],
        aggregation: 'all_or_nothing',
      },
    });

    // Correct invoice_number, wrong amount - should fail completely
    const result = evaluator.evaluate({
      evalCase: baseTestCaseWithExpected,
      candidate: JSON.stringify({ invoice_number: 'INV-001', amount: 9999 }),
      target: baseTarget,
      provider: judgeProvider,
      attempt: 0,
      promptInputs: { question: '', guidelines: '' },
      now: new Date(),
    });

    expect(result.score).toBe(0);
    expect(result.verdict).toBe('fail');
  });

  it('handles nested field paths', () => {
    const evaluator = new FieldAccuracyEvaluator({
      config: {
        name: 'test',
        type: 'field_accuracy',
        fields: [
          { path: 'vendor.name', match: 'exact', required: true, weight: 1.0 },
          { path: 'vendor.address', match: 'exact', required: true, weight: 1.0 },
        ],
      },
    });

    const result = evaluator.evaluate({
      evalCase: baseTestCaseWithExpected,
      candidate: JSON.stringify({ vendor: { name: 'Acme Shipping', address: '123 Main St' } }),
      target: baseTarget,
      provider: judgeProvider,
      attempt: 0,
      promptInputs: { question: '', guidelines: '' },
      now: new Date(),
    });

    expect(result.score).toBe(1.0);
    expect(result.verdict).toBe('pass');
  });

  it('handles array index paths', () => {
    const evalCaseWithArray: EvalTest = {
      ...baseTestCase,
      expected_output: [
        {
          role: 'assistant',
          content: {
            items: [
              { name: 'Item A', price: 100 },
              { name: 'Item B', price: 200 },
            ],
          },
        },
      ],
    };

    const evaluator = new FieldAccuracyEvaluator({
      config: {
        name: 'test',
        type: 'field_accuracy',
        fields: [
          { path: 'items[0].name', match: 'exact', required: true, weight: 1.0 },
          { path: 'items[1].price', match: 'exact', required: true, weight: 1.0 },
        ],
      },
    });

    const result = evaluator.evaluate({
      evalCase: evalCaseWithArray,
      candidate: JSON.stringify({
        items: [
          { name: 'Item A', price: 100 },
          { name: 'Item B', price: 200 },
        ],
      }),
      target: baseTarget,
      provider: judgeProvider,
      attempt: 0,
      promptInputs: { question: '', guidelines: '' },
      now: new Date(),
    });

    expect(result.score).toBe(1.0);
    expect(result.verdict).toBe('pass');
  });

  it('returns failure for invalid JSON candidate', () => {
    const evaluator = new FieldAccuracyEvaluator({
      config: {
        name: 'test',
        type: 'field_accuracy',
        fields: [{ path: 'invoice_number', match: 'exact', required: true, weight: 1.0 }],
      },
    });

    const result = evaluator.evaluate({
      evalCase: baseTestCaseWithExpected,
      candidate: 'This is not valid JSON',
      target: baseTarget,
      provider: judgeProvider,
      attempt: 0,
      promptInputs: { question: '', guidelines: '' },
      now: new Date(),
    });

    expect(result.score).toBe(0);
    expect(result.verdict).toBe('fail');
    expect(result.misses[0]).toContain('parse');
  });
});

describe('LatencyEvaluator', () => {
  it('passes when duration is under threshold', () => {
    const evaluator = new LatencyEvaluator({
      config: {
        name: 'latency_check',
        type: 'latency',
        threshold: 2000,
      },
    });

    const result = evaluator.evaluate({
      evalCase: baseTestCase,
      candidate: 'Answer',
      target: baseTarget,
      provider: new StubProvider(textResponse('ok')),
      attempt: 0,
      promptInputs: { question: '', guidelines: '' },
      now: new Date(),
      trace: {
        eventCount: 1,
        toolNames: [],
        toolCallsByName: {},
        errorCount: 0,
        durationMs: 1500,
      },
    });

    expect(result.score).toBe(1);
    expect(result.verdict).toBe('pass');
    expect(result.hits[0]).toContain('1500ms');
  });

  it('fails when duration exceeds threshold', () => {
    const evaluator = new LatencyEvaluator({
      config: {
        name: 'latency_check',
        type: 'latency',
        threshold: 1000,
      },
    });

    const result = evaluator.evaluate({
      evalCase: baseTestCase,
      candidate: 'Answer',
      target: baseTarget,
      provider: new StubProvider(textResponse('ok')),
      attempt: 0,
      promptInputs: { question: '', guidelines: '' },
      now: new Date(),
      trace: {
        eventCount: 1,
        toolNames: [],
        toolCallsByName: {},
        errorCount: 0,
        durationMs: 2500,
      },
    });

    expect(result.score).toBe(0);
    expect(result.verdict).toBe('fail');
    expect(result.misses[0]).toContain('2500ms');
  });

  it('fails when no duration data available', () => {
    const evaluator = new LatencyEvaluator({
      config: {
        name: 'latency_check',
        type: 'latency',
        threshold: 2000,
      },
    });

    const result = evaluator.evaluate({
      evalCase: baseTestCase,
      candidate: 'Answer',
      target: baseTarget,
      provider: new StubProvider(textResponse('ok')),
      attempt: 0,
      promptInputs: { question: '', guidelines: '' },
      now: new Date(),
      // No trace
    });

    expect(result.score).toBe(0);
    expect(result.verdict).toBe('fail');
    expect(result.misses[0]).toContain('No duration data');
  });

  it('passes when duration equals threshold exactly', () => {
    const evaluator = new LatencyEvaluator({
      config: {
        name: 'latency_check',
        type: 'latency',
        threshold: 1000,
      },
    });

    const result = evaluator.evaluate({
      evalCase: baseTestCase,
      candidate: 'Answer',
      target: baseTarget,
      provider: new StubProvider(textResponse('ok')),
      attempt: 0,
      promptInputs: { question: '', guidelines: '' },
      now: new Date(),
      trace: {
        eventCount: 1,
        toolNames: [],
        toolCallsByName: {},
        errorCount: 0,
        durationMs: 1000,
      },
    });

    expect(result.score).toBe(1);
    expect(result.verdict).toBe('pass');
  });
});

describe('CostEvaluator', () => {
  it('passes when cost is under budget', () => {
    const evaluator = new CostEvaluator({
      config: {
        name: 'cost_check',
        type: 'cost',
        budget: 0.1,
      },
    });

    const result = evaluator.evaluate({
      evalCase: baseTestCase,
      candidate: 'Answer',
      target: baseTarget,
      provider: new StubProvider(textResponse('ok')),
      attempt: 0,
      promptInputs: { question: '', guidelines: '' },
      now: new Date(),
      trace: {
        eventCount: 1,
        toolNames: [],
        toolCallsByName: {},
        errorCount: 0,
        costUsd: 0.05,
      },
    });

    expect(result.score).toBe(1);
    expect(result.verdict).toBe('pass');
    expect(result.hits[0]).toContain('$0.0500');
  });

  it('fails when cost exceeds budget', () => {
    const evaluator = new CostEvaluator({
      config: {
        name: 'cost_check',
        type: 'cost',
        budget: 0.05,
      },
    });

    const result = evaluator.evaluate({
      evalCase: baseTestCase,
      candidate: 'Answer',
      target: baseTarget,
      provider: new StubProvider(textResponse('ok')),
      attempt: 0,
      promptInputs: { question: '', guidelines: '' },
      now: new Date(),
      trace: {
        eventCount: 1,
        toolNames: [],
        toolCallsByName: {},
        errorCount: 0,
        costUsd: 0.15,
      },
    });

    expect(result.score).toBe(0);
    expect(result.verdict).toBe('fail');
    expect(result.misses[0]).toContain('$0.1500');
  });

  it('fails when no cost data available', () => {
    const evaluator = new CostEvaluator({
      config: {
        name: 'cost_check',
        type: 'cost',
        budget: 0.1,
      },
    });

    const result = evaluator.evaluate({
      evalCase: baseTestCase,
      candidate: 'Answer',
      target: baseTarget,
      provider: new StubProvider(textResponse('ok')),
      attempt: 0,
      promptInputs: { question: '', guidelines: '' },
      now: new Date(),
      // No trace
    });

    expect(result.score).toBe(0);
    expect(result.verdict).toBe('fail');
    expect(result.misses[0]).toContain('No cost data');
  });

  it('passes when cost equals budget exactly', () => {
    const evaluator = new CostEvaluator({
      config: {
        name: 'cost_check',
        type: 'cost',
        budget: 0.1,
      },
    });

    const result = evaluator.evaluate({
      evalCase: baseTestCase,
      candidate: 'Answer',
      target: baseTarget,
      provider: new StubProvider(textResponse('ok')),
      attempt: 0,
      promptInputs: { question: '', guidelines: '' },
      now: new Date(),
      trace: {
        eventCount: 1,
        toolNames: [],
        toolCallsByName: {},
        errorCount: 0,
        costUsd: 0.1,
      },
    });

    expect(result.score).toBe(1);
    expect(result.verdict).toBe('pass');
  });
});

describe('TokenUsageEvaluator', () => {
  it('passes when total tokens are under max_total', () => {
    const evaluator = new TokenUsageEvaluator({
      config: { name: 'token_budget', type: 'token_usage', max_total: 1000 },
    });

    const result = evaluator.evaluate({
      evalCase: baseTestCase,
      candidate: 'Answer',
      target: baseTarget,
      provider: new StubProvider(textResponse('ok')),
      attempt: 0,
      promptInputs: { question: '', guidelines: '' },
      now: new Date(),
      trace: {
        eventCount: 0,
        toolNames: [],
        toolCallsByName: {},
        errorCount: 0,
        tokenUsage: { input: 400, output: 500, cached: 0 },
      },
    });

    expect(result.score).toBe(1);
    expect(result.verdict).toBe('pass');
    expect(result.hits.join(' ')).toContain('Total tokens');
  });

  it('fails when output tokens exceed max_output', () => {
    const evaluator = new TokenUsageEvaluator({
      config: { name: 'token_budget', type: 'token_usage', max_output: 100 },
    });

    const result = evaluator.evaluate({
      evalCase: baseTestCase,
      candidate: 'Answer',
      target: baseTarget,
      provider: new StubProvider(textResponse('ok')),
      attempt: 0,
      promptInputs: { question: '', guidelines: '' },
      now: new Date(),
      trace: {
        eventCount: 0,
        toolNames: [],
        toolCallsByName: {},
        errorCount: 0,
        tokenUsage: { input: 10, output: 150 },
      },
    });

    expect(result.score).toBe(0);
    expect(result.verdict).toBe('fail');
    expect(result.misses.join(' ')).toContain('Output tokens');
  });

  it('fails when no token usage data available', () => {
    const evaluator = new TokenUsageEvaluator({
      config: { name: 'token_budget', type: 'token_usage', max_total: 1000 },
    });

    const result = evaluator.evaluate({
      evalCase: baseTestCase,
      candidate: 'Answer',
      target: baseTarget,
      provider: new StubProvider(textResponse('ok')),
      attempt: 0,
      promptInputs: { question: '', guidelines: '' },
      now: new Date(),
    });

    expect(result.score).toBe(0);
    expect(result.verdict).toBe('fail');
    expect(result.misses[0]).toContain('token usage');
  });
});
