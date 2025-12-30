import { describe, expect, it } from 'bun:test';

import { CodeEvaluator, LlmJudgeEvaluator } from '../../src/evaluation/evaluators.js';
import type { ResolvedTarget } from '../../src/evaluation/providers/targets.js';
import type {
  Provider,
  ProviderRequest,
  ProviderResponse,
} from '../../src/evaluation/providers/types.js';
import type { EvalCase } from '../../src/evaluation/types.js';

/** Helper to create a ProviderResponse with text wrapped in outputMessages */
function textResponse(text: string): ProviderResponse {
  return {
    outputMessages: [{ role: 'assistant', content: text }],
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

const baseTestCase: EvalCase = {
  id: 'case-1',
  dataset: 'test-dataset',
  question: 'Improve the logging implementation',
  input_messages: [{ role: 'user', content: 'Please add logging' }],
  input_segments: [{ type: 'text', value: 'Please add logging' }],
  expected_messages: [],
  reference_answer: '- add structured logging\n- avoid global state',
  guideline_paths: [],
  file_paths: [],
  code_snippets: [],
  expected_outcome: 'Logging improvements applied',
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
      outputMessages: [
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
      outputMessages: [
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
      outputMessages: [
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
      outputMessages: [
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
      outputMessages: [
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
      outputMessages: [
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
      outputMessages: [
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
          { id: 'r1', description: 'Mentions logging', weight: 1.0, required: true },
          { id: 'r2', description: 'Mentions tests', weight: 1.0, required: false },
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
      outputMessages: [
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
      outputMessages: [
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
    const judgeProvider = new StubProvider({ text: '{}' });

    const evalCaseWithExpectedMessages: EvalCase = {
      ...baseTestCase,
      expected_messages: [{ role: 'assistant', content: { decision: 'ACCEPT' } }],
    };

    const expectedCandidate = '{"decision":"ACCEPT"}';

    const script =
      "bun -e \"import fs from 'node:fs'; const input = JSON.parse(fs.readFileSync(0, 'utf8')); const hasExpected = Array.isArray(input.expected_messages); const hasCandidate = typeof input.candidate_answer === 'string'; let candidateDecisionOk = false; try { const obj = JSON.parse(input.candidate_answer); candidateDecisionOk = obj && obj.decision === 'ACCEPT'; } catch {} const ok = hasExpected && hasCandidate && candidateDecisionOk; console.log(JSON.stringify({ score: ok ? 1 : 0, hits: [hasExpected ? 'expected_messages present' : null, hasCandidate ? 'candidate_answer present' : null, candidateDecisionOk ? 'candidate_answer parses' : null].filter(Boolean), misses: [hasExpected ? null : 'expected_messages missing', hasCandidate ? null : 'candidate_answer missing', candidateDecisionOk ? null : 'candidate_answer invalid'].filter(Boolean) }));\"";

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
    expect(result.hits).toContain('expected_messages present');
    expect(result.hits).toContain('candidate_answer present');
    expect(result.hits).toContain('candidate_answer parses');
  });
});
