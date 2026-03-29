import { describe, expect, it } from 'bun:test';

import { LlmGraderEvaluator } from '../../src/evaluation/evaluators.js';
import type { ResolvedTarget } from '../../src/evaluation/providers/targets.js';
import type {
  Provider,
  ProviderRequest,
  ProviderResponse,
} from '../../src/evaluation/providers/types.js';
import type { EvalTest } from '../../src/evaluation/types.js';

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
  question: 'Original Question Text',
  input: [{ role: 'user', content: [{ type: 'text', value: 'Input Message' }] }],
  expected_output: [{ type: 'text', value: 'Expected Output Message' }],
  reference_answer: 'Reference Answer Text',
  file_paths: [],
  criteria: 'Expected Outcome Text',
  evaluator: 'llm-grader',
};

const baseTarget: ResolvedTarget = {
  kind: 'mock',
  name: 'mock',
  config: { response: '{}' },
};

describe('LlmGraderEvaluator Variable Substitution', () => {
  it('substitutes template variables in custom prompt', async () => {
    const formattedQuestion = '@[User]: What is the status?\n\n@[Assistant]: Requesting more info.';
    const customPrompt = `
Question: {{input}}
Outcome: {{criteria}}
Reference: {{expected_output}}
Candidate: {{output}}
File Changes: {{file_changes}}
`;

    const graderProvider = new CapturingProvider({
      text: JSON.stringify({
        score: 0.8,
        assertions: [{ text: 'Good', passed: true }],
      }),
    });

    const evaluator = new LlmGraderEvaluator({
      resolveGraderProvider: async () => graderProvider,
      evaluatorTemplate: customPrompt,
    });

    const answer = 'Candidate Answer Text';

    await evaluator.evaluate({
      evalCase: { ...baseTestCase, evaluator: 'llm-grader' },
      candidate: answer,
      target: baseTarget,
      provider: graderProvider,
      attempt: 0,
      promptInputs: { question: formattedQuestion },
      now: new Date(),
      fileChanges: 'diff --git a/test.txt b/test.txt\n+added line',
    });

    const request = graderProvider.lastRequest;
    expect(request).toBeDefined();

    // Primary variables resolve to human-readable text
    expect(request?.question).toContain(`Question: ${formattedQuestion}`);
    expect(request?.question).not.toContain('Original Question Text');
    expect(request?.question).toContain('Outcome: Expected Outcome Text');
    expect(request?.question).toContain('Reference: Reference Answer Text');
    expect(request?.question).toContain('Candidate: Candidate Answer Text');

    // Verify file_changes substitution
    expect(request?.question).toContain('File Changes: diff --git a/test.txt b/test.txt');
    expect(request?.question).toContain('+added line');

    // System prompt only has output schema, not custom template
    expect(request?.systemPrompt).toContain('You must respond with a single JSON object');
    expect(request?.systemPrompt).not.toContain(`Question: ${formattedQuestion}`);
  });

  it('deprecated _text aliases still resolve correctly', async () => {
    const formattedQuestion = 'What is 2+2?';
    const customPrompt = `
Question: {{input_text}}
Reference: {{expected_output_text}}
Candidate: {{output_text}}
`;

    const graderProvider = new CapturingProvider({
      text: JSON.stringify({
        score: 0.9,
        assertions: [{ text: 'OK', passed: true }],
      }),
    });

    const evaluator = new LlmGraderEvaluator({
      resolveGraderProvider: async () => graderProvider,
      evaluatorTemplate: customPrompt,
    });

    await evaluator.evaluate({
      evalCase: { ...baseTestCase, evaluator: 'llm-grader' },
      candidate: 'Four',
      target: baseTarget,
      provider: graderProvider,
      attempt: 0,
      promptInputs: { question: formattedQuestion },
      now: new Date(),
    });

    const request = graderProvider.lastRequest;
    expect(request).toBeDefined();

    // Deprecated aliases resolve to the same text values as the primary variables
    expect(request?.question).toContain(`Question: ${formattedQuestion}`);
    expect(request?.question).toContain('Reference: Reference Answer Text');
    expect(request?.question).toContain('Candidate: Four');
  });

  it('does not substitute if no variables are present', async () => {
    const customPrompt = 'Fixed prompt without variables';
    const promptQuestion = 'Summarize the latest logs without markers.';

    const graderProvider = new CapturingProvider({
      text: JSON.stringify({ score: 0.5, assertions: [] }),
    });

    const evaluator = new LlmGraderEvaluator({
      resolveGraderProvider: async () => graderProvider,
      evaluatorTemplate: customPrompt,
    });

    await evaluator.evaluate({
      evalCase: { ...baseTestCase, evaluator: 'llm-grader' },
      candidate: 'Answer',
      target: baseTarget,
      provider: graderProvider,
      attempt: 0,
      promptInputs: { question: promptQuestion },
      now: new Date(),
    });

    const request = graderProvider.lastRequest;

    // When custom evaluatorTemplate is provided, it goes in user prompt (question)
    expect(request?.question).toContain('Fixed prompt without variables');

    // System prompt only contains output schema, not custom template
    expect(request?.systemPrompt).toContain('You must respond with a single JSON object');
    expect(request?.systemPrompt).not.toContain(customPrompt);
  });

  it('substitutes template variables with whitespace inside braces', async () => {
    const formattedQuestion = 'What is the status?';
    const customPrompt = `
Question: {{ input }}
Outcome: {{ criteria }}
Reference: {{ expected_output }}
Candidate: {{ output }}
`;

    const graderProvider = new CapturingProvider({
      text: JSON.stringify({
        score: 0.8,
        assertions: [{ text: 'Good', passed: true }],
      }),
    });

    const evaluator = new LlmGraderEvaluator({
      resolveGraderProvider: async () => graderProvider,
      evaluatorTemplate: customPrompt,
    });

    const answer = 'Candidate Answer Text';

    await evaluator.evaluate({
      evalCase: { ...baseTestCase, evaluator: 'llm-grader' },
      candidate: answer,
      target: baseTarget,
      provider: graderProvider,
      attempt: 0,
      promptInputs: { question: formattedQuestion },
      now: new Date(),
    });

    const request = graderProvider.lastRequest;
    expect(request).toBeDefined();

    // Verify all variables were substituted despite whitespace
    expect(request?.question).toContain(`Question: ${formattedQuestion}`);
    expect(request?.question).toContain('Outcome: Expected Outcome Text');
    expect(request?.question).toContain('Reference: Reference Answer Text');
    expect(request?.question).toContain('Candidate: Candidate Answer Text');

    // Verify no unreplaced template markers remain
    expect(request?.question).not.toMatch(/\{\{\s*\w+\s*\}\}/);
  });

  it('preserves freeform details returned by the grader', async () => {
    const evaluator = new LlmGraderEvaluator({
      resolveGraderProvider: async () => undefined,
    });

    const result = (
      evaluator as unknown as {
        parseAgentResult: (
          text: string,
          rubrics: undefined,
          evaluatorRawRequest: Record<string, unknown>,
          details: Record<string, unknown>,
          graderTarget?: string,
        ) => { details?: Record<string, unknown> };
      }
    ).parseAgentResult(
      JSON.stringify({
        score: 0.75,
        assertions: [{ text: 'Context retained', passed: true }],
        details: {
          scores_per_turn: [1, 0.5],
          total_turns: 2,
        },
      }),
      undefined,
      { userPrompt: 'Prompt' },
      { mode: 'delegate' },
      'capturing',
    );

    expect(result.details).toEqual({
      mode: 'delegate',
      scores_per_turn: [1, 0.5],
      total_turns: 2,
    });
  });
});
