import { describe, expect, it } from 'bun:test';

import {
  containsGrader,
  defineEval,
  equalsGrader,
  exactGrader,
  graders,
  isJsonGrader,
  jsonGrader,
  llmRubricGrader,
  regexGrader,
  scriptGrader,
  serializeEvalYaml,
  toEvalYamlObject,
} from '../src/index.js';

describe('grader helper config builders', () => {
  it('returns existing AgentV assertion/evaluator config shapes', () => {
    expect(containsGrader('Hello')).toEqual({ type: 'contains', value: 'Hello' });
    expect(
      equalsGrader('exact answer', {
        metric: 'exact-answer',
        minScore: 1,
        transform: 'output.trim()',
      }),
    ).toEqual({
      metric: 'exact-answer',
      type: 'equals',
      value: 'exact answer',
      minScore: 1,
      transform: 'output.trim()',
    });
    expect(exactGrader('same answer')).toEqual({ type: 'equals', value: 'same answer' });
    expect(regexGrader(/hello\s+world/i, { metric: 'hello-pattern' })).toEqual({
      metric: 'hello-pattern',
      type: 'regex',
      value: 'hello\\s+world',
      flags: 'i',
    });
    expect(isJsonGrader({ required: true })).toEqual({ type: 'is-json', required: true });
    expect(jsonGrader()).toEqual({ type: 'is-json' });
    expect(llmRubricGrader(['Mentions the greeting'], { weight: 2 })).toEqual({
      type: 'llm-rubric',
      value: ['Mentions the greeting'],
      weight: 2,
    });
    expect(
      llmRubricGrader(undefined, {
        metric: 'tone-review',
        prompt: 'Grade the answer for tone.',
        target: 'grader-target',
        maxSteps: 3,
        temperature: 0,
      }),
    ).toEqual({
      metric: 'tone-review',
      type: 'llm-rubric',
      prompt: 'Grade the answer for tone.',
      target: 'grader-target',
      maxSteps: 3,
      temperature: 0,
    });
    expect(
      scriptGrader(['bun', 'run', 'graders/check.ts'], {
        metric: 'scripted-check',
        cwd: 'graders',
        target: { maxCalls: 2 },
        config: { mode: 'strict' },
      }),
    ).toEqual({
      metric: 'scripted-check',
      type: 'script',
      command: ['bun', 'run', 'graders/check.ts'],
      cwd: 'graders',
      target: { maxCalls: 2 },
      config: { mode: 'strict' },
    });
    expect(scriptGrader(['bun', 'run', 'graders/check.ts'])).toEqual({
      type: 'script',
      command: ['bun', 'run', 'graders/check.ts'],
    });
  });

  it('composes inside defineEval and serializes to canonical AgentV YAML assert entries', () => {
    const suite = defineEval({
      name: 'grader-helper-suite',
      prompts: ['{{ input }}'],
      tests: [
        {
          id: 'helper-output',
          vars: { input: 'Return a JSON greeting.' },
          assert: [
            graders.contains('Hello', { metric: 'mentions-hello' }),
            graders.exact('{"message":"Hello"}', { metric: 'exact-json', minScore: 1 }),
            graders.regex(/"message"\s*:/, { metric: 'message-key' }),
            graders.json({ metric: 'valid-json', required: true }),
            graders.llmRubric(
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
              { metric: 'rubric-review' },
            ),
            graders.llmRubric(undefined, {
              metric: 'llm-review',
              prompt: 'Grade whether the answer is useful.',
              target: 'grader-target',
              maxSteps: 2,
              transform: 'output.trim()',
            }),
            graders.script(['bun', 'run', 'graders/check.ts'], {
              metric: 'scripted-check',
              target: { maxCalls: 2 },
              minScore: 0.5,
            }),
          ],
        },
      ],
    });

    const lowered = toEvalYamlObject(suite) as {
      tests: readonly [{ assert: readonly Record<string, unknown>[] }];
    };

    expect(lowered.tests[0].assert).toEqual([
      { metric: 'mentions-hello', type: 'contains', value: 'Hello' },
      { metric: 'exact-json', type: 'equals', value: '{"message":"Hello"}', min_score: 1 },
      { metric: 'message-key', type: 'regex', value: '"message"\\s*:' },
      { metric: 'valid-json', type: 'is-json', required: true },
      {
        metric: 'rubric-review',
        type: 'llm-rubric',
        value: [
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
        metric: 'llm-review',
        type: 'llm-rubric',
        prompt: 'Grade whether the answer is useful.',
        target: 'grader-target',
        max_steps: 2,
        transform: 'output.trim()',
      },
      {
        metric: 'scripted-check',
        type: 'script',
        command: ['bun', 'run', 'graders/check.ts'],
        target: { max_calls: 2 },
        min_score: 0.5,
      },
    ]);

    const yaml = serializeEvalYaml(suite);

    expect(yaml).toContain('assert:');
    expect(yaml).toContain('metric: mentions-hello');
    expect(yaml).toContain('type: llm-rubric');
    expect(yaml).toContain('type: script');
    expect(yaml).toContain('max_steps: 2');
    expect(yaml).toContain('transform: output.trim()');
    expect(yaml).toContain('max_calls: 2');
    expect(yaml).toContain('min_score: 0.8');
    expect(yaml).toContain('score_range:');
    expect(yaml).not.toContain('maxSteps');
    expect(yaml).not.toContain('maxCalls');
    expect(yaml).not.toContain('requiredMinScore');
    expect(yaml).not.toContain('required_min_score');
    expect(yaml).not.toContain('scoreRange');
  });
});
