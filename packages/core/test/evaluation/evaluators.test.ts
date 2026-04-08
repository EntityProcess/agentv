import { describe, expect, it, spyOn } from 'bun:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CodeEvaluator,
  CostEvaluator,
  FieldAccuracyEvaluator,
  LatencyEvaluator,
  LlmGraderEvaluator,
  TokenUsageEvaluator,
} from '../../src/evaluation/evaluators.js';
import type { ResolvedTarget } from '../../src/evaluation/providers/targets.js';
import type {
  Provider,
  ProviderRequest,
  ProviderResponse,
} from '../../src/evaluation/providers/types.js';
import { llmGraderFactory } from '../../src/evaluation/registry/builtin-evaluators.js';
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
  readonly targetName: string;
  lastRequest?: ProviderRequest;

  constructor(
    private readonly response: ProviderResponse,
    targetName = 'capturing',
  ) {
    this.targetName = targetName;
  }

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    this.lastRequest = request;
    return this.response;
  }
}

class SequenceCapturingProvider implements Provider {
  readonly id = 'sequence-capturing';
  readonly kind = 'mock' as const;
  readonly targetName = 'sequence-capturing';
  readonly requests: ProviderRequest[] = [];
  private index = 0;

  constructor(private readonly responses: readonly ProviderResponse[]) {}

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    this.requests.push(request);
    const response = this.responses[this.index] ?? this.responses[this.responses.length - 1];
    this.index += 1;
    if (!response) {
      throw new Error('No mock response configured');
    }
    return response;
  }
}

const baseTestCase: EvalTest = {
  id: 'case-1',
  suite: 'test-dataset',
  question: 'Improve the logging implementation',
  input: [{ role: 'user', content: 'Please add logging' }],
  expected_output: [],
  reference_answer: '- add structured logging\n- avoid global state',
  file_paths: [],
  criteria: 'Logging improvements applied',
  evaluator: 'llm-grader',
};

const baseTarget: ResolvedTarget = {
  kind: 'mock',
  name: 'mock',
  config: { response: '{}' },
};

