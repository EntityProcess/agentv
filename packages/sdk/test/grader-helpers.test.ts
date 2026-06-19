import { describe, expect, it } from 'bun:test';

import {
  codeGrader,
  containsGrader,
  defineEval,
  equalsGrader,
  exactGrader,
  graders,
  isJsonGrader,
  jsonGrader,
  llmGrader,
  regexGrader,
  rubricsGrader,
  serializeEvalYaml,
  toEvalYamlObject,
} from '../src/index.js';

describe('grader helper config builders', () => {
  it('returns existing AgentV assertion/evaluator config shapes', () => {
    expect(containsGrader('Hello')).toEqual({ type: 'contains', value: 'Hello' });
    expect(equalsGrader('exact answer', { name: 'exact-answer', minScore: 1 })).toEqual({
      name: 'exact-answer',
      type: 'equals',
      value: 'exact answer',
      minScore: 1,
    });
    expect(exactGrader('same answer')).toEqual({ type: 'equals', value: 'same answer' });
    expect(regexGrader(/hello\s+world/i, { name: 'hello-pattern' })).toEqual({
      name: 'hello-pattern',
      type: 'regex',
      value: 'hello\\s+world',
      flags: 'i',
    });
    expect(isJsonGrader({ required: true })).toEqual({ type: 'is-json', required: true });
    expect(jsonGrader()).toEqual({ type: 'is-json' });
    expect(rubricsGrader(['Mentions the greeting'], { weight: 2 })).toEqual({
      type: 'rubrics',
      criteria: ['Mentions the greeting'],
      weight: 2,
    });
    expect(
      llmGrader({
        name: 'tone-review',
        prompt: 'Grade the answer for tone.',
        target: 'grader-target',
        maxSteps: 3,
        temperature: 0,
      }),
    ).toEqual({
      name: 'tone-review',
      type: 'llm-grader',
      prompt: 'Grade the answer for tone.',
      target: 'grader-target',
      maxSteps: 3,
      temperature: 0,
    });
    expect(
      codeGrader(['bun', 'run', 'graders/check.ts'], {
        name: 'scripted-check',
        cwd: 'graders',
        target: { maxCalls: 2 },
        config: { mode: 'strict' },
      }),
    ).toEqual({
      name: 'scripted-check',
      type: 'code-grader',
      command: ['bun', 'run', 'graders/check.ts'],
      cwd: 'graders',
      target: { maxCalls: 2 },
      config: { mode: 'strict' },
    });
  });

  it('composes inside defineEval and serializes to canonical AgentV YAML assertions', () => {
    const suite = defineEval({
      name: 'grader-helper-suite',
      tests: [
        {
          id: 'helper-output',
          input: 'Return a JSON greeting.',
          assertions: [
            graders.contains('Hello', { name: 'mentions-hello' }),
            graders.exact('{"message":"Hello"}', { name: 'exact-json', minScore: 1 }),
            graders.regex(/"message"\s*:/, { name: 'message-key' }),
            graders.json({ name: 'valid-json', required: true }),
            graders.rubrics(
              [
                'Greets the user',
                {
                  id: 'quality',
                  outcome: 'The answer is concise and helpful.',
                  minScore: 0.8,
                  scoreRanges: [
                    { scoreRange: [0, 4], outcome: 'Weak' },
                    { scoreRange: [5, 10], outcome: 'Strong' },
                  ],
                },
              ],
              { name: 'rubric-review' },
            ),
            graders.llmGrader({
              name: 'llm-review',
              prompt: 'Grade whether the answer is useful.',
              target: 'grader-target',
              maxSteps: 2,
              rubrics: [
                {
                  id: 'useful',
                  outcome: 'The answer is useful.',
                  requiredMinScore: 8,
                },
              ],
            }),
            graders.codeGrader(['bun', 'run', 'graders/check.ts'], {
              name: 'scripted-check',
              target: { maxCalls: 2 },
              minScore: 0.5,
            }),
          ],
        },
      ],
    });

    const lowered = toEvalYamlObject(suite) as {
      tests: readonly [{ assertions: readonly Record<string, unknown>[] }];
    };

    expect(lowered.tests[0].assertions).toEqual([
      { name: 'mentions-hello', type: 'contains', value: 'Hello' },
      { name: 'exact-json', type: 'equals', value: '{"message":"Hello"}', min_score: 1 },
      { name: 'message-key', type: 'regex', value: '"message"\\s*:' },
      { name: 'valid-json', type: 'is-json', required: true },
      {
        name: 'rubric-review',
        type: 'rubrics',
        criteria: [
          'Greets the user',
          {
            id: 'quality',
            outcome: 'The answer is concise and helpful.',
            min_score: 0.8,
            score_ranges: [
              { score_range: [0, 4], outcome: 'Weak' },
              { score_range: [5, 10], outcome: 'Strong' },
            ],
          },
        ],
      },
      {
        name: 'llm-review',
        type: 'llm-grader',
        prompt: 'Grade whether the answer is useful.',
        target: 'grader-target',
        max_steps: 2,
        rubrics: [
          {
            id: 'useful',
            outcome: 'The answer is useful.',
            required_min_score: 8,
          },
        ],
      },
      {
        name: 'scripted-check',
        type: 'code-grader',
        command: ['bun', 'run', 'graders/check.ts'],
        target: { max_calls: 2 },
        min_score: 0.5,
      },
    ]);

    const yaml = serializeEvalYaml(suite);

    expect(yaml).toContain('assertions:');
    expect(yaml).toContain('type: llm-grader');
    expect(yaml).toContain('type: code-grader');
    expect(yaml).toContain('max_steps: 2');
    expect(yaml).toContain('max_calls: 2');
    expect(yaml).toContain('required_min_score: 8');
    expect(yaml).toContain('score_range:');
    expect(yaml).not.toContain('maxSteps');
    expect(yaml).not.toContain('maxCalls');
    expect(yaml).not.toContain('requiredMinScore');
    expect(yaml).not.toContain('scoreRange');
  });
});
