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
      criteria: 'Agent finds the top 3 months by revenue',
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
      assertions: [
        { type: 'skill-trigger', skill: 'csv-analyzer', should_trigger: true },
        { type: 'rubrics', criteria: 'Output identifies November as the highest revenue month' },
        { type: 'contains', value: '$22,500' },
      ],
    },
    {
      id: 'irrelevant-query',
      input: 'What time is it?',
      assertions: [{ type: 'skill-trigger', skill: 'csv-analyzer', should_trigger: false }],
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
// Trigger-judge handling
// ---------------------------------------------------------------------------

describe('transpileEvalYaml — skill-trigger', () => {
  it('sets should_trigger: true for skill-trigger with should_trigger true', () => {
    const { files } = transpileEvalYaml(SINGLE_SKILL_SUITE);
    const evals = files.get('csv-analyzer')?.evals;
    expect(evals[0].should_trigger).toBe(true);
  });

  it('sets should_trigger: false for skill-trigger with should_trigger false', () => {
    const { files } = transpileEvalYaml(SINGLE_SKILL_SUITE);
    const evals = files.get('csv-analyzer')?.evals;
    expect(evals[1].should_trigger).toBe(false);
  });

  it('omits should_trigger when no skill-trigger in test', () => {
    const suite = {
      tests: [
        {
          id: 'no-trigger',
          input: 'Hello',
          assertions: [{ type: 'contains', value: 'Hi' }],
        },
      ],
    };
    const { files } = transpileEvalYaml(suite);
    // No skill: goes to _no-skill (or dominant skill if set)
    const allFiles = [...files.values()];
    expect(allFiles).toHaveLength(1);
    expect(allFiles[0].evals[0].should_trigger).toBeUndefined();
  });

  it('skill-trigger is NOT included in assertions array', () => {
    const { files } = transpileEvalYaml(SINGLE_SKILL_SUITE);
    const evals = files.get('csv-analyzer')?.evals;
    // assertions should contain NL items, not 'skill-trigger' literal
    for (const a of evals[0].assertions) {
      expect(a).not.toContain('skill-trigger');
    }
  });
});

// ---------------------------------------------------------------------------
// NL assertion conversion
// ---------------------------------------------------------------------------

describe('transpileEvalYaml — NL assertions', () => {
  it('prepends criteria to assertions', () => {
    const { files } = transpileEvalYaml(SINGLE_SKILL_SUITE);
    const evals = files.get('csv-analyzer')?.evals;
    expect(evals[0].assertions[0]).toBe('Agent finds the top 3 months by revenue');
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
          assertions: [
            { type: 'skill-trigger', skill: 's', should_trigger: true },
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
          assertions: [
            { type: 'skill-trigger', skill: 's', should_trigger: true },
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
          assertions: [
            { type: 'skill-trigger', skill: 's', should_trigger: true },
            { type: 'is-json' },
          ],
        },
      ],
    };
    const { files } = transpileEvalYaml(suite);
    const evals = files.get('s')?.evals;
    expect(evals[0].assertions).toContain('Output is valid JSON');
  });

  it('converts llm-judge prompt to NL', () => {
    const suite = {
      tests: [
        {
          id: 't1',
          input: 'test',
          assertions: [
            { type: 'skill-trigger', skill: 's', should_trigger: true },
            { type: 'llm-judge', prompt: 'The answer is clear and concise' },
          ],
        },
      ],
    };
    const { files } = transpileEvalYaml(suite);
    const evals = files.get('s')?.evals;
    expect(evals[0].assertions).toContain('The answer is clear and concise');
  });

  it('converts agent-judge with rubrics to multiple assertions', () => {
    const suite = {
      tests: [
        {
          id: 't1',
          input: 'test',
          assertions: [
            { type: 'skill-trigger', skill: 's', should_trigger: true },
            {
              type: 'agent-judge',
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

  it('converts tool-trajectory to NL', () => {
    const suite = {
      tests: [
        {
          id: 't1',
          input: 'test',
          assertions: [
            { type: 'skill-trigger', skill: 's', should_trigger: true },
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

  it('converts code-judge with name to run-judge instruction', () => {
    const suite = {
      tests: [
        {
          id: 't1',
          input: 'test',
          assertions: [
            { type: 'skill-trigger', skill: 's', should_trigger: true },
            {
              type: 'code-judge',
              name: 'skill-trigger',
              description: 'Checks skill was triggered',
            },
          ],
        },
      ],
    };
    const { files } = transpileEvalYaml(suite);
    const evals = files.get('s')?.evals;
    expect(evals[0].assertions[0]).toContain('agentv eval run-judge skill-trigger');
  });

  it('converts code-judge to agentv run-judge instruction', () => {
    const suite = {
      tests: [
        {
          id: 't1',
          input: 'test',
          assertions: [
            { type: 'skill-trigger', skill: 's', should_trigger: true },
            {
              type: 'code-judge',
              name: 'format-checker',
              description: 'Validates output CSV format',
              command: ['bun', 'run', '.agentv/judges/format-checker.ts'],
            },
          ],
        },
      ],
    };
    const { files } = transpileEvalYaml(suite);
    const evals = files.get('s')?.evals;
    expect(evals[0].assertions[0]).toContain('agentv eval run-judge format-checker');
    expect(evals[0].assertions[0]).toContain('--output');
    expect(evals[0].assertions[0]).toContain('score');
  });

  it('converts unknown type with command to agentv run-judge instruction', () => {
    const suite = {
      tests: [
        {
          id: 't1',
          input: 'test',
          assertions: [
            { type: 'skill-trigger', skill: 's', should_trigger: true },
            {
              type: 'custom-validator',
              command: ['bun', 'run', '.agentv/judges/custom-validator.ts'],
            },
          ],
        },
      ],
    };
    const { files } = transpileEvalYaml(suite);
    const evals = files.get('s')?.evals;
    expect(evals[0].assertions[0]).toContain('agentv eval run-judge custom-validator');
  });

  it('converts field-accuracy to NL', () => {
    const suite = {
      tests: [
        {
          id: 't1',
          input: 'test',
          assertions: [
            { type: 'skill-trigger', skill: 's', should_trigger: true },
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
          assertions: [
            { type: 'skill-trigger', skill: 's', should_trigger: true },
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
          assertions: [
            { type: 'skill-trigger', skill: 's', should_trigger: true },
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
          assertions: [
            { type: 'skill-trigger', skill: 's', should_trigger: true },
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
          assertions: [
            { type: 'skill-trigger', skill: 's', should_trigger: true },
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
          assertions: [{ type: 'skill-trigger', skill: 's', should_trigger: true }],
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
          assertions: [{ type: 'skill-trigger', skill: 's', should_trigger: true }],
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
          assertions: [{ type: 'skill-trigger', skill: 's', should_trigger: true }],
        },
        {
          id: 't2',
          input: 'second',
          assertions: [{ type: 'skill-trigger', skill: 's', should_trigger: true }],
        },
      ],
      assertions: [{ type: 'contains', value: 'global-check' }],
    };
    const { files } = transpileEvalYaml(suite);
    const evals = files.get('s')?.evals;
    expect(evals[0].assertions).toContain("Output contains 'global-check'");
    expect(evals[1].assertions).toContain("Output contains 'global-check'");
  });

  it('accepts deprecated assert: key at suite level', () => {
    const suite = {
      tests: [
        {
          id: 't1',
          input: 'hello',
          assert: [{ type: 'skill-trigger', skill: 's', should_trigger: true }],
        },
      ],
      assert: [{ type: 'contains', value: 'suite-level' }],
    };
    const { files, warnings } = transpileEvalYaml(suite);
    const evals = files.get('s')?.evals;
    expect(evals[0].assertions).toContain("Output contains 'suite-level'");
    expect(warnings.some((w) => w.includes("'assert' is deprecated"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Deprecated assert: key at test level
// ---------------------------------------------------------------------------

describe('transpileEvalYaml — deprecated assert: key', () => {
  it('accepts assert: key at test level with deprecation warning', () => {
    const suite = {
      tests: [
        {
          id: 't1',
          input: 'Hello',
          assert: [
            { type: 'skill-trigger', skill: 'skill-a', should_trigger: true },
            { type: 'contains', value: 'world' },
          ],
        },
      ],
    };
    const { files, warnings } = transpileEvalYaml(suite);
    expect(files.has('skill-a')).toBe(true);
    expect(files.get('skill-a')?.evals[0].assertions).toContain("Output contains 'world'");
    expect(warnings.some((w) => w.includes("'assert' is deprecated"))).toBe(true);
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
          assertions: [{ type: 'skill-trigger', skill: 'skill-a', should_trigger: true }],
        },
        {
          id: 't2',
          input: 'World',
          assertions: [{ type: 'skill-trigger', skill: 'skill-b', should_trigger: true }],
        },
      ],
    };
    const { files } = transpileEvalYaml(suite);
    expect(files.size).toBe(2);
    expect(files.has('skill-a')).toBe(true);
    expect(files.has('skill-b')).toBe(true);
  });

  it('places test in both files when it has skill-triggers for two skills', () => {
    const suite = {
      tests: [
        {
          id: 'shared',
          input: 'Do something',
          assertions: [
            { type: 'skill-trigger', skill: 'skill-a', should_trigger: true },
            { type: 'skill-trigger', skill: 'skill-b', should_trigger: false },
          ],
        },
      ],
    };
    const { files } = transpileEvalYaml(suite);
    expect(files.size).toBe(2);
    expect(files.get('skill-a')?.evals[0].should_trigger).toBe(true);
    expect(files.get('skill-b')?.evals[0].should_trigger).toBe(false);
  });

  it('assigns tests with no skill-trigger to dominant skill', () => {
    const suite = {
      tests: [
        {
          id: 't1',
          input: 'Hello',
          assertions: [
            { type: 'skill-trigger', skill: 'skill-a', should_trigger: true },
            { type: 'contains', value: 'hi' },
          ],
        },
        {
          id: 't2',
          input: 'No trigger here',
          assertions: [{ type: 'contains', value: 'world' }],
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
          assertions: [{ type: 'contains', value: 'hi' }],
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
          assertions: [{ type: 'skill-trigger', skill: 'skill-a', should_trigger: true }],
        },
        {
          id: 't2',
          input: 'World',
          assertions: [{ type: 'skill-trigger', skill: 'skill-b', should_trigger: true }],
        },
      ],
    };
    const result = transpileEvalYaml(suite);
    const names = getOutputFilenames(result);
    expect(names.get('skill-a')).toBe('skill-a.evals.json');
    expect(names.get('skill-b')).toBe('skill-b.evals.json');
  });
});
