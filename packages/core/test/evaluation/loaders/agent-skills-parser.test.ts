import { describe, expect, it } from 'bun:test';
import path from 'node:path';

import {
  isAgentSkillsFormat,
  parseAgentSkillsEvals,
} from '../../../src/evaluation/loaders/agent-skills-parser.js';

const FIXTURE = {
  skill_name: 'csv-analyzer',
  evals: [
    {
      id: 1,
      prompt:
        'I have a CSV of monthly sales data in data/sales.csv. Find the top 3 months by revenue and make a bar chart.',
      expected_output:
        'A bar chart image showing the top 3 months by revenue, with labeled axes and values.',
      files: ['evals/files/sales.csv'],
      assertions: [
        'Output includes a bar chart image file',
        'Chart shows exactly 3 months',
        'Both axes are labeled',
      ],
    },
    {
      id: 2,
      prompt: 'Clean up customers.csv — some rows have missing emails',
      expected_output:
        'A cleaned CSV with missing emails handled, plus a count of how many were missing.',
    },
  ],
};

describe('isAgentSkillsFormat', () => {
  it('returns true for valid evals.json structure', () => {
    expect(isAgentSkillsFormat(FIXTURE)).toBe(true);
  });

  it('returns false for non-object', () => {
    expect(isAgentSkillsFormat(null)).toBe(false);
    expect(isAgentSkillsFormat('string')).toBe(false);
    expect(isAgentSkillsFormat(42)).toBe(false);
  });

  it('returns false when evals is missing', () => {
    expect(isAgentSkillsFormat({ skill_name: 'foo' })).toBe(false);
  });

  it('returns false when evals is not an array', () => {
    expect(isAgentSkillsFormat({ evals: 'not-array' })).toBe(false);
  });
});

