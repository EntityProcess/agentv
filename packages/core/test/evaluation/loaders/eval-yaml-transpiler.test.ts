import { describe, expect, it } from 'bun:test';

import {
  getOutputFilenames,
  transpileEvalYaml,
} from '../../../src/evaluation/loaders/eval-yaml-transpiler.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SINGLE_SKILL_SUITE = {
  tests: [
    {
      id: 'csv-top-months',
      input: [
        {
          role: 'user',
          content: [
            { type: 'file', value: 'evals/files/sales.csv' },
            {
              type: 'text',
              value: 'I have a CSV of monthly sales data. Find the top 3 months by revenue.',
            },
          ],
        },
      ],
      expected_output:
        'The top 3 months by revenue are November ($22,500), September ($20,100), and December ($19,400).',
      assert: [
        { type: 'skill-used', value: 'csv-analyzer' },
        { type: 'llm-rubric', value: 'Agent finds the top 3 months by revenue' },
        { type: 'llm-rubric', value: 'Output identifies November as the highest revenue month' },
        { type: 'contains', value: '$22,500' },
      ],
    },
    {
      id: 'irrelevant-query',
      input: 'What time is it?',
      assert: [{ type: 'not-skill-used', value: 'csv-analyzer' }],
    },
  ],
};

// ---------------------------------------------------------------------------
// Basic transpilation
// ---------------------------------------------------------------------------

