import { describe, expect, it } from 'bun:test';

import { LlmJudgeEvaluator } from '../../src/evaluation/evaluators.js';
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
  input: [{ role: 'user', content: 'User Input Message' }],
  input_segments: [{ type: 'text', value: 'Input Message' }],
  expected_output: [{ type: 'text', value: 'Expected Output Message' }],
  reference_answer: 'Reference Answer Text',
  guideline_paths: [],
  file_paths: [],
  criteria: 'Expected Outcome Text',
  evaluator: 'llm-judge',
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
Outcome: {{criteria}}
Reference: {{reference_answer}}
Candidate: {{answer}}
Input Messages: {{input}}
Expected Messages: {{expected_output}}
File Changes: {{file_changes}}
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

    const answer = 'Candidate Answer Text';

    await evaluator.evaluate({
      evalCase: { ...baseTestCase, evaluator: 'llm-judge' },
      candidate: answer,
      target: baseTarget,
      provider: judgeProvider,
      attempt: 0,
      promptInputs: { question: formattedQuestion, guidelines: '' },
      now: new Date(),
      fileChanges: 'diff --git a/test.txt b/test.txt\n+added line',
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

    // Verify input JSON stringification (includes role annotations)
    expect(request?.question).toContain('Input Messages: [');
    expect(request?.question).toContain('"role": "user"');
    expect(request?.question).toContain('"content": "User Input Message"');

    // Verify expected_output JSON stringification
    expect(request?.question).toContain('Expected Messages: [');
    expect(request?.question).toContain('"value": "Expected Output Message"');

    // Verify file_changes substitution
    expect(request?.question).toContain('File Changes: diff --git a/test.txt b/test.txt');
    expect(request?.question).toContain('+added line');

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
      evalCase: { ...baseTestCase, evaluator: 'llm-judge' },
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
Outcome: {{ criteria }}
Reference: {{ reference_answer }}
Candidate: {{ answer }}
Input Messages: {{ input }}
Expected Messages: {{ expected_output }}
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

    const answer = 'Candidate Answer Text';

    await evaluator.evaluate({
      evalCase: { ...baseTestCase, evaluator: 'llm-judge' },
      candidate: answer,
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

    // Verify JSON stringified variables were also substituted (includes role annotations)
    expect(request?.question).toContain('Input Messages: [');
    expect(request?.question).toContain('"content": "User Input Message"');
    expect(request?.question).toContain('Expected Messages: [');
    expect(request?.question).toContain('"value": "Expected Output Message"');

    // Verify no unreplaced template markers remain
    expect(request?.question).not.toMatch(/\{\{\s*\w+\s*\}\}/);
  });

  it('resolves file references in {{ input }} using input_segments content', async () => {
    const testCaseWithFiles: EvalTest = {
      ...baseTestCase,
      input: [
        {
          role: 'user',
          content: [
            { type: 'file', value: 'src/app.ts' },
            { type: 'text', value: 'Review this code' },
          ],
        },
      ],
      input_segments: [
        { type: 'file', path: 'src/app.ts', text: 'console.log("hello world");' },
        { type: 'text', value: 'Review this code' },
      ],
    };

    const customPrompt = `Input: {{ input }}`;

    const judgeProvider = new CapturingProvider({
      text: JSON.stringify({
        score: 0.9,
        hits: ['Good'],
        misses: [],
        reasoning: 'OK',
      }),
    });

    const evaluator = new LlmJudgeEvaluator({
      resolveJudgeProvider: async () => judgeProvider,
      evaluatorTemplate: customPrompt,
    });

    await evaluator.evaluate({
      evalCase: { ...testCaseWithFiles, evaluator: 'llm-judge' },
      candidate: 'Looks good',
      target: baseTarget,
      provider: judgeProvider,
      attempt: 0,
      promptInputs: { question: 'Review this code', guidelines: '' },
      now: new Date(),
    });

    const request = judgeProvider.lastRequest;
    expect(request).toBeDefined();

    // File content from input_segments should be resolved into the {{ input }} variable
    // Content is JSON-stringified so quotes are escaped
    expect(request?.question).toContain('console.log');
    expect(request?.question).toContain('hello world');
    // The resolved segment should have a "text" field with the file content
    expect(request?.question).toContain('"text"');
    // Original file path should still be present
    expect(request?.question).toContain('src/app.ts');
  });
});
