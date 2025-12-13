import { describe, expect, it } from 'vitest';

import { LlmJudgeEvaluator } from '../../src/evaluation/evaluators.js';
import type { ResolvedTarget } from '../../src/evaluation/providers/targets.js';
import type {
  Provider,
  ProviderRequest,
  ProviderResponse,
} from '../../src/evaluation/providers/types.js';
import type { EvalCase } from '../../src/evaluation/types.js';

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
  question: 'Original Question Text',
  input_messages: [{ role: 'user', content: 'User Input Message' }],
  input_segments: [{ type: 'text', value: 'Input Message' }],
  expected_segments: [{ type: 'text', value: 'Expected Output Message' }],
  reference_answer: 'Reference Answer Text',
  guideline_paths: [],
  file_paths: [],
  code_snippets: [],
  expected_outcome: 'Expected Outcome Text',
  evaluator: 'llm_judge',
};

const baseTarget: ResolvedTarget = {
  kind: 'mock',
  name: 'mock',
  config: { response: '{}' },
};

describe('LlmJudgeEvaluator Variable Substitution', () => {
  it('substitutes template variables in custom prompt', async () => {
    const formattedQuestion = '@[User]: What is the status?\n\n@[Assistant]: Requesting more info.';
    const customPrompt = `
Question: {{question}}
Outcome: {{expected_outcome}}
Reference: {{reference_answer}}
Candidate: {{candidate_answer}}
Input Messages: {{input_messages}}
Expected Messages: {{expected_messages}}
`;

    const judgeProvider = new CapturingProvider({
      text: JSON.stringify({
        score: 0.8,
        hits: ['Good'],
        misses: [],
        reasoning: 'Reasoning',
      }),
    });

    const evaluator = new LlmJudgeEvaluator({
      resolveJudgeProvider: async () => judgeProvider,
      evaluatorTemplate: customPrompt,
    });

    const candidateAnswer = 'Candidate Answer Text';

    await evaluator.evaluate({
      evalCase: { ...baseTestCase, evaluator: 'llm_judge' },
      candidate: candidateAnswer,
      target: baseTarget,
      provider: judgeProvider,
      attempt: 0,
      promptInputs: { question: formattedQuestion, guidelines: '' },
      now: new Date(),
    });

    const request = judgeProvider.lastRequest;
    expect(request).toBeDefined();

    // When custom evaluatorTemplate is provided, it goes in the user prompt (question)
    // System prompt only contains the output schema
    expect(request?.question).toContain(`Question: ${formattedQuestion}`);
    expect(request?.question).not.toContain('Original Question Text');
    expect(request?.question).toContain('Outcome: Expected Outcome Text');
    expect(request?.question).toContain('Reference: Reference Answer Text');
    expect(request?.question).toContain('Candidate: Candidate Answer Text');

    // Verify input_messages JSON stringification
    expect(request?.question).toContain('Input Messages: [');
    expect(request?.question).toContain('"value": "Input Message"');

    // Verify expected_messages JSON stringification
    expect(request?.question).toContain('Expected Messages: [');
    expect(request?.question).toContain('"value": "Expected Output Message"');

    // System prompt only has output schema, not custom template
    expect(request?.systemPrompt).toContain('You must respond with a single JSON object');
    expect(request?.systemPrompt).not.toContain(`Question: ${formattedQuestion}`);
  });

  it('does not substitute if no variables are present', async () => {
    const customPrompt = 'Fixed prompt without variables';
    const promptQuestion = 'Summarize the latest logs without markers.';

    const judgeProvider = new CapturingProvider({
      text: JSON.stringify({ score: 0.5, hits: [], misses: [] }),
    });

    const evaluator = new LlmJudgeEvaluator({
      resolveJudgeProvider: async () => judgeProvider,
      evaluatorTemplate: customPrompt,
    });

    await evaluator.evaluate({
      evalCase: { ...baseTestCase, evaluator: 'llm_judge' },
      candidate: 'Answer',
      target: baseTarget,
      provider: judgeProvider,
      attempt: 0,
      promptInputs: { question: promptQuestion, guidelines: '' },
      now: new Date(),
    });

    const request = judgeProvider.lastRequest;

    // When custom evaluatorTemplate is provided, it goes in user prompt (question)
    expect(request?.question).toContain('Fixed prompt without variables');

    // System prompt only contains output schema, not custom template
    expect(request?.systemPrompt).toContain('You must respond with a single JSON object');
    expect(request?.systemPrompt).not.toContain(customPrompt);
  });

  it('substitutes template variables with whitespace inside braces', async () => {
    const formattedQuestion = 'What is the status?';
    const customPrompt = `
Question: {{ question }}
Outcome: {{ expected_outcome }}
Reference: {{ reference_answer }}
Candidate: {{ candidate_answer }}
Input Messages: {{ input_messages }}
Expected Messages: {{ expected_messages }}
`;

    const judgeProvider = new CapturingProvider({
      text: JSON.stringify({
        score: 0.8,
        hits: ['Good'],
        misses: [],
        reasoning: 'Reasoning',
      }),
    });

    const evaluator = new LlmJudgeEvaluator({
      resolveJudgeProvider: async () => judgeProvider,
      evaluatorTemplate: customPrompt,
    });

    const candidateAnswer = 'Candidate Answer Text';

    await evaluator.evaluate({
      evalCase: { ...baseTestCase, evaluator: 'llm_judge' },
      candidate: candidateAnswer,
      target: baseTarget,
      provider: judgeProvider,
      attempt: 0,
      promptInputs: { question: formattedQuestion, guidelines: '' },
      now: new Date(),
    });

    const request = judgeProvider.lastRequest;
    expect(request).toBeDefined();

    // Verify all variables were substituted despite whitespace
    expect(request?.question).toContain(`Question: ${formattedQuestion}`);
    expect(request?.question).toContain('Outcome: Expected Outcome Text');
    expect(request?.question).toContain('Reference: Reference Answer Text');
    expect(request?.question).toContain('Candidate: Candidate Answer Text');

    // Verify JSON stringified variables were also substituted
    expect(request?.question).toContain('Input Messages: [');
    expect(request?.question).toContain('"value": "Input Message"');
    expect(request?.question).toContain('Expected Messages: [');
    expect(request?.question).toContain('"value": "Expected Output Message"');

    // Verify no unreplaced template markers remain
    expect(request?.question).not.toMatch(/\{\{\s*\w+\s*\}\}/);
  });
});