describe('LlmGraderEvaluator (llm-grader)', () => {
  it('parses JSON response and returns evaluation score', async () => {
    const graderProvider = new StubProvider({
      output: [
        {
          role: 'assistant',
          content: JSON.stringify({
            score: 0.8,
            assertions: [
              { text: 'Captured logging requirement', passed: true },
              { text: 'Did not mention tests', passed: false },
            ],
          }),
        },
      ],
    });

    const evaluator = new LlmGraderEvaluator({
      resolveGraderProvider: async () => graderProvider,
    });

    const result = await evaluator.evaluate({
      evalCase: { ...baseTestCase, evaluator: 'llm-grader' },
      candidate: 'Answer',
      target: baseTarget,
      provider: graderProvider,
      attempt: 0,
      promptInputs: { question: '' },
      now: new Date(),
    });

    expect(result.score).toBeCloseTo(0.8);
    expect(result.verdict).toBe('pass');
    expect(result.assertions.filter((a) => a.passed).map((a) => a.text)).toContain(
      'Captured logging requirement',
    );
    expect(result.assertions.filter((a) => !a.passed).map((a) => a.text)).toContain(
      'Did not mention tests',
    );
    expect(result.evaluatorRawRequest).toBeDefined();
  });

  it('parses JSON from markdown code block', async () => {
    const graderProvider = new StubProvider({
      output: [
        {
          role: 'assistant',
          content: `Here is the evaluation:\n\n\`\`\`json\n${JSON.stringify({
            score: 0.75,
            assertions: [
              { text: 'Clear structure', passed: true },
              { text: 'Good examples', passed: true },
              { text: 'Missing edge cases', passed: false },
            ],
          })}\n\`\`\``,
        },
      ],
    });

    const evaluator = new LlmGraderEvaluator({
      resolveGraderProvider: async () => graderProvider,
    });

    const result = await evaluator.evaluate({
      evalCase: { ...baseTestCase, evaluator: 'llm-grader' },
      candidate: 'Answer',
      target: baseTarget,
      provider: graderProvider,
      attempt: 0,
      promptInputs: { question: '' },
      now: new Date(),
    });

    expect(result.score).toBeCloseTo(0.75);
    expect(result.verdict).toBe('fail');
    expect(result.assertions.filter((a) => a.passed)).toHaveLength(2);
    expect(result.assertions.filter((a) => !a.passed)).toHaveLength(1);
  });

  it('recovers when a freeform assertion uses passed: mixed', async () => {
    const graderProvider = new StubProvider({
      output: [
        {
          role: 'assistant',
          content: `{
            "score": 0.65,
            "assertions": [
              {
                "text": "Addressed the core request",
                "passed": mixed,
                "evidence": "The answer covers part of the requested behavior."
              }
            ]
          }`,
        },
      ],
    });

    const evaluator = new LlmGraderEvaluator({
      resolveGraderProvider: async () => graderProvider,
    });

    const result = await evaluator.evaluate({
      evalCase: { ...baseTestCase, evaluator: 'llm-grader' },
      candidate: 'Answer',
      target: baseTarget,
      provider: graderProvider,
      attempt: 0,
      promptInputs: { question: '' },
      now: new Date(),
    });

    expect(result.score).toBeCloseTo(0.65);
    expect(result.verdict).toBe('fail');
    expect(result.assertions).toEqual([
      {
        text: 'Addressed the core request',
        passed: false,
        evidence: 'The answer covers part of the requested behavior.',
      },
    ]);
  });

  it('validates score is in range [0.0, 1.0]', async () => {
    const graderProvider = new StubProvider({
      output: [
        {
          role: 'assistant',
          content: JSON.stringify({
            score: 1.5, // Invalid: out of range
            assertions: [{ text: 'Good', passed: true }],
          }),
        },
      ],
    });

    const evaluator = new LlmGraderEvaluator({
      resolveGraderProvider: async () => graderProvider,
    });

    const result = await evaluator.evaluate({
      evalCase: { ...baseTestCase, evaluator: 'llm-grader' },
      candidate: 'Answer',
      target: baseTarget,
      provider: graderProvider,
      attempt: 0,
      promptInputs: { question: '' },
      now: new Date(),
    });

    // Should skip when grader parse fails (not silent zero)
    expect(result.score).toBe(0);
    expect(result.verdict).toBe('skip');
    expect(result.assertions.filter((a) => a.passed)).toHaveLength(0);
    expect(result.assertions.filter((a) => !a.passed)).toHaveLength(1);
  });

  it('enforces max 8 assertion entries', async () => {
    const graderProvider = new StubProvider({
      output: [
        {
          role: 'assistant',
          content: JSON.stringify({
            score: 0.9,
            assertions: [
              { text: 'Item 1', passed: true },
              { text: 'Item 2', passed: true },
              { text: 'Item 3', passed: true },
              { text: 'Item 4', passed: true },
              { text: 'Item 5', passed: true },
              { text: 'Item 6', passed: true },
              { text: 'Miss 1', passed: false },
              { text: 'Miss 2', passed: false },
              { text: 'Miss 3', passed: false },
              { text: 'Miss 4', passed: false },
              { text: 'Miss 5', passed: false },
            ],
          }),
        },
      ],
    });

    const evaluator = new LlmGraderEvaluator({
      resolveGraderProvider: async () => graderProvider,
    });

    const result = await evaluator.evaluate({
      evalCase: { ...baseTestCase, evaluator: 'llm-grader' },
      candidate: 'Answer',
      target: baseTarget,
      provider: graderProvider,
      attempt: 0,
      promptInputs: { question: '' },
      now: new Date(),
    });

    expect(result.score).toBeCloseTo(0.9);
    expect(result.verdict).toBe('pass');
    expect(result.assertions).toHaveLength(8); // Truncated to max 8
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

    const graderProvider = new CapturingProvider({
      output: [
        {
          role: 'assistant',
          content: JSON.stringify({
            score: 0.7,
            assertions: [{ text: 'Used custom prompt', passed: true }],
          }),
        },
      ],
    });

    const evaluator = new LlmGraderEvaluator({
      resolveGraderProvider: async () => graderProvider,
      evaluatorTemplate: customPrompt,
    });

    const result = await evaluator.evaluate({
      evalCase: { ...baseTestCase, evaluator: 'llm-grader' },
      candidate: 'Answer',
      target: baseTarget,
      provider: graderProvider,
      attempt: 0,
      promptInputs: { question: '' },
      now: new Date(),
    });

    expect(result.score).toBeCloseTo(0.7);
    expect(result.verdict).toBe('fail');

    // Custom template goes in user prompt (question), system prompt only has output schema
    expect(graderProvider.lastRequest?.question).toContain(customPrompt);
    expect(graderProvider.lastRequest?.systemPrompt).toContain(
      'You must respond with a single JSON object',
    );
    expect(graderProvider.lastRequest?.systemPrompt).not.toContain(customPrompt);

    expect(result.evaluatorRawRequest?.userPrompt).toContain(customPrompt);
    expect(result.evaluatorRawRequest?.systemPrompt).toContain(
      'You must respond with a single JSON object',
    );
    expect(result.evaluatorRawRequest?.systemPrompt).not.toContain(customPrompt);
  });

  it('uses evaluator target overrides when configured', async () => {
    const defaultGraderProvider = new CapturingProvider(
      textResponse(
        JSON.stringify({ score: 0.2, assertions: [{ text: 'used default', passed: false }] }),
      ),
      'default-grader',
    );

    const overrideGraderProvider = new CapturingProvider(
      textResponse(
        JSON.stringify({ score: 0.9, assertions: [{ text: 'used override', passed: true }] }),
      ),
      'grader-low-cost-b',
    );

    const evaluator = llmGraderFactory(
      {
        name: 'grader-panel-member',
        type: 'llm-grader',
        prompt: 'Evaluate {{answer}}',
        target: 'grader-low-cost-b',
      },
      {
        graderProvider: defaultGraderProvider,
        targetResolver: (targetName) =>
          targetName === 'grader-low-cost-b' ? overrideGraderProvider : undefined,
        llmGrader: new LlmGraderEvaluator({
          resolveGraderProvider: async () => defaultGraderProvider,
        }),
        registry: {} as never,
      },
    );

    const result = await evaluator.evaluate({
      evalCase: { ...baseTestCase, evaluator: 'llm-grader' },
      candidate: 'Answer',
      target: baseTarget,
      provider: defaultGraderProvider,
      attempt: 0,
      promptInputs: { question: '' },
      now: new Date(),
    });

    expect(result.score).toBeCloseTo(0.9);
    expect(result.graderTarget).toBe('grader-low-cost-b');
    expect(overrideGraderProvider.lastRequest).toBeDefined();
    expect(defaultGraderProvider.lastRequest).toBeUndefined();
  });

  it('rejects JSON with invalid assertions types', async () => {
    const graderProvider = new StubProvider({
      output: [
        {
          role: 'assistant',
          content: JSON.stringify({
            score: 0.8,
            assertions: 'Not an array', // Invalid type
          }),
        },
      ],
    });

    const evaluator = new LlmGraderEvaluator({
      resolveGraderProvider: async () => graderProvider,
    });

    const result = await evaluator.evaluate({
      evalCase: { ...baseTestCase, evaluator: 'llm-grader' },
      candidate: 'Answer',
      target: baseTarget,
      provider: graderProvider,
      attempt: 0,
      promptInputs: { question: '' },
      now: new Date(),
    });

    // Should skip when grader parse fails (not silent zero)
    expect(result.score).toBe(0);
    expect(result.verdict).toBe('skip');
    expect(result.assertions.filter((a) => a.passed)).toHaveLength(0);
    expect(result.assertions.filter((a) => !a.passed)).toHaveLength(1);
  });

  it('tolerates non-JSON output by falling back to skip', async () => {
    const graderProvider = new StubProvider(textResponse('Final score: 0.5'));
    const evaluator = new LlmGraderEvaluator({
      resolveGraderProvider: async () => graderProvider,
    });

    const result = await evaluator.evaluate({
      evalCase: { ...baseTestCase, evaluator: 'llm-grader' },
      candidate: 'Answer',
      target: baseTarget,
      provider: graderProvider,
      attempt: 0,
      promptInputs: { question: '' },
      now: new Date(),
    });

    expect(result.score).toBe(0);
    expect(result.verdict).toBe('skip');
    expect(result.assertions.filter((a) => a.passed)).toHaveLength(0);
    expect(result.assertions.filter((a) => !a.passed)).toHaveLength(1);
  });

  it('supports rubric mode when rubrics are provided in config', async () => {
    const graderProvider = new StubProvider({
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

    const evaluator = new LlmGraderEvaluator({
      resolveGraderProvider: async () => graderProvider,
    });

    const result = await evaluator.evaluate({
      evalCase: { ...baseTestCase, evaluator: 'llm-grader' },
      candidate: 'Answer',
      target: baseTarget,
      provider: graderProvider,
      attempt: 0,
      promptInputs: { question: '' },
      now: new Date(),
      evaluator: {
        name: 'rubric',
        type: 'llm-grader',
        rubrics: [
          { id: 'r1', outcome: 'Mentions logging', weight: 1.0, required: true },
          { id: 'r2', outcome: 'Mentions tests', weight: 1.0, required: false },
        ],
      },
    });

    expect(result.score).toBeCloseTo(0.5);
    expect(result.verdict).toBe('fail');
    expect(
      result.assertions
        .filter((a) => a.passed)
        .map((a) => a.text)
        .join('\n'),
    ).toContain('[r1]');
    expect(
      result.assertions
        .filter((a) => !a.passed)
        .map((a) => a.text)
        .join('\n'),
    ).toContain('[r2]');
  });

  it('passes multi-turn role markers through to evaluator prompts', async () => {
    const graderProvider = new CapturingProvider({
      output: [{ role: 'assistant', content: JSON.stringify({ score: 0.65, assertions: [] }) }],
    });
    const evaluator = new LlmGraderEvaluator({
      resolveGraderProvider: async () => graderProvider,
    });

    const multiTurnQuestion =
      '@[System]:\nFollow the coding guidelines.\n\n@[User]:\nDebug the failing test.\n\n@[Assistant]:\nPlease share the stack trace.';

    const result = await evaluator.evaluate({
      evalCase: { ...baseTestCase, evaluator: 'llm-grader' },
      candidate: 'Candidate answer',
      target: baseTarget,
      provider: graderProvider,
      attempt: 0,
      promptInputs: { question: multiTurnQuestion },
      now: new Date(),
    });

    expect(graderProvider.lastRequest?.question).toContain(multiTurnQuestion);
    expect(result.evaluatorRawRequest?.userPrompt).toContain('@[Assistant]:');
    expect(result.evaluatorRawRequest?.userPrompt).toContain('@[System]:');
  });

  it('keeps single-turn prompts flat when no markers are needed', async () => {
    const graderProvider = new CapturingProvider({
      output: [{ role: 'assistant', content: JSON.stringify({ score: 0.8, assertions: [] }) }],
    });
    const evaluator = new LlmGraderEvaluator({
      resolveGraderProvider: async () => graderProvider,
    });

    const flatQuestion = 'Summarize the architecture in two sentences.';

    const result = await evaluator.evaluate({
      evalCase: { ...baseTestCase, evaluator: 'llm-grader' },
      candidate: 'Candidate answer',
      target: baseTarget,
      provider: graderProvider,
      attempt: 0,
      promptInputs: { question: flatQuestion },
      now: new Date(),
    });

    expect(graderProvider.lastRequest?.question).toContain(flatQuestion);
    expect(graderProvider.lastRequest?.question).not.toContain('@[User]:');
    expect(result.evaluatorRawRequest?.userPrompt).toContain(flatQuestion);
    expect(result.evaluatorRawRequest?.userPrompt).not.toContain('@[User]:');
  });

  it('returns skip verdict when rubric mode receives malformed JSON', async () => {
    const graderProvider = new StubProvider(textResponse('not valid json at all'));

    const evaluator = new LlmGraderEvaluator({
      resolveGraderProvider: async () => graderProvider,
    });

    const result = await evaluator.evaluate({
      evalCase: { ...baseTestCase, evaluator: 'llm-grader' },
      candidate: 'Answer',
      target: baseTarget,
      provider: graderProvider,
      attempt: 0,
      promptInputs: { question: '' },
      now: new Date(),
      evaluator: {
        name: 'rubric',
        type: 'llm-grader',
        rubrics: [{ id: 'r1', outcome: 'Mentions logging', weight: 1.0, required: false }],
      },
    });

    expect(result.score).toBe(0);
    expect(result.verdict).toBe('skip');
    const failed = result.assertions.filter((a) => !a.passed);
    expect(failed.length).toBeGreaterThan(0);
    expect(failed[0].text).toContain('Grader parse failure');
  });

  it('returns skip verdict when score-range rubric mode receives malformed JSON', async () => {
    const graderProvider = new StubProvider(textResponse('truncated {'));

    const evaluator = new LlmGraderEvaluator({
      resolveGraderProvider: async () => graderProvider,
    });

    const result = await evaluator.evaluate({
      evalCase: { ...baseTestCase, evaluator: 'llm-grader' },
      candidate: 'Answer',
      target: baseTarget,
      provider: graderProvider,
      attempt: 0,
      promptInputs: { question: '' },
      now: new Date(),
      evaluator: {
        name: 'rubric',
        type: 'llm-grader',
        rubrics: [
          {
            id: 'r1',
            outcome: 'Completeness',
            weight: 1.0,
            required: false,
            score_ranges: [
              { score_range: [0, 3] as [number, number], outcome: 'Poor' },
              { score_range: [7, 10] as [number, number], outcome: 'Good' },
            ],
          },
        ],
      },
    });

    expect(result.score).toBe(0);
    expect(result.verdict).toBe('skip');
    const failed2 = result.assertions.filter((a) => !a.passed);
    expect(failed2.length).toBeGreaterThan(0);
    expect(failed2[0].text).toContain('Grader parse failure');
  });

  it('emits stderr warning on grader parse failure', async () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

    const graderProvider = new StubProvider(textResponse('not valid json at all'));

    const evaluator = new LlmGraderEvaluator({
      resolveGraderProvider: async () => graderProvider,
    });

    await evaluator.evaluate({
      evalCase: { ...baseTestCase, evaluator: 'llm-grader' },
      candidate: 'Answer',
      target: baseTarget,
      provider: graderProvider,
      attempt: 0,
      promptInputs: { question: '' },
      now: new Date(),
      evaluator: {
        name: 'my-custom-grader',
        type: 'llm-grader',
      },
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('LLM grader');
    expect(warnSpy.mock.calls[0][0]).toContain('my-custom-grader');
    expect(warnSpy.mock.calls[0][0]).toContain('skipped');
    warnSpy.mockRestore();
  });

  it('repairs malformed freeform grader output after standard retries are exhausted', async () => {
    const malformedResponse = textResponse(
      JSON.stringify({
        score: '0.8',
        assertions: [{ text: 'Captured logging requirement', passed: true }],
      }),
    );
    const repairedResponse = textResponse(
      JSON.stringify({
        score: 0.8,
        assertions: [{ text: 'Captured logging requirement', passed: true }],
      }),
    );

    const graderProvider = new SequenceCapturingProvider([
      malformedResponse,
      malformedResponse,
      malformedResponse,
      repairedResponse,
    ]);

    const evaluator = new LlmGraderEvaluator({
      resolveGraderProvider: async () => graderProvider,
    });

    const result = await evaluator.evaluate({
      evalCase: { ...baseTestCase, evaluator: 'llm-grader' },
      candidate: 'Answer',
      target: baseTarget,
      provider: graderProvider,
      attempt: 0,
      promptInputs: { question: '' },
      now: new Date(),
    });

    expect(result.score).toBeCloseTo(0.8);
    expect(result.verdict).toBe('pass');
    expect(graderProvider.requests).toHaveLength(4);
    expect(graderProvider.requests[3]?.question).toContain(
      'The following evaluation response has useful grading content but invalid JSON structure.',
    );
    expect(graderProvider.requests[3]?.question).toContain('"score":"0.8"');
  });

  it('keeps skipping when the structure-fix attempt is also malformed', async () => {
    const malformedResponse = textResponse(
      '{"score":"0.8","assertions":[{"text":"Bad","passed":true}]}',
    );
    const graderProvider = new SequenceCapturingProvider([
      malformedResponse,
      malformedResponse,
      malformedResponse,
      textResponse('{"score":'),
    ]);

    const evaluator = new LlmGraderEvaluator({
      resolveGraderProvider: async () => graderProvider,
    });

    const result = await evaluator.evaluate({
      evalCase: { ...baseTestCase, evaluator: 'llm-grader' },
      candidate: 'Answer',
      target: baseTarget,
      provider: graderProvider,
      attempt: 0,
      promptInputs: { question: '' },
      now: new Date(),
    });

    expect(result.score).toBe(0);
    expect(result.verdict).toBe('skip');
    expect(result.assertions[0]?.text).toContain('structure-fix attempt');
    expect(graderProvider.requests).toHaveLength(4);
  });

  it('keeps skipping on unrecoverable malformed JSON', async () => {
    const graderProvider = new StubProvider(textResponse('{"score":'));

    const evaluator = new LlmGraderEvaluator({
      resolveGraderProvider: async () => graderProvider,
    });

    const result = await evaluator.evaluate({
      evalCase: { ...baseTestCase, evaluator: 'llm-grader' },
      candidate: 'Answer',
      target: baseTarget,
      provider: graderProvider,
      attempt: 0,
      promptInputs: { question: '' },
      now: new Date(),
    });

    expect(result.score).toBe(0);
    expect(result.verdict).toBe('skip');
    expect(result.assertions[0]?.text).toContain('Grader parse failure');
  });

  it('emits stderr warning with default name when evaluator name is not set', async () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

    const graderProvider = new StubProvider(textResponse('garbage'));

    const evaluator = new LlmGraderEvaluator({
      resolveGraderProvider: async () => graderProvider,
    });

    await evaluator.evaluate({
      evalCase: { ...baseTestCase, evaluator: 'llm-grader' },
      candidate: 'Answer',
      target: baseTarget,
      provider: graderProvider,
      attempt: 0,
      promptInputs: { question: '' },
      now: new Date(),
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('llm-grader');
    expect(warnSpy.mock.calls[0][0]).toContain('skipped');
    warnSpy.mockRestore();
  });

  it('treats bare prompt string as criteria, not full template override (#982)', async () => {
    // When a user writes `prompt: "Check step-by-step work"` in an assertion,
    // the grader should receive the DEFAULT_EVALUATOR_TEMPLATE (which contains
    // {{output}}, {{input}}, etc.) with the prompt text injected as {{criteria}},
    // NOT use the bare text as the entire template replacement.
    const graderProvider = new CapturingProvider({
      output: [
        {
          role: 'assistant',
          content: JSON.stringify({
            score: 0.9,
            assertions: [{ text: 'Shows step-by-step work', passed: true }],
          }),
        },
      ],
    });

    const evaluator = llmGraderFactory(
      {
        name: 'step-check',
        type: 'llm-grader',
        prompt: 'Check if the response shows step-by-step work',
      },
      {
        graderProvider,
        llmGrader: new LlmGraderEvaluator({
          resolveGraderProvider: async () => graderProvider,
        }),
        registry: {} as never,
      },
    );

    await evaluator.evaluate({
      evalCase: {
        ...baseTestCase,
        criteria: 'Original criteria from test case',
      },
      candidate: 'Step 1: Read the code\nStep 2: Write tests\nStep 3: Refactor',
      target: baseTarget,
      provider: graderProvider,
      attempt: 0,
      promptInputs: { question: '' },
      now: new Date(),
    });

    // The user prompt should contain the full default template structure
    const userPrompt = graderProvider.lastRequest?.question ?? '';
    expect(userPrompt).toContain('[[ ## criteria ## ]]');
    expect(userPrompt).toContain('[[ ## answer ## ]]');
    expect(userPrompt).toContain('[[ ## question ## ]]');
    // The bare prompt text should appear as the criteria
    expect(userPrompt).toContain('Check if the response shows step-by-step work');
    // The candidate answer should be present in the template
    expect(userPrompt).toContain('Step 1: Read the code');
  });

  it('uses prompt with {{output}} as full template override', async () => {
    // When a user provides a template with known variables, it SHOULD replace
    // the default template (backward compatible with intentional overrides).
    const graderProvider = new CapturingProvider({
      output: [
        {
          role: 'assistant',
          content: JSON.stringify({
            score: 0.8,
            assertions: [{ text: 'Custom template used', passed: true }],
          }),
        },
      ],
    });

    const customTemplate = 'Custom grader: evaluate {{output}} against {{criteria}}';

    const evaluator = llmGraderFactory(
      {
        name: 'custom-template',
        type: 'llm-grader',
        prompt: customTemplate,
      },
      {
        graderProvider,
        llmGrader: new LlmGraderEvaluator({
          resolveGraderProvider: async () => graderProvider,
        }),
        registry: {} as never,
      },
    );

    await evaluator.evaluate({
      evalCase: baseTestCase,
      candidate: 'Some answer',
      target: baseTarget,
      provider: graderProvider,
      attempt: 0,
      promptInputs: { question: '' },
      now: new Date(),
    });

    // The custom template should be used as-is (with substitutions)
    const userPrompt = graderProvider.lastRequest?.question ?? '';
    expect(userPrompt).toContain('Custom grader: evaluate');
    // Should NOT contain the default template's structure
    expect(userPrompt).not.toContain('[[ ## answer ## ]]');
  });
});

describe('CodeEvaluator', () => {
  it('passes required fields to code-grader scripts', async () => {
    const graderProvider = new StubProvider(textResponse('{}'));

    const evalCaseWithExpectedMessages: EvalTest = {
      ...baseTestCase,
      expected_output: [{ role: 'assistant', content: { decision: 'ACCEPT' } }],
    };

    const expectedCandidate = '{"decision":"ACCEPT"}';

    // Use external script file for cross-platform compatibility
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const script = ['node', join(__dirname, '../fixtures/test-grader.cjs')];

    const evaluator = new CodeEvaluator({ command: script });

    const result = await evaluator.evaluate({
      evalCase: evalCaseWithExpectedMessages,
      candidate: expectedCandidate,
      output: [{ role: 'assistant', content: '{"decision":"ACCEPT"}' }],
      target: baseTarget,
      provider: graderProvider,
      attempt: 0,
      promptInputs: { question: '' },
      now: new Date(),
    });

    expect(result.score).toBe(1);
    expect(result.verdict).toBe('pass');
    const passedTexts = result.assertions.filter((a) => a.passed).map((a) => a.text);
    expect(passedTexts).toContain('expected_output present');
    expect(passedTexts).toContain('answer present');
    expect(passedTexts).toContain('answer parses');
  });

  it('surfaces stderr and exit code on failure', async () => {
    const graderProvider = new StubProvider(textResponse('{}'));

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const script = ['node', join(__dirname, '../fixtures/test-grader-error.cjs')];

    const evaluator = new CodeEvaluator({ command: script });

    const result = await evaluator.evaluate({
      evalCase: baseTestCase,
      candidate: 'Candidate answer',
      target: baseTarget,
      provider: graderProvider,
      attempt: 0,
      promptInputs: { question: '' },
      now: new Date(),
    });

    expect(result.verdict).toBe('fail');
    const failedAssertions = result.assertions.filter((a) => !a.passed);
    expect(failedAssertions[0].text).toContain('exited with code');
    expect(failedAssertions[0].text).toContain('test-error');
  });

  it('works with defineCodeGrader-based code grader', async () => {
    const graderProvider = new StubProvider(textResponse('Logging improvements applied'));

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const script = ['bun', 'run', join(__dirname, '../fixtures/test-define-grader.ts')];

    const evaluator = new CodeEvaluator({ command: script });

    const result = await evaluator.evaluate({
      evalCase: baseTestCase,
      candidate: 'Added logging to the implementation',
      output: [{ role: 'assistant', content: 'Added logging to the implementation' }],
      target: baseTarget,
      provider: graderProvider,
      attempt: 0,
      promptInputs: { question: '' },
      now: new Date(),
    });

    expect(result.score).toBe(1);
    expect(result.verdict).toBe('pass');
    expect(result.assertions.filter((a) => a.passed).length).toBeGreaterThan(0);
  });

  it('captures optional details from code grader output', async () => {
    const graderProvider = new StubProvider(textResponse('{}'));

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const script = ['node', join(__dirname, '../fixtures/test-grader-with-details.cjs')];

    const evaluator = new CodeEvaluator({ command: script });

    const result = await evaluator.evaluate({
      evalCase: {
        ...baseTestCase,
        expected_output: [{ role: 'assistant', content: 'test' }],
      },
      candidate: 'Test candidate',
      output: [{ role: 'assistant', content: 'Test candidate' }],
      target: baseTarget,
      provider: graderProvider,
      attempt: 0,
      promptInputs: { question: '' },
      now: new Date(),
    });

    expect(result.score).toBeCloseTo(0.75);
    expect(result.details).toBeDefined();
    expect(result.details?.metrics).toEqual({ tp: 5, tn: 2, fp: 1, fn: 2 });
    expect(result.details?.alignment).toHaveLength(2);
    expect(result.details?.precision).toBeCloseTo(0.833);
    expect(result.details?.recall).toBeCloseTo(0.714);
    expect(result.details?.f1).toBeCloseTo(0.769);
  });

  it('passes workspace_path to code grader via payload and env var', async () => {
    const graderProvider = new StubProvider(textResponse('{}'));

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const script = ['node', join(__dirname, '../fixtures/test-grader-workspace.cjs')];

    const evaluator = new CodeEvaluator({ command: script });

    const result = await evaluator.evaluate({
      evalCase: baseTestCase,
      candidate: 'Test candidate',
      target: baseTarget,
      provider: graderProvider,
      attempt: 0,
      promptInputs: { question: '' },
      now: new Date(),
      workspacePath: '/tmp/test-workspace',
    });

    expect(result.score).toBe(1);
    expect(result.verdict).toBe('pass');
    const passedTexts2 = result.assertions.filter((a) => a.passed).map((a) => a.text);
    expect(passedTexts2).toContain('workspace_path present in payload');
    expect(passedTexts2).toContain('AGENTV_WORKSPACE_PATH env var set');
    expect(passedTexts2).toContain('payload and env var match');
  });

  it('omits details when not returned by code grader', async () => {
    const graderProvider = new StubProvider(textResponse('{}'));

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const script = ['node', join(__dirname, '../fixtures/test-grader.cjs')];

    const evaluator = new CodeEvaluator({ command: script });

    const result = await evaluator.evaluate({
      evalCase: {
        ...baseTestCase,
        expected_output: [{ role: 'assistant', content: { decision: 'ACCEPT' } }],
      },
      candidate: '{"decision":"ACCEPT"}',
      output: [{ role: 'assistant', content: '{"decision":"ACCEPT"}' }],
      target: baseTarget,
      provider: graderProvider,
      attempt: 0,
      promptInputs: { question: '' },
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

  const graderProvider = new StubProvider(textResponse('{}'));

  it('evaluates exact match fields correctly', () => {
    const evaluator = new FieldAccuracyEvaluator({
      config: {
        name: 'test',
        type: 'field-accuracy',
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
      provider: graderProvider,
      attempt: 0,
      promptInputs: { question: '' },
      now: new Date(),
    });

    expect(result.score).toBe(1.0);
    expect(result.verdict).toBe('pass');
    expect(result.assertions.filter((a) => a.passed)).toHaveLength(2);
    expect(result.assertions.filter((a) => !a.passed)).toHaveLength(0);
  });

  it('handles missing required fields', () => {
    const evaluator = new FieldAccuracyEvaluator({
      config: {
        name: 'test',
        type: 'field-accuracy',
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
      provider: graderProvider,
      attempt: 0,
      promptInputs: { question: '' },
      now: new Date(),
    });

    expect(result.score).toBe(0.5);
    expect(result.verdict).toBe('fail');
    expect(result.assertions.filter((a) => a.passed)).toHaveLength(1);
    expect(result.assertions.filter((a) => !a.passed)).toHaveLength(1);
    expect(result.assertions.filter((a) => !a.passed)[0].text).toContain('amount');
    expect(result.assertions.filter((a) => !a.passed)[0].text).toContain('required');
  });

  it('applies numeric tolerance matching', () => {
    const evaluator = new FieldAccuracyEvaluator({
      config: {
        name: 'test',
        type: 'field-accuracy',
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
      provider: graderProvider,
      attempt: 0,
      promptInputs: { question: '' },
      now: new Date(),
    });

    expect(result.score).toBe(1.0);
    expect(result.verdict).toBe('pass');
  });

  it('fails numeric tolerance when outside range', () => {
    const evaluator = new FieldAccuracyEvaluator({
      config: {
        name: 'test',
        type: 'field-accuracy',
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
      provider: graderProvider,
      attempt: 0,
      promptInputs: { question: '' },
      now: new Date(),
    });

    expect(result.score).toBe(0);
    expect(result.verdict).toBe('fail');
    expect(result.assertions.filter((a) => !a.passed)[0].text).toContain('outside tolerance');
  });

  it('applies date matching with format normalization', () => {
    const evaluator = new FieldAccuracyEvaluator({
      config: {
        name: 'test',
        type: 'field-accuracy',
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
      provider: graderProvider,
      attempt: 0,
      promptInputs: { question: '' },
      now: new Date(),
    });

    expect(result.score).toBe(1.0);
    expect(result.verdict).toBe('pass');
  });

  it('respects weighted averaging', () => {
    const evaluator = new FieldAccuracyEvaluator({
      config: {
        name: 'test',
        type: 'field-accuracy',
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
      provider: graderProvider,
      attempt: 0,
      promptInputs: { question: '' },
      now: new Date(),
    });

    // Score should be (1.0 * 2.0 + 0.0 * 1.0) / (2.0 + 1.0) = 2/3 ≈ 0.667
    expect(result.score).toBeCloseTo(0.667, 2);
    expect(result.verdict).toBe('fail');
  });

  it('supports all_or_nothing aggregation', () => {
    const evaluator = new FieldAccuracyEvaluator({
      config: {
        name: 'test',
        type: 'field-accuracy',
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
      provider: graderProvider,
      attempt: 0,
      promptInputs: { question: '' },
      now: new Date(),
    });

    expect(result.score).toBe(0);
    expect(result.verdict).toBe('fail');
  });

  it('handles nested field paths', () => {
    const evaluator = new FieldAccuracyEvaluator({
      config: {
        name: 'test',
        type: 'field-accuracy',
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
      provider: graderProvider,
      attempt: 0,
      promptInputs: { question: '' },
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
        type: 'field-accuracy',
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
      provider: graderProvider,
      attempt: 0,
      promptInputs: { question: '' },
      now: new Date(),
    });

    expect(result.score).toBe(1.0);
    expect(result.verdict).toBe('pass');
  });

  it('returns failure for invalid JSON candidate', () => {
    const evaluator = new FieldAccuracyEvaluator({
      config: {
        name: 'test',
        type: 'field-accuracy',
        fields: [{ path: 'invoice_number', match: 'exact', required: true, weight: 1.0 }],
      },
    });

    const result = evaluator.evaluate({
      evalCase: baseTestCaseWithExpected,
      candidate: 'This is not valid JSON',
      target: baseTarget,
      provider: graderProvider,
      attempt: 0,
      promptInputs: { question: '' },
      now: new Date(),
    });

    expect(result.score).toBe(0);
    expect(result.verdict).toBe('fail');
    expect(result.assertions.filter((a) => !a.passed)[0].text).toContain('parse');
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
      promptInputs: { question: '' },
      now: new Date(),
      durationMs: 1500,
    });

    expect(result.score).toBe(1);
    expect(result.verdict).toBe('pass');
    expect(result.assertions.filter((a) => a.passed)[0].text).toContain('1500ms');
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
      promptInputs: { question: '' },
      now: new Date(),
      durationMs: 2500,
    });

    expect(result.score).toBe(0);
    expect(result.verdict).toBe('fail');
    expect(result.assertions.filter((a) => !a.passed)[0].text).toContain('2500ms');
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
      promptInputs: { question: '' },
      now: new Date(),
      // No trace
    });

    expect(result.score).toBe(0);
    expect(result.verdict).toBe('fail');
    expect(result.assertions.filter((a) => !a.passed)[0].text).toContain('No duration data');
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
      promptInputs: { question: '' },
      now: new Date(),
      durationMs: 1000,
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
      promptInputs: { question: '' },
      now: new Date(),
      costUsd: 0.05,
    });

    expect(result.score).toBe(1);
    expect(result.verdict).toBe('pass');
    expect(result.assertions.filter((a) => a.passed)[0].text).toContain('$0.0500');
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
      promptInputs: { question: '' },
      now: new Date(),
      costUsd: 0.15,
    });

    expect(result.score).toBe(0);
    expect(result.verdict).toBe('fail');
    expect(result.assertions.filter((a) => !a.passed)[0].text).toContain('$0.1500');
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
      promptInputs: { question: '' },
      now: new Date(),
      // No trace
    });

    expect(result.score).toBe(0);
    expect(result.verdict).toBe('fail');
    expect(result.assertions.filter((a) => !a.passed)[0].text).toContain('No cost data');
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
      promptInputs: { question: '' },
      now: new Date(),
      costUsd: 0.1,
    });

    expect(result.score).toBe(1);
    expect(result.verdict).toBe('pass');
  });
});

describe('TokenUsageEvaluator', () => {
  it('passes when total tokens are under max_total', () => {
    const evaluator = new TokenUsageEvaluator({
      config: { name: 'token_budget', type: 'token-usage', max_total: 1000 },
    });

    const result = evaluator.evaluate({
      evalCase: baseTestCase,
      candidate: 'Answer',
      target: baseTarget,
      provider: new StubProvider(textResponse('ok')),
      attempt: 0,
      promptInputs: { question: '' },
      now: new Date(),
      tokenUsage: { input: 400, output: 500, cached: 0 },
    });

    expect(result.score).toBe(1);
    expect(result.verdict).toBe('pass');
    expect(
      result.assertions
        .filter((a) => a.passed)
        .map((a) => a.text)
        .join(' '),
    ).toContain('Total tokens');
  });

  it('fails when output tokens exceed max_output', () => {
    const evaluator = new TokenUsageEvaluator({
      config: { name: 'token_budget', type: 'token-usage', max_output: 100 },
    });

    const result = evaluator.evaluate({
      evalCase: baseTestCase,
      candidate: 'Answer',
      target: baseTarget,
      provider: new StubProvider(textResponse('ok')),
      attempt: 0,
      promptInputs: { question: '' },
      now: new Date(),
      tokenUsage: { input: 10, output: 150 },
    });

    expect(result.score).toBe(0);
    expect(result.verdict).toBe('fail');
    expect(
      result.assertions
        .filter((a) => !a.passed)
        .map((a) => a.text)
        .join(' '),
    ).toContain('Output tokens');
  });

  it('fails when no token usage data available', () => {
    const evaluator = new TokenUsageEvaluator({
      config: { name: 'token_budget', type: 'token-usage', max_total: 1000 },
    });

    const result = evaluator.evaluate({
      evalCase: baseTestCase,
      candidate: 'Answer',
      target: baseTarget,
      provider: new StubProvider(textResponse('ok')),
      attempt: 0,
      promptInputs: { question: '' },
      now: new Date(),
    });

    expect(result.score).toBe(0);
    expect(result.verdict).toBe('fail');
    expect(result.assertions.filter((a) => !a.passed)[0].text).toContain('token usage');
  });
});