describe('parseAgentSkillsEvals', () => {
  it('parses the full fixture into EvalTest[]', () => {
    const tests = parseAgentSkillsEvals(FIXTURE);
    expect(tests).toHaveLength(2);
  });

  it('converts numeric id to string', () => {
    const tests = parseAgentSkillsEvals(FIXTURE);
    expect(tests[0].id).toBe('1');
    expect(tests[1].id).toBe('2');
  });

  it('promotes prompt to input message array', () => {
    const tests = parseAgentSkillsEvals(FIXTURE);
    expect(tests[0].input).toEqual([
      {
        role: 'user',
        content:
          'I have a CSV of monthly sales data in data/sales.csv. Find the top 3 months by revenue and make a bar chart.',
      },
    ]);
  });

  it('promotes expected_output to output message array', () => {
    const tests = parseAgentSkillsEvals(FIXTURE);
    expect(tests[0].expected_output).toEqual([
      {
        role: 'assistant',
        content:
          'A bar chart image showing the top 3 months by revenue, with labeled axes and values.',
      },
    ]);
  });

  it('sets reference_answer from expected_output', () => {
    const tests = parseAgentSkillsEvals(FIXTURE);
    expect(tests[0].reference_answer).toBe(
      'A bar chart image showing the top 3 months by revenue, with labeled axes and values.',
    );
  });

  it('promotes assertions to llm-grader evaluators', () => {
    const tests = parseAgentSkillsEvals(FIXTURE);
    const assertions = tests[0].assertions;
    expect(assertions).toHaveLength(3);
    expect(assertions?.[0]).toEqual({
      name: 'assertion-1',
      type: 'llm-grader',
      prompt: 'Output includes a bar chart image file',
    });
    expect(assertions?.[1]).toEqual({
      name: 'assertion-2',
      type: 'llm-grader',
      prompt: 'Chart shows exactly 3 months',
    });
    expect(assertions?.[2]).toEqual({
      name: 'assertion-3',
      type: 'llm-grader',
      prompt: 'Both axes are labeled',
    });
  });

  it('stores files in metadata.agent_skills_files', () => {
    const tests = parseAgentSkillsEvals(FIXTURE);
    expect(tests[0].metadata?.agent_skills_files).toEqual(['evals/files/sales.csv']);
  });

  it('stores skill_name in metadata', () => {
    const tests = parseAgentSkillsEvals(FIXTURE);
    expect(tests[0].metadata?.skill_name).toBe('csv-analyzer');
    expect(tests[1].metadata?.skill_name).toBe('csv-analyzer');
  });

  it('handles test case without assertions or files', () => {
    const tests = parseAgentSkillsEvals(FIXTURE);
    const test2 = tests[1];
    expect(test2.assertions).toBeUndefined();
    expect(test2.metadata?.agent_skills_files).toBeUndefined();
  });

  it('sets criteria from expected_output', () => {
    const tests = parseAgentSkillsEvals(FIXTURE);
    expect(tests[0].criteria).toBe(
      'A bar chart image showing the top 3 months by revenue, with labeled axes and values.',
    );
  });

  it('sets question from prompt', () => {
    const tests = parseAgentSkillsEvals(FIXTURE);
    expect(tests[0].question).toBe(
      'I have a CSV of monthly sales data in data/sales.csv. Find the top 3 months by revenue and make a bar chart.',
    );
  });

  it('initializes empty arrays for file_paths when no baseDir', () => {
    const tests = parseAgentSkillsEvals(FIXTURE);
    expect(tests[0].file_paths).toEqual([]);
  });

  it('resolves file_paths relative to baseDir when provided', () => {
    const tests = parseAgentSkillsEvals(FIXTURE, 'evals.json', '/project/skills/csv-analyzer');
    expect(tests[0].file_paths).toEqual([
      path.resolve('/project/skills/csv-analyzer', 'evals/files/sales.csv'),
    ]);
  });

  it('stores agent_skills_base_dir in metadata when baseDir provided', () => {
    const tests = parseAgentSkillsEvals(FIXTURE, 'evals.json', '/project/skills/csv-analyzer');
    expect(tests[0].metadata?.agent_skills_base_dir).toBe('/project/skills/csv-analyzer');
  });

  it('does not resolve file_paths when baseDir is not provided', () => {
    const tests = parseAgentSkillsEvals(FIXTURE);
    expect(tests[0].file_paths).toEqual([]);
    expect(tests[0].metadata?.agent_skills_base_dir).toBeUndefined();
  });

  it('still stores agent_skills_files in metadata without baseDir', () => {
    const tests = parseAgentSkillsEvals(FIXTURE);
    expect(tests[0].metadata?.agent_skills_files).toEqual(['evals/files/sales.csv']);
  });

  it('throws on missing evals array', () => {
    expect(() => parseAgentSkillsEvals({ skill_name: 'test' })).toThrow(
      "Invalid Agent Skills evals.json: missing 'evals' array",
    );
  });

  it('throws on empty evals array', () => {
    expect(() => parseAgentSkillsEvals({ evals: [] })).toThrow(
      "Invalid Agent Skills evals.json: 'evals' array is empty",
    );
  });

  it('skips test case with missing prompt', () => {
    const data = {
      evals: [
        { id: 1, expected_output: 'something' },
        { id: 2, prompt: 'valid prompt' },
      ],
    };
    const tests = parseAgentSkillsEvals(data);
    expect(tests).toHaveLength(1);
    expect(tests[0].id).toBe('2');
  });

  it('skips test case with empty prompt', () => {
    const data = {
      evals: [
        { id: 1, prompt: '   ' },
        { id: 2, prompt: 'valid prompt' },
      ],
    };
    const tests = parseAgentSkillsEvals(data);
    expect(tests).toHaveLength(1);
    expect(tests[0].id).toBe('2');
  });

  it('works without skill_name', () => {
    const data = {
      evals: [{ id: 1, prompt: 'test prompt' }],
    };
    const tests = parseAgentSkillsEvals(data);
    expect(tests).toHaveLength(1);
    expect(tests[0].metadata).toBeUndefined();
  });

  it('includes source in error messages', () => {
    expect(() => parseAgentSkillsEvals({}, 'my-evals.json')).toThrow('my-evals.json');
  });
});