describe('transpileEvalYaml — basic', () => {
  it('produces one evals.json for a single-skill suite', () => {
    const { files } = transpileEvalYaml(SINGLE_SKILL_SUITE);
    expect(files.size).toBe(1);
    expect(files.has('csv-analyzer')).toBe(true);
  });

  it('sets skill_name correctly', () => {
    const { files } = transpileEvalYaml(SINGLE_SKILL_SUITE);
    expect(files.get('csv-analyzer')?.skill_name).toBe('csv-analyzer');
  });

  it('produces two evals in output', () => {
    const { files } = transpileEvalYaml(SINGLE_SKILL_SUITE);
    expect(files.get('csv-analyzer')?.evals).toHaveLength(2);
  });

  it('assigns 1-based numeric ids', () => {
    const { files } = transpileEvalYaml(SINGLE_SKILL_SUITE);
    const evals = files.get('csv-analyzer')?.evals;
    expect(evals[0].id).toBe(1);
    expect(evals[1].id).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Input extraction
// ---------------------------------------------------------------------------

describe('transpileEvalYaml — input extraction', () => {
  it('extracts prompt from content block (type: text)', () => {
    const { files } = transpileEvalYaml(SINGLE_SKILL_SUITE);
    const evals = files.get('csv-analyzer')?.evals;
    expect(evals[0].prompt).toBe(
      'I have a CSV of monthly sales data. Find the top 3 months by revenue.',
    );
  });

  it('extracts files from content block (type: file)', () => {
    const { files } = transpileEvalYaml(SINGLE_SKILL_SUITE);
    const evals = files.get('csv-analyzer')?.evals;
    expect(evals[0].files).toEqual(['evals/files/sales.csv']);
  });

  it('handles string input shorthand', () => {
    const { files } = transpileEvalYaml(SINGLE_SKILL_SUITE);
    const evals = files.get('csv-analyzer')?.evals;
    expect(evals[1].prompt).toBe('What time is it?');
  });

  it('does not include files when none present', () => {
    const { files } = transpileEvalYaml(SINGLE_SKILL_SUITE);
    const evals = files.get('csv-analyzer')?.evals;
    expect(evals[1].files).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Trigger-grader handling
// ---------------------------------------------------------------------------

describe('transpileEvalYaml — skill-used', () => {
  it('sets should_trigger: true for skill-used', () => {
    const { files } = transpileEvalYaml(SINGLE_SKILL_SUITE);
    const evals = files.get('csv-analyzer')?.evals;
    expect(evals[0].should_trigger).toBe(true);
  });

  it('sets should_trigger: false for not-skill-used', () => {
    const { files } = transpileEvalYaml(SINGLE_SKILL_SUITE);
    const evals = files.get('csv-analyzer')?.evals;
    expect(evals[1].should_trigger).toBe(false);
  });

  it('omits should_trigger when no skill-use assertion is present', () => {
    const suite = {
      tests: [
        {
          id: 'no-trigger',
          input: 'Hello',
          assert: [{ type: 'contains', value: 'Hi' }],
        },
      ],
    };
    const { files } = transpileEvalYaml(suite);
    // No skill: goes to _no-skill (or dominant skill if set)
    const allFiles = [...files.values()];
    expect(allFiles).toHaveLength(1);
    expect(allFiles[0].evals[0].should_trigger).toBeUndefined();
  });

  it('skill-used is NOT included in assertions array', () => {
    const { files } = transpileEvalYaml(SINGLE_SKILL_SUITE);
    const evals = files.get('csv-analyzer')?.evals;
    // assertions should contain NL items, not deterministic skill-use literals.
    for (const a of evals[0].assertions) {
      expect(a).not.toContain('skill-used');
    }
  });

  it('rejects stale skill-trigger assertions with migration guidance', () => {
    expect(() =>
      transpileEvalYaml({
        tests: [
          {
            id: 'stale',
            input: 'Use this skill',
            assert: [{ type: 'skill-trigger', skill: 'csv-analyzer', should_trigger: true }],
          },
        ],
      }),
    ).toThrow('Replace skill: csv-analyzer with type: skill-used, value: csv-analyzer');
  });
});

// ---------------------------------------------------------------------------
// NL assertion conversion
// ---------------------------------------------------------------------------

describe('transpileEvalYaml — NL assertions', () => {
  it('converts explicit llm-rubric assertions', () => {
    const { files } = transpileEvalYaml(SINGLE_SKILL_SUITE);
    const evals = files.get('csv-analyzer')?.evals;
    expect(evals[0].assertions[0]).toBe('Agent finds the top 3 months by revenue');
  });

  it('rejects test-level criteria combined with assert entries', () => {
    expect(() =>
      transpileEvalYaml(
        {
          tests: [
            {
              id: 'mixed',
              criteria: 'Describe the expected behavior',
              input: 'test',
              assert: [{ type: 'contains', value: 'ok' }],
            },
          ],
        },
        'mixed.eval.yaml',
      ),
    ).toThrow(
      "do not combine test-level 'criteria' with 'assert'. Put human-readable case descriptions in 'description'",
    );
  });

  it('accepts description with assert entries without adding a grading assertion', () => {
    const { files } = transpileEvalYaml({
      tests: [
        {
          id: 'described',
          description: 'Human-facing case label',
          input: 'test',
          assert: [{ type: 'llm-rubric', value: 'Answer clearly' }],
        },
      ],
    });

    const evals = files.get('_no-skill')?.evals;
    expect(evals[0].assertions).toEqual(['Answer clearly']);
    expect(evals[0].assertions).not.toContain('Human-facing case label');
  });

  it('keeps legacy criteria-only tests as natural-language assertions', () => {
    const { files } = transpileEvalYaml({
      tests: [{ id: 'legacy', criteria: 'Answer clearly', input: 'test' }],
    });

    const evals = files.get('_no-skill')?.evals;
    expect(evals[0].assertions).toEqual(['Answer clearly']);
  });

  it('converts rubrics type to criteria string', () => {
    const { files } = transpileEvalYaml(SINGLE_SKILL_SUITE);
    const evals = files.get('csv-analyzer')?.evals;
    expect(evals[0].assertions).toContain(
      'Output identifies November as the highest revenue month',
    );
  });

  it('converts contains to NL', () => {
    const { files } = transpileEvalYaml(SINGLE_SKILL_SUITE);
    const evals = files.get('csv-analyzer')?.evals;
    expect(evals[0].assertions).toContain("Output contains '$22,500'");
  });

  it('converts regex to NL', () => {
    const suite = {
      tests: [
        {
          id: 't1',
          input: 'test',
          assert: [
            { type: 'skill-used', value: 's' },
            { type: 'regex', value: '\\d{4}-\\d{2}-\\d{2}' },
          ],
        },
      ],
    };
    const { files } = transpileEvalYaml(suite);
    const evals = files.get('s')?.evals;
    expect(evals[0].assertions).toContain('Output matches regex: \\d{4}-\\d{2}-\\d{2}');
  });

  it('converts equals to NL', () => {
    const suite = {
      tests: [
        {
          id: 't1',
          input: 'test',
          assert: [
            { type: 'skill-used', value: 's' },
            { type: 'equals', value: 'exact answer' },
          ],
        },
      ],
    };
    const { files } = transpileEvalYaml(suite);
    const evals = files.get('s')?.evals;
    expect(evals[0].assertions).toContain('Output exactly equals: exact answer');
  });

  it('converts is-json to NL', () => {
    const suite = {
      tests: [
        {
          id: 't1',
          input: 'test',
          assert: [{ type: 'skill-used', value: 's' }, { type: 'is-json' }],
        },
      ],
    };
    const { files } = transpileEvalYaml(suite);
    const evals = files.get('s')?.evals;
    expect(evals[0].assertions).toContain('Output is valid JSON');
  });

  it('converts llm-grader prompt to NL', () => {
    const suite = {
      tests: [
        {
          id: 't1',
          input: 'test',
          assert: [
            { type: 'skill-used', value: 's' },
            { type: 'llm-grader', prompt: 'The answer is clear and concise' },
          ],
        },
      ],
    };
    const { files } = transpileEvalYaml(suite);
    const evals = files.get('s')?.evals;
    expect(evals[0].assertions).toContain('The answer is clear and concise');
  });

  it('converts llm-grader with rubrics to multiple assertions (rubrics variant)', () => {
    const suite = {
      tests: [
        {
          id: 't1',
          input: 'test',
          assert: [
            { type: 'skill-used', value: 's' },
            {
              type: 'llm-grader',
              rubrics: [
                { id: 'r1', outcome: 'Correct result returned' },
                { id: 'r2', outcome: 'No unnecessary steps' },
              ],
            },
          ],
        },
      ],
    };
    const { files } = transpileEvalYaml(suite);
    const evals = files.get('s')?.evals;
    expect(evals[0].assertions).toContain('Correct result returned');
    expect(evals[0].assertions).toContain('No unnecessary steps');
  });

  it('converts llm-grader with rubrics to multiple assertions', () => {
    const suite = {
      tests: [
        {
          id: 't1',
          input: 'test',
          assert: [
            { type: 'skill-used', value: 's' },
            {
              type: 'llm-grader',
              rubrics: [
                { id: 'r1', outcome: 'Response is accurate' },
                { id: 'r2', outcome: 'Formatting is correct' },
              ],
            },
          ],
        },
      ],
    };
    const { files } = transpileEvalYaml(suite);
    const evals = files.get('s')?.evals;
    expect(evals[0].assertions).toContain('Response is accurate');
    expect(evals[0].assertions).toContain('Formatting is correct');
  });

  it('converts tool-trajectory to NL', () => {
    const suite = {
      tests: [
        {
          id: 't1',
          input: 'test',
          assert: [
            { type: 'skill-used', value: 's' },
            {
              type: 'tool-trajectory',
              expected: [{ tool: 'read_file' }, { tool: 'write_file' }],
            },
          ],
        },
      ],
    };
    const { files } = transpileEvalYaml(suite);
    const evals = files.get('s')?.evals;
    expect(evals[0].assertions).toContain('Agent called tools in order: read_file, write_file');
  });

  it('converts script grader with name to assert instruction', () => {
    const suite = {
      tests: [
        {
          id: 't1',
          input: 'test',
          assert: [
            { type: 'skill-used', value: 's' },
            {
              type: 'script',
              metric: 'skill-use-check',
              description: 'Checks skill was used',
            },
          ],
        },
      ],
    };
    const { files } = transpileEvalYaml(suite);
    const evals = files.get('s')?.evals;
    expect(evals[0].assertions[0]).toContain('agentv eval assert skill-use-check');
  });

  it('converts script grader to agentv assert instruction with description', () => {
    const suite = {
      tests: [
        {
          id: 't1',
          input: 'test',
          assert: [
            { type: 'skill-used', value: 's' },
            {
              type: 'script',
              metric: 'format-checker',
              description: 'Validates output CSV format',
              command: ['bun', 'run', '.agentv/graders/format-checker.ts'],
            },
          ],
        },
      ],
    };
    const { files } = transpileEvalYaml(suite);
    const evals = files.get('s')?.evals;
    expect(evals[0].assertions[0]).toContain('agentv eval assert format-checker');
    expect(evals[0].assertions[0]).toContain('--agent-output');
    expect(evals[0].assertions[0]).toContain('score');
    expect(evals[0].assertions[0]).toContain('Validates output CSV format');
  });

  it('derives grader name from command when script grader has no name', () => {
    const suite = {
      tests: [
        {
          id: 't1',
          input: 'test',
          assert: [
            { type: 'skill-used', value: 's' },
            {
              type: 'script',
              command: ['bun', 'run', '.agentv/graders/output-validator.ts'],
            },
          ],
        },
      ],
    };
    const { files } = transpileEvalYaml(suite);
    const evals = files.get('s')?.evals;
    expect(evals[0].assertions[0]).toContain('agentv eval assert output-validator');
  });

  it('converts unknown type with command to agentv assert instruction', () => {
    const suite = {
      tests: [
        {
          id: 't1',
          input: 'test',
          assert: [
            { type: 'skill-used', value: 's' },
            {
              type: 'custom-validator',
              command: ['bun', 'run', '.agentv/graders/custom-validator.ts'],
            },
          ],
        },
      ],
    };
    const { files } = transpileEvalYaml(suite);
    const evals = files.get('s')?.evals;
    expect(evals[0].assertions[0]).toContain('agentv eval assert custom-validator');
  });

  it('converts field-accuracy to NL', () => {
    const suite = {
      tests: [
        {
          id: 't1',
          input: 'test',
          assert: [
            { type: 'skill-used', value: 's' },
            {
              type: 'field-accuracy',
              fields: [{ path: 'invoice.total' }, { path: 'invoice.date' }],
            },
          ],
        },
      ],
    };
    const { files } = transpileEvalYaml(suite);
    const evals = files.get('s')?.evals;
    expect(evals[0].assertions).toContain(
      'Fields invoice.total, invoice.date match expected values',
    );
  });

  it('converts latency to NL', () => {
    const suite = {
      tests: [
        {
          id: 't1',
          input: 'test',
          assert: [
            { type: 'skill-used', value: 's' },
            { type: 'latency', threshold: 5000 },
          ],
        },
      ],
    };
    const { files } = transpileEvalYaml(suite);
    const evals = files.get('s')?.evals;
    expect(evals[0].assertions).toContain('Response time under 5000ms');
  });

  it('converts cost to NL', () => {
    const suite = {
      tests: [
        {
          id: 't1',
          input: 'test',
          assert: [
            { type: 'skill-used', value: 's' },
            { type: 'cost', budget: 0.1 },
          ],
        },
      ],
    };
    const { files } = transpileEvalYaml(suite);
    const evals = files.get('s')?.evals;
    expect(evals[0].assertions).toContain('Cost under $0.1');
  });

  it('converts token-usage to NL', () => {
    const suite = {
      tests: [
        {
          id: 't1',
          input: 'test',
          assert: [
            { type: 'skill-used', value: 's' },
            { type: 'token-usage', max_total: 1000 },
          ],
        },
      ],
    };
    const { files } = transpileEvalYaml(suite);
    const evals = files.get('s')?.evals;
    expect(evals[0].assertions).toContain('Token usage within limits');
  });

  it('converts execution-metrics to NL', () => {
    const suite = {
      tests: [
        {
          id: 't1',
          input: 'test',
          assert: [
            { type: 'skill-used', value: 's' },
            { type: 'execution-metrics', max_tool_calls: 10 },
          ],
        },
      ],
    };
    const { files } = transpileEvalYaml(suite);
    const evals = files.get('s')?.evals;
    expect(evals[0].assertions).toContain('Execution within metric bounds');
  });
});

// ---------------------------------------------------------------------------
// expected_output
// ---------------------------------------------------------------------------

describe('transpileEvalYaml — expected_output', () => {
  it('includes expected_output as string', () => {
    const { files } = transpileEvalYaml(SINGLE_SKILL_SUITE);
    const evals = files.get('csv-analyzer')?.evals;
    expect(evals[0].expected_output).toBe(
      'The top 3 months by revenue are November ($22,500), September ($20,100), and December ($19,400).',
    );
  });

  it('omits expected_output when absent', () => {
    const { files } = transpileEvalYaml(SINGLE_SKILL_SUITE);
    const evals = files.get('csv-analyzer')?.evals;
    expect(evals[1].expected_output).toBeUndefined();
  });

  it('extracts string content from message array expected_output', () => {
    const suite = {
      tests: [
        {
          id: 't1',
          input: 'Hello',
          expected_output: [{ role: 'assistant', content: 'World' }],
          assert: [{ type: 'skill-used', value: 's' }],
        },
      ],
    };
    const { files } = transpileEvalYaml(suite);
    expect(files.get('s')?.evals[0].expected_output).toBe('World');
  });
});

// ---------------------------------------------------------------------------
// input_files shorthand
// ---------------------------------------------------------------------------

describe('transpileEvalYaml — input_files shorthand', () => {
  it('expands input_files alongside string input', () => {
    const suite = {
      tests: [
        {
          id: 't1',
          input: 'Analyze this file',
          input_files: ['data/file.csv', 'data/schema.json'],
          assert: [{ type: 'skill-used', value: 's' }],
        },
      ],
    };
    const { files } = transpileEvalYaml(suite);
    const evals = files.get('s')?.evals;
    expect(evals[0].prompt).toBe('Analyze this file');
    expect(evals[0].files).toEqual(['data/file.csv', 'data/schema.json']);
  });
});

// ---------------------------------------------------------------------------
// Root-level assertions distribution
// ---------------------------------------------------------------------------

describe('transpileEvalYaml — suite-level assertions', () => {
  it('appends suite-level NL assertions to every test', () => {
    const suite = {
      tests: [
        {
          id: 't1',
          input: 'first',
          assert: [{ type: 'skill-used', value: 's' }],
        },
        {
          id: 't2',
          input: 'second',
          assert: [{ type: 'skill-used', value: 's' }],
        },
      ],
      assert: [{ type: 'contains', value: 'global-check' }],
    };
    const { files } = transpileEvalYaml(suite);
    const evals = files.get('s')?.evals;
    expect(evals[0].assertions).toContain("Output contains 'global-check'");
    expect(evals[1].assertions).toContain("Output contains 'global-check'");
  });
});

// ---------------------------------------------------------------------------
// Multi-skill
// ---------------------------------------------------------------------------

describe('transpileEvalYaml — multi-skill', () => {
  it('produces one evals.json per skill', () => {
    const suite = {
      tests: [
        {
          id: 't1',
          input: 'Hello',
          assert: [{ type: 'skill-used', value: 'skill-a' }],
        },
        {
          id: 't2',
          input: 'World',
          assert: [{ type: 'skill-used', value: 'skill-b' }],
        },
      ],
    };
    const { files } = transpileEvalYaml(suite);
    expect(files.size).toBe(2);
    expect(files.has('skill-a')).toBe(true);
    expect(files.has('skill-b')).toBe(true);
  });

  it('places test in both files when it has skill-use assertions for two skills', () => {
    const suite = {
      tests: [
        {
          id: 'shared',
          input: 'Do something',
          assert: [
            { type: 'skill-used', value: 'skill-a' },
            { type: 'not-skill-used', value: 'skill-b' },
          ],
        },
      ],
    };
    const { files } = transpileEvalYaml(suite);
    expect(files.size).toBe(2);
    expect(files.get('skill-a')?.evals[0].should_trigger).toBe(true);
    expect(files.get('skill-b')?.evals[0].should_trigger).toBe(false);
  });

  it('assigns tests with no skill-use assertion to dominant skill', () => {
    const suite = {
      tests: [
        {
          id: 't1',
          input: 'Hello',
          assert: [
            { type: 'skill-used', value: 'skill-a' },
            { type: 'contains', value: 'hi' },
          ],
        },
        {
          id: 't2',
          input: 'No trigger here',
          assert: [{ type: 'contains', value: 'world' }],
        },
      ],
    };
    const { files } = transpileEvalYaml(suite);
    // _no-skill should be absorbed into skill-a (dominant)
    expect(files.has('_no-skill')).toBe(false);
    expect(files.get('skill-a')?.evals).toHaveLength(2);
  });

  it('keeps _no-skill file when there are no other skills', () => {
    const suite = {
      tests: [
        {
          id: 't1',
          input: 'Hello',
          assert: [{ type: 'contains', value: 'hi' }],
        },
      ],
    };
    const { files } = transpileEvalYaml(suite);
    expect(files.has('_no-skill')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('transpileEvalYaml — error handling', () => {
  it('throws when input is not an object', () => {
    expect(() => transpileEvalYaml('not an object')).toThrow('Invalid EVAL.yaml');
  });

  it('throws when tests array is missing', () => {
    expect(() => transpileEvalYaml({})).toThrow("missing 'tests' array");
  });

  it('includes source in error messages', () => {
    expect(() => transpileEvalYaml({}, 'my-file.yaml')).toThrow('my-file.yaml');
  });
});

// ---------------------------------------------------------------------------
// getOutputFilenames
// ---------------------------------------------------------------------------

describe('getOutputFilenames', () => {
  it('returns evals.json for single-skill result', () => {
    const { files } = transpileEvalYaml(SINGLE_SKILL_SUITE);
    const names = getOutputFilenames({ files, warnings: [] });
    expect(names.get('csv-analyzer')).toBe('evals.json');
  });

  it('returns skill-prefixed filenames for multi-skill result', () => {
    const suite = {
      tests: [
        {
          id: 't1',
          input: 'Hello',
          assert: [{ type: 'skill-used', value: 'skill-a' }],
        },
        {
          id: 't2',
          input: 'World',
          assert: [{ type: 'skill-used', value: 'skill-b' }],
        },
      ],
    };
    const result = transpileEvalYaml(suite);
    const names = getOutputFilenames(result);
    expect(names.get('skill-a')).toBe('skill-a.evals.json');
    expect(names.get('skill-b')).toBe('skill-b.evals.json');
  });
});
