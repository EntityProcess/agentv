import { describe, expect, it } from 'bun:test';

import { SkillUsedGrader } from '../../../src/evaluation/graders/skill-used.js';
import type { EvaluationContext } from '../../../src/evaluation/graders/types.js';
import type { SkillUsedGraderConfig } from '../../../src/evaluation/types.js';

const baseContext: EvaluationContext = {
  evalCase: {
    id: 'case-1',
    question: 'Use a skill',
    input: [{ role: 'user', content: 'Use a skill' }],
    expected_output: [],
    reference_answer: '',
    file_paths: [],
    criteria: '',
  },
  candidate: 'done',
  target: { name: 'mock', kind: 'mock', config: {} },
  provider: {
    id: 'mock',
    kind: 'mock',
    targetName: 'mock',
    async invoke() {
      return { output: [{ role: 'assistant', content: 'ok' }] };
    },
  },
  attempt: 0,
  promptInputs: { question: 'Use a skill' },
  now: new Date('2026-07-06T00:00:00Z'),
  responseMetadata: {
    skill_calls: [
      { name: 'csv-analyzer', source: 'tool', path: '.agents/skills/csv-analyzer/SKILL.md' },
      { name: 'web-search', source: 'tool' },
      { name: 'broken-skill', source: 'tool', isError: true },
      { name: 'legacy-error', source: 'tool', is_error: true },
    ],
  },
};

function run(overrides: Partial<SkillUsedGraderConfig>) {
  const config: SkillUsedGraderConfig = {
    name: 'skill',
    type: 'skill-used',
    value: 'csv-analyzer',
    ...overrides,
  };
  return new SkillUsedGrader(config).evaluate(baseContext);
}

describe('SkillUsedGrader', () => {
  it('passes for a required skill string from normalized metadata', () => {
    const result = run({ value: 'csv-analyzer' });

    expect(result.verdict).toBe('pass');
    expect(result.score).toBe(1);
  });

  it('requires all skills in a string array', () => {
    expect(run({ value: ['csv-analyzer', 'web-search'] }).verdict).toBe('pass');
    expect(run({ value: ['csv-analyzer', 'missing-skill'] }).verdict).toBe('fail');
  });

  it('supports object name counts and glob pattern counts', () => {
    expect(run({ value: { name: 'csv-analyzer', min: 1, max: 1 } }).verdict).toBe('pass');
    expect(run({ value: { pattern: '*SEARCH', min: 1 } }).verdict).toBe('pass');
    expect(run({ value: { pattern: '*search', min: 2 } }).verdict).toBe('fail');
  });

  it('ignores errored skill calls', () => {
    expect(run({ value: 'broken-skill' }).verdict).toBe('fail');
    expect(run({ value: { pattern: '*error', min: 1 } }).verdict).toBe('fail');
  });

  it('supports not-skill-used inverse behavior', () => {
    expect(run({ type: 'not-skill-used', value: 'missing-skill' }).verdict).toBe('pass');
    expect(run({ type: 'not-skill-used', value: 'csv-analyzer' }).verdict).toBe('fail');
    expect(run({ type: 'not-skill-used', value: { pattern: 'missing-*', max: 0 } }).verdict).toBe(
      'pass',
    );
  });

  it('rejects not-skill-used object count bounds other than max zero', () => {
    expect(() => run({ type: 'not-skill-used', value: { name: 'csv-analyzer', min: 1 } })).toThrow(
      /not-skill-used object assertions only support/,
    );
  });

  it('does not scan output tool calls when normalized skill metadata is absent', () => {
    const config: SkillUsedGraderConfig = {
      name: 'skill',
      type: 'skill-used',
      value: 'csv-analyzer',
    };
    const result = new SkillUsedGrader(config).evaluate({
      ...baseContext,
      responseMetadata: undefined,
      output: [
        {
          role: 'assistant',
          toolCalls: [{ tool: 'Skill', input: { skill: 'csv-analyzer' } }],
        },
      ],
    });

    expect(result.verdict).toBe('fail');
    expect(result.assertions[0].text).toContain('Actual skills: (none)');
  });
});
