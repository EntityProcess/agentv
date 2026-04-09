import { afterAll, beforeAll, describe, expect, it, spyOn } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { parseEvaluators } from '../../../src/evaluation/loaders/evaluator-parser.js';
import type { ToolTrajectoryEvaluatorConfig } from '../../../src/evaluation/trace.js';
import type {
  CodeEvaluatorConfig,
  CompositeEvaluatorConfig,
  ContainsEvaluatorConfig,
  EqualsEvaluatorConfig,
  IsJsonEvaluatorConfig,
  LatencyEvaluatorConfig,
  LlmGraderEvaluatorConfig,
  RegexEvaluatorConfig,
} from '../../../src/evaluation/types.js';

describe('parseEvaluators - deterministic assertion types', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = path.join(os.tmpdir(), `agentv-test-assertions-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('parses type: contains', async () => {
    const evaluators = await parseEvaluators(
      {
        evaluators: [{ name: 'check-denied', type: 'contains', value: 'DENIED' }],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0].type).toBe('contains');
    const config = evaluators?.[0] as ContainsEvaluatorConfig;
    expect(config.name).toBe('check-denied');
    expect(config.value).toBe('DENIED');
  });

  it('auto-generates name for contains when not provided', async () => {
    const evaluators = await parseEvaluators(
      {
        evaluators: [{ type: 'contains', value: 'DENIED' }],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0].name).toBeTruthy();
    expect(evaluators?.[0].type).toBe('contains');
  });

  it('skips contains evaluator with missing value', async () => {
    const evaluators = await parseEvaluators(
      {
        evaluators: [{ name: 'no-value', type: 'contains' }],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toBeUndefined();
  });

  it('parses type: contains with weight', async () => {
    const evaluators = await parseEvaluators(
      {
        evaluators: [{ name: 'weighted-contains', type: 'contains', value: 'OK', weight: 2.0 }],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0] as ContainsEvaluatorConfig;
    expect(config.weight).toBe(2.0);
  });

  it('parses type: regex', async () => {
    const evaluators = await parseEvaluators(
      {
        evaluators: [{ name: 'risk-check', type: 'regex', value: 'risk: \\w+' }],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0].type).toBe('regex');
    const config = evaluators?.[0] as RegexEvaluatorConfig;
    expect(config.name).toBe('risk-check');
    expect(config.value).toBe('risk: \\w+');
  });

  it('auto-generates name for regex when not provided', async () => {
    const evaluators = await parseEvaluators(
      {
        evaluators: [{ type: 'regex', value: '^\\d{3}-\\d{4}$' }],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0].name).toBeTruthy();
    expect(evaluators?.[0].type).toBe('regex');
  });

  it('skips regex evaluator with missing value', async () => {
    const evaluators = await parseEvaluators(
      {
        evaluators: [{ name: 'no-pattern', type: 'regex' }],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toBeUndefined();
  });

  it('parses type: is-json', async () => {
    const evaluators = await parseEvaluators(
      {
        evaluators: [{ name: 'json-check', type: 'is-json' }],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0].type).toBe('is-json');
    const config = evaluators?.[0] as IsJsonEvaluatorConfig;
    expect(config.name).toBe('json-check');
  });

  it('auto-generates name for is-json when not provided', async () => {
    const evaluators = await parseEvaluators(
      {
        evaluators: [{ type: 'is-json' }],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0].name).toBeTruthy();
    expect(evaluators?.[0].type).toBe('is-json');
  });

  it('parses type: is-json with weight', async () => {
    const evaluators = await parseEvaluators(
      {
        evaluators: [{ name: 'json-weighted', type: 'is-json', weight: 0.5 }],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0] as IsJsonEvaluatorConfig;
    expect(config.weight).toBe(0.5);
  });

  it('parses type: equals', async () => {
    const evaluators = await parseEvaluators(
      {
        evaluators: [{ name: 'exact-match', type: 'equals', value: 'DENIED' }],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0].type).toBe('equals');
    const config = evaluators?.[0] as EqualsEvaluatorConfig;
    expect(config.name).toBe('exact-match');
    expect(config.value).toBe('DENIED');
  });

  it('auto-generates name for equals when not provided', async () => {
    const evaluators = await parseEvaluators(
      {
        evaluators: [{ type: 'equals', value: 'APPROVED' }],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0].name).toBeTruthy();
    expect(evaluators?.[0].type).toBe('equals');
  });

  it('skips equals evaluator with missing value', async () => {
    const evaluators = await parseEvaluators(
      {
        evaluators: [{ name: 'no-value', type: 'equals' }],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toBeUndefined();
  });

  it('parses type: rubrics with criteria as llm-grader', async () => {
    const evaluators = await parseEvaluators(
      {
        evaluators: [
          {
            name: 'rubrics-eval',
            type: 'rubrics',
            criteria: [{ id: 'r1', outcome: 'Must be polite', weight: 1.0, required: true }],
          },
        ],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0].type).toBe('llm-grader');
    expect((evaluators?.[0] as LlmGraderEvaluatorConfig).rubrics).toHaveLength(1);
  });

  it('parses multiple assertion types in one evaluators array', async () => {
    const evaluators = await parseEvaluators(
      {
        evaluators: [
          { name: 'c1', type: 'contains', value: 'hello' },
          { name: 'r1', type: 'regex', value: '\\d+' },
          { name: 'j1', type: 'is-json' },
          { name: 'e1', type: 'equals', value: 'exact' },
        ],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(4);
    expect(evaluators?.[0].type).toBe('contains');
    expect(evaluators?.[1].type).toBe('regex');
    expect(evaluators?.[2].type).toBe('is-json');
    expect(evaluators?.[3].type).toBe('equals');
  });
});

describe('parseEvaluators - tool-trajectory', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = path.join(os.tmpdir(), `agentv-test-eval-parser-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('parses tool-trajectory evaluator with any_order mode and minimums', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'tool-usage-check',
          type: 'tool-trajectory',
          mode: 'any_order',
          minimums: {
            knowledgeSearch: 3,
            getTime: 1,
          },
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [tempDir], 'test-case');

    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0] as ToolTrajectoryEvaluatorConfig;
    expect(config.type).toBe('tool-trajectory');
    expect(config.name).toBe('tool-usage-check');
    expect(config.mode).toBe('any_order');
    expect(config.minimums).toEqual({ knowledgeSearch: 3, getTime: 1 });
    expect(config.expected).toBeUndefined();
  });

  it('parses tool-trajectory evaluator with in_order mode and expected', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'sequence-check',
          type: 'tool-trajectory',
          mode: 'in_order',
          expected: [{ tool: 'search' }, { tool: 'analyze' }, { tool: 'report' }],
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [tempDir], 'test-case');

    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0] as ToolTrajectoryEvaluatorConfig;
    expect(config.type).toBe('tool-trajectory');
    expect(config.mode).toBe('in_order');
    expect(config.expected).toEqual([{ tool: 'search' }, { tool: 'analyze' }, { tool: 'report' }]);
  });

  it('parses tool-trajectory evaluator with exact mode', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'exact-sequence',
          type: 'tool-trajectory',
          mode: 'exact',
          expected: [{ tool: 'toolA' }, { tool: 'toolB' }],
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [tempDir], 'test-case');

    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0] as ToolTrajectoryEvaluatorConfig;
    expect(config.type).toBe('tool-trajectory');
    expect(config.mode).toBe('exact');
    expect(config.expected).toEqual([{ tool: 'toolA' }, { tool: 'toolB' }]);
  });

  it('skips tool-trajectory with invalid mode', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'invalid-mode',
          type: 'tool-trajectory',
          mode: 'invalid_mode',
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [tempDir], 'test-case');

    expect(evaluators).toBeUndefined();
  });

  it('skips tool-trajectory with any_order mode but no minimums', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'missing-minimums',
          type: 'tool-trajectory',
          mode: 'any_order',
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [tempDir], 'test-case');

    expect(evaluators).toBeUndefined();
  });

  it('skips tool-trajectory with in_order mode but no expected', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'missing-expected',
          type: 'tool-trajectory',
          mode: 'in_order',
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [tempDir], 'test-case');

    expect(evaluators).toBeUndefined();
  });

  it('skips tool-trajectory with exact mode but no expected', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'missing-expected',
          type: 'tool-trajectory',
          mode: 'exact',
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [tempDir], 'test-case');

    expect(evaluators).toBeUndefined();
  });

  it('filters invalid minimums entries (non-numeric, negative)', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'filtered-minimums',
          type: 'tool-trajectory',
          mode: 'any_order',
          minimums: {
            validTool: 5,
            invalidString: 'not-a-number',
            negativeTool: -1,
            zeroTool: 0,
          },
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [tempDir], 'test-case');

    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0] as ToolTrajectoryEvaluatorConfig;
    // Should keep valid numbers (including 0), filter out invalid ones
    expect(config.minimums).toEqual({ validTool: 5, zeroTool: 0 });
  });

  it('filters invalid expected entries (missing tool)', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'filtered-expected',
          type: 'tool-trajectory',
          mode: 'in_order',
          expected: [
            { tool: 'validTool' },
            { notATool: 'invalid' },
            { tool: 123 }, // non-string tool
            { tool: 'anotherValid' },
          ],
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [tempDir], 'test-case');

    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0] as ToolTrajectoryEvaluatorConfig;
    expect(config.expected).toEqual([{ tool: 'validTool' }, { tool: 'anotherValid' }]);
  });
});

describe('parseEvaluators - code-grader config pass-through', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = path.join(os.tmpdir(), `agentv-test-code-grader-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    // Create a dummy script file
    await writeFile(path.join(tempDir, 'test_script.ts'), '// dummy script');
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('passes unrecognized properties as config', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'fuzzy-matcher',
          type: 'code-grader',
          script: ['bun', 'run', './test_script.ts'],
          fields: [
            { path: 'supplier.name', threshold: 0.85 },
            { path: 'importer.name', threshold: 0.9 },
          ],
          algorithm: 'levenshtein',
          customOption: true,
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [tempDir], 'test-case');

    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0] as CodeEvaluatorConfig;
    expect(config.type).toBe('code-grader');
    expect(config.name).toBe('fuzzy-matcher');
    expect(config.config).toEqual({
      fields: [
        { path: 'supplier.name', threshold: 0.85 },
        { path: 'importer.name', threshold: 0.9 },
      ],
      algorithm: 'levenshtein',
      customOption: true,
    });
  });

  it('does not include config when no extra properties', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'simple-grader',
          type: 'code-grader',
          script: ['bun', 'run', './test_script.ts'],
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [tempDir], 'test-case');

    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0] as CodeEvaluatorConfig;
    expect(config.type).toBe('code-grader');
    expect(config.config).toBeUndefined();
  });

  it('excludes known properties from config', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'with-weight',
          type: 'code-grader',
          script: ['bun', 'run', './test_script.ts'],
          cwd: tempDir,
          weight: 2.0,
          threshold: 0.85, // This should go to config
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [tempDir], 'test-case');

    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0] as CodeEvaluatorConfig;
    expect(config.weight).toBe(2.0);
    expect(config.config).toEqual({ threshold: 0.85 });
  });

  it('converts string scripts into argv using a shell', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'legacy-script',
          type: 'code-grader',
          script: './test_script.ts',
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [tempDir], 'test-case');

    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0] as CodeEvaluatorConfig;
    if (process.platform === 'win32') {
      expect(config.command).toEqual(['cmd.exe', '/c', './test_script.ts']);
    } else {
      expect(config.command).toEqual(['sh', '-lc', './test_script.ts']);
    }
  });
});

describe('parseEvaluators - kebab-case type normalization', () => {
  const tempDir = '/tmp';

  it('normalizes kebab-case evaluator types to snake_case', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'kebab-llm',
          type: 'llm-grader',
          prompt: 'test prompt',
          target: 'grader-low-cost-a',
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [tempDir], 'test-case');

    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0].type).toBe('llm-grader');
    expect((evaluators?.[0] as LlmGraderEvaluatorConfig).target).toBe('grader-low-cost-a');
  });

  it('accepts code-grader kebab-case as canonical form', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'kebab-code',
          type: 'code-grader',
          script: ['bun', 'run', './test_script.ts'],
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [tempDir], 'test-case');

    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0].type).toBe('code-grader');
  });

  it('accepts is-json kebab-case as canonical form', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'kebab-json',
          type: 'is-json',
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [tempDir], 'test-case');

    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0].type).toBe('is-json');
  });

  it('normalizes snake_case grader types to kebab-case (backward compatible)', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'snake-llm',
          type: 'llm_grader',
          prompt: 'test prompt',
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [tempDir], 'test-case');

    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0].type).toBe('llm-grader');
  });

  it('rejects deprecated judge aliases', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'old-llm',
          type: 'llm_judge',
          prompt: 'test prompt',
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [tempDir], 'test-case');

    expect(evaluators).toBeUndefined();
  });

  it('leaves single-word types unchanged', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'contains-check',
          type: 'contains',
          value: 'hello',
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [tempDir], 'test-case');

    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0].type).toBe('contains');
  });
});

describe('parseEvaluators - score_ranges rubrics', () => {
  it('parses valid score_ranges with min_score', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'correctness',
          type: 'llm-grader',
          rubrics: [
            {
              id: 'accuracy',
              weight: 2.0,
              min_score: 0.7,
              score_ranges: [
                { score_range: [0, 3], outcome: 'Incorrect' },
                { score_range: [4, 6], outcome: 'Partially correct' },
                { score_range: [7, 9], outcome: 'Mostly correct' },
                { score_range: [10, 10], outcome: 'Fully correct' },
              ],
            },
          ],
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [process.cwd()], 'test-case');

    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0];
    expect(config?.type).toBe('llm-grader');
    if (config?.type === 'llm-grader') {
      expect(config.rubrics).toHaveLength(1);
      const rubric = config.rubrics?.[0];
      expect(rubric?.id).toBe('accuracy');
      expect(rubric?.weight).toBe(2.0);
      expect(rubric?.min_score).toBe(0.7);
      expect(rubric?.required_min_score).toBe(7);
      expect(rubric?.score_ranges).toHaveLength(4);
    }
  });

  it('throws on overlapping score_ranges', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'overlapping',
          type: 'llm-grader',
          rubrics: [
            {
              id: 'test',
              score_ranges: [
                { score_range: [0, 5], outcome: 'Low' },
                { score_range: [4, 10], outcome: 'High' }, // Overlaps at 4-5
              ],
            },
          ],
        },
      ],
    };

    await expect(
      parseEvaluators(rawEvalCase, undefined, [process.cwd()], 'test-case'),
    ).rejects.toThrow(/overlapping/i);
  });

  it('throws on incomplete score_ranges coverage', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'incomplete',
          type: 'llm-grader',
          rubrics: [
            {
              id: 'test',
              score_ranges: [
                { score_range: [0, 3], outcome: 'Low' },
                { score_range: [7, 10], outcome: 'High' }, // Missing 4-6
              ],
            },
          ],
        },
      ],
    };

    await expect(
      parseEvaluators(rawEvalCase, undefined, [process.cwd()], 'test-case'),
    ).rejects.toThrow(/coverage/i);
  });

  it('skips rubric items that use legacy description field without outcome', async () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    const rawEvalCase = {
      evaluators: [
        {
          name: 'legacy',
          type: 'llm-grader',
          rubrics: [
            {
              id: 'r1',
              description: 'Must be polite', // Legacy field name — no longer supported
              weight: 1.0,
              required: true,
            },
          ],
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [process.cwd()], 'test-case');

    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0];
    if (config?.type === 'llm-grader') {
      // Rubric should be skipped since it has no 'outcome' field
      expect(config.rubrics ?? []).toHaveLength(0);
    }
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('missing outcome'));
    warnSpy.mockRestore();
  });
});

describe('parseEvaluators - score_ranges shorthand map', () => {
  it('normalizes shorthand map to correct array format', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'shorthand-test',
          type: 'llm-grader',
          rubrics: [
            {
              id: 'accuracy',
              weight: 2.0,
              min_score: 0.7,
              score_ranges: {
                0: 'Completely wrong',
                3: 'Partially correct',
                7: 'Correct with minor issues',
                10: 'Perfectly accurate',
              },
            },
          ],
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [process.cwd()], 'test-case');

    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0];
    expect(config?.type).toBe('llm-grader');
    if (config?.type === 'llm-grader') {
      expect(config.rubrics).toHaveLength(1);
      const rubric = config.rubrics?.[0];
      expect(rubric?.id).toBe('accuracy');
      expect(rubric?.min_score).toBe(0.7);
      expect(rubric?.required_min_score).toBe(7);
      expect(rubric?.score_ranges).toHaveLength(4);
      expect(rubric?.score_ranges?.[0]).toEqual({
        score_range: [0, 2],
        outcome: 'Completely wrong',
      });
      expect(rubric?.score_ranges?.[1]).toEqual({
        score_range: [3, 6],
        outcome: 'Partially correct',
      });
      expect(rubric?.score_ranges?.[2]).toEqual({
        score_range: [7, 9],
        outcome: 'Correct with minor issues',
      });
      expect(rubric?.score_ranges?.[3]).toEqual({
        score_range: [10, 10],
        outcome: 'Perfectly accurate',
      });
    }
  });

  it('throws when shorthand map does not start at 0', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'bad-start',
          type: 'llm-grader',
          rubrics: [
            {
              id: 'test',
              score_ranges: {
                3: 'Partially correct',
                7: 'Good',
                10: 'Perfect',
              },
            },
          ],
        },
      ],
    };

    await expect(
      parseEvaluators(rawEvalCase, undefined, [process.cwd()], 'test-case'),
    ).rejects.toThrow(/must start at 0/);
  });

  it('passes through existing array format unchanged', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'array-format',
          type: 'llm-grader',
          rubrics: [
            {
              id: 'accuracy',
              score_ranges: [
                { score_range: [0, 3], outcome: 'Bad' },
                { score_range: [4, 6], outcome: 'OK' },
                { score_range: [7, 9], outcome: 'Good' },
                { score_range: [10, 10], outcome: 'Perfect' },
              ],
            },
          ],
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [process.cwd()], 'test-case');

    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0];
    if (config?.type === 'llm-grader') {
      expect(config.rubrics?.[0]?.score_ranges).toHaveLength(4);
    }
  });
});

describe('parseEvaluators - token-usage', () => {
  it('parses token-usage evaluator with limits', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'token-budget',
          type: 'token-usage',
          max_total: 1000,
          max_output: 200,
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [process.cwd()], 'test-case');

    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0]).toEqual({
      name: 'token-budget',
      type: 'token-usage',
      max_total: 1000,
      max_output: 200,
    });
  });

  it('inherits suite-level execution.evaluators when case has execution object without evaluators', async () => {
    const rawEvalCase = {
      execution: {
        constraints: {
          max_total_tokens: 123,
        },
      },
    };

    const globalExecution = {
      evaluators: [
        {
          name: 'token-budget',
          type: 'token-usage',
          max_total: 1000,
          max_output: 200,
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, globalExecution, [process.cwd()], 'test');

    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0]).toEqual({
      name: 'token-budget',
      type: 'token-usage',
      max_total: 1000,
      max_output: 200,
    });
  });
});

describe('parseEvaluators - execution-metrics', () => {
  it('parses execution-metrics evaluator with all thresholds', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'efficiency-check',
          type: 'execution-metrics',
          max_tool_calls: 10,
          max_llm_calls: 5,
          max_tokens: 2000,
          max_cost_usd: 0.1,
          max_duration_ms: 5000,
          target_exploration_ratio: 0.6,
          exploration_tolerance: 0.15,
          weight: 2.0,
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [process.cwd()], 'test-case');

    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0]).toEqual({
      name: 'efficiency-check',
      type: 'execution-metrics',
      max_tool_calls: 10,
      max_llm_calls: 5,
      max_tokens: 2000,
      max_cost_usd: 0.1,
      max_duration_ms: 5000,
      target_exploration_ratio: 0.6,
      exploration_tolerance: 0.15,
      weight: 2.0,
    });
  });

  it('parses execution-metrics with only max_tool_calls', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'tool-limit',
          type: 'execution-metrics',
          max_tool_calls: 15,
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [process.cwd()], 'test-case');

    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0]).toEqual({
      name: 'tool-limit',
      type: 'execution-metrics',
      max_tool_calls: 15,
    });
  });

  it('parses execution-metrics with camelCase aliases', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'camel-case',
          type: 'execution-metrics',
          maxToolCalls: 10,
          maxLlmCalls: 5,
          maxTokens: 2000,
          maxCostUsd: 0.1,
          maxDurationMs: 5000,
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [process.cwd()], 'test-case');

    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0]).toEqual({
      name: 'camel-case',
      type: 'execution-metrics',
      max_tool_calls: 10,
      max_llm_calls: 5,
      max_tokens: 2000,
      max_cost_usd: 0.1,
      max_duration_ms: 5000,
    });
  });

  it('skips execution-metrics with no thresholds specified', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'no-thresholds',
          type: 'execution-metrics',
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [process.cwd()], 'test-case');

    expect(evaluators).toBeUndefined();
  });

  it('skips execution-metrics when only exploration_tolerance is set (no threshold)', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'only-tolerance',
          type: 'execution-metrics',
          exploration_tolerance: 0.2,
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [process.cwd()], 'test-case');

    expect(evaluators).toBeUndefined();
  });

  it('skips execution-metrics with invalid threshold value (negative)', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'negative-threshold',
          type: 'execution-metrics',
          max_tool_calls: -5,
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [process.cwd()], 'test-case');

    expect(evaluators).toBeUndefined();
  });

  it('skips execution-metrics with invalid threshold value (non-number)', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'string-threshold',
          type: 'execution-metrics',
          max_tool_calls: 'ten',
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [process.cwd()], 'test-case');

    expect(evaluators).toBeUndefined();
  });

  it('skips execution-metrics with Infinity threshold value', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'infinity-threshold',
          type: 'execution-metrics',
          max_tokens: Number.POSITIVE_INFINITY,
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [process.cwd()], 'test-case');

    expect(evaluators).toBeUndefined();
  });

  it('parses execution-metrics with target_exploration_ratio', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'exploration-check',
          type: 'execution-metrics',
          target_exploration_ratio: 0.7,
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [process.cwd()], 'test-case');

    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0]).toEqual({
      name: 'exploration-check',
      type: 'execution-metrics',
      target_exploration_ratio: 0.7,
    });
  });
});

describe('parseEvaluators - default evaluators merge', () => {
  it('appends root evaluators after case-level evaluators', async () => {
    const rawEvalCase = {
      execution: {
        evaluators: [{ name: 'case-eval', type: 'latency', threshold: 3000 }],
      },
    };

    const globalExecution = {
      evaluators: [{ name: 'root-eval', type: 'latency', threshold: 5000 }],
    };

    const evaluators = await parseEvaluators(rawEvalCase, globalExecution, [process.cwd()], 'test');

    expect(evaluators).toHaveLength(2);
    expect(evaluators?.[0]).toEqual({ name: 'case-eval', type: 'latency', threshold: 3000 });
    expect(evaluators?.[1]).toEqual({ name: 'root-eval', type: 'latency', threshold: 5000 });
  });

  it('uses only root evaluators when case has none', async () => {
    const rawEvalCase = {};

    const globalExecution = {
      evaluators: [{ name: 'root-eval', type: 'latency', threshold: 5000 }],
    };

    const evaluators = await parseEvaluators(rawEvalCase, globalExecution, [process.cwd()], 'test');

    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0]).toEqual({ name: 'root-eval', type: 'latency', threshold: 5000 });
  });

  it('skips root evaluators when skip_defaults is true', async () => {
    const rawEvalCase = {
      execution: {
        skip_defaults: true,
        evaluators: [{ name: 'case-eval', type: 'latency', threshold: 3000 }],
      },
    };

    const globalExecution = {
      evaluators: [{ name: 'root-eval', type: 'latency', threshold: 5000 }],
    };

    const evaluators = await parseEvaluators(rawEvalCase, globalExecution, [process.cwd()], 'test');

    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0]).toEqual({ name: 'case-eval', type: 'latency', threshold: 3000 });
  });

  it('returns undefined when no evaluators at any level', async () => {
    const rawEvalCase = {};
    const evaluators = await parseEvaluators(rawEvalCase, undefined, [process.cwd()], 'test');
    expect(evaluators).toBeUndefined();
  });

  it('returns undefined when skip_defaults and no case evaluators', async () => {
    const rawEvalCase = {
      execution: { skip_defaults: true },
    };

    const globalExecution = {
      evaluators: [{ name: 'root-eval', type: 'latency', threshold: 5000 }],
    };

    const evaluators = await parseEvaluators(rawEvalCase, globalExecution, [process.cwd()], 'test');
    expect(evaluators).toBeUndefined();
  });

  it('backward compat: case with execution object but no evaluators inherits root', async () => {
    const rawEvalCase = {
      execution: {
        constraints: { max_total_tokens: 123 },
      },
    };

    const globalExecution = {
      evaluators: [{ name: 'root-eval', type: 'latency', threshold: 5000 }],
    };

    const evaluators = await parseEvaluators(rawEvalCase, globalExecution, [process.cwd()], 'test');

    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0]).toEqual({ name: 'root-eval', type: 'latency', threshold: 5000 });
  });

  it('case top-level evaluators field also merges with root', async () => {
    const rawEvalCase = {
      evaluators: [{ name: 'case-eval', type: 'latency', threshold: 3000 }],
    };

    const globalExecution = {
      evaluators: [{ name: 'root-eval', type: 'latency', threshold: 5000 }],
    };

    const evaluators = await parseEvaluators(rawEvalCase, globalExecution, [process.cwd()], 'test');

    expect(evaluators).toHaveLength(2);
    expect(evaluators?.[0]).toEqual({ name: 'case-eval', type: 'latency', threshold: 3000 });
    expect(evaluators?.[1]).toEqual({ name: 'root-eval', type: 'latency', threshold: 5000 });
  });
});

describe('parseEvaluators - assert field', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = path.join(os.tmpdir(), `agentv-test-assert-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('parses assertions field as evaluators', async () => {
    const evaluators = await parseEvaluators(
      {
        assertions: [{ type: 'contains', value: 'DENIED' }],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0].type).toBe('contains');
  });

  it('parses legacy assert field as evaluators (backward compat)', async () => {
    const evaluators = await parseEvaluators(
      {
        assert: [{ type: 'contains', value: 'DENIED' }],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0].type).toBe('contains');
  });

  it('assertions takes precedence over execution.evaluators', async () => {
    const evaluators = await parseEvaluators(
      {
        assertions: [{ type: 'contains', value: 'DENIED' }],
        execution: {
          evaluators: [{ name: 'latency-check', type: 'latency', threshold: 5000 }],
        },
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0].type).toBe('contains');
  });

  it('assertions takes precedence over top-level evaluators', async () => {
    const evaluators = await parseEvaluators(
      {
        assertions: [{ type: 'contains', value: 'DENIED' }],
        evaluators: [{ name: 'latency-check', type: 'latency', threshold: 5000 }],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0].type).toBe('contains');
  });

  it('merges suite-level assertions with test-level assertions', async () => {
    const evaluators = await parseEvaluators(
      {
        assertions: [{ type: 'contains', value: 'DENIED' }],
      },
      { assertions: [{ name: 'latency-check', type: 'latency', threshold: 5000 }] },
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(2);
    expect(evaluators?.[0].type).toBe('contains');
    expect(evaluators?.[1].type).toBe('latency');
  });

  it('skip_defaults prevents suite-level assertions from being appended', async () => {
    const evaluators = await parseEvaluators(
      {
        assertions: [{ type: 'contains', value: 'DENIED' }],
        execution: { skip_defaults: true },
      },
      { assertions: [{ name: 'latency-check', type: 'latency', threshold: 5000 }] },
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0].type).toBe('contains');
  });

  it('falls back to execution.evaluators when assert is not present', async () => {
    const evaluators = await parseEvaluators(
      {
        execution: {
          evaluators: [{ name: 'latency-check', type: 'latency', threshold: 5000 }],
        },
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0].type).toBe('latency');
  });

  it('suite-level assertions takes precedence over suite-level execution.evaluators', async () => {
    const evaluators = await parseEvaluators(
      {},
      {
        assertions: [{ type: 'contains', value: 'HELLO' }],
        evaluators: [{ name: 'latency-check', type: 'latency', threshold: 5000 }],
      },
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0].type).toBe('contains');
  });

  it('falls back to suite-level execution.evaluators when suite assertions is not present', async () => {
    const evaluators = await parseEvaluators(
      {},
      {
        evaluators: [{ name: 'latency-check', type: 'latency', threshold: 5000 }],
      },
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0].type).toBe('latency');
  });
});

describe('parseEvaluators - assertion templates', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = path.join(os.tmpdir(), `agentv-test-templates-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function writeTemplate(relativePath: string, content: string): Promise<string> {
    const filePath = path.join(tempDir, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
    return filePath;
  }

  it('resolves convention-based includes from .agentv/templates', async () => {
    await writeTemplate(
      '.agentv/templates/shared.yaml',
      `
assertions:
  - type: contains
    value: shared
`,
    );

    const evaluators = await parseEvaluators(
      {
        evaluators: [{ include: 'shared' }],
      },
      undefined,
      [tempDir],
      'test-1',
    );

    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0]).toMatchObject({ type: 'contains', value: 'shared' });
  });

  it('resolves relative template paths and respects skip_defaults', async () => {
    await writeTemplate(
      'shared/local.yaml',
      `
assertions:
  - type: contains
    value: local
`,
    );

    const evaluators = await parseEvaluators(
      {
        assertions: [{ type: 'contains', value: 'case-only' }],
        execution: { skip_defaults: true },
      },
      {
        assertions: [{ include: './shared/local.yaml' }],
      },
      [tempDir],
      'test-2',
    );

    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0]).toMatchObject({ type: 'contains', value: 'case-only' });
  });

  it('resolves nested relative includes from the template file directory', async () => {
    await writeTemplate(
      'templates/nested/outer.yaml',
      `
assertions:
  - include: ./inner.yaml
  - type: regex
    value: nested
`,
    );
    await writeTemplate(
      'templates/nested/inner.yaml',
      `
assertions:
  - type: contains
    value: inner
`,
    );

    const evaluators = await parseEvaluators(
      {
        assertions: [{ include: './templates/nested/outer.yaml' }],
      },
      undefined,
      [tempDir],
      'test-relative-nested',
    );

    expect(evaluators).toHaveLength(2);
    expect(evaluators?.[0]).toMatchObject({ type: 'contains', value: 'inner' });
    expect(evaluators?.[1]).toMatchObject({ type: 'regex', value: 'nested' });
  });

  it('expands nested template includes up to depth 3', async () => {
    await writeTemplate(
      '.agentv/templates/level-a.yaml',
      `
assertions:
  - include: level-b
`,
    );
    await writeTemplate(
      '.agentv/templates/level-b.yaml',
      `
assertions:
  - include: level-c
`,
    );
    await writeTemplate(
      '.agentv/templates/level-c.yaml',
      `
assertions:
  - type: contains
    value: nested-ok
`,
    );

    const evaluators = await parseEvaluators(
      {
        evaluators: [{ include: 'level-a' }],
      },
      undefined,
      [tempDir],
      'test-3',
    );

    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0]).toMatchObject({ type: 'contains', value: 'nested-ok' });
  });

  it('throws when nested includes exceed depth 3', async () => {
    await writeTemplate(
      '.agentv/templates/depth-a.yaml',
      `
assertions:
  - include: depth-b
`,
    );
    await writeTemplate(
      '.agentv/templates/depth-b.yaml',
      `
assertions:
  - include: depth-c
`,
    );
    await writeTemplate(
      '.agentv/templates/depth-c.yaml',
      `
assertions:
  - include: depth-d
`,
    );
    await writeTemplate(
      '.agentv/templates/depth-d.yaml',
      `
assertions:
  - type: contains
    value: too-deep
`,
    );

    await expect(
      parseEvaluators(
        {
          evaluators: [{ include: 'depth-a' }],
        },
        undefined,
        [tempDir],
        'test-4',
      ),
    ).rejects.toThrow(/depth exceeded 3/i);
  });

  it('throws a clear error when a template is missing', async () => {
    await expect(
      parseEvaluators(
        {
          evaluators: [{ include: 'missing-template' }],
        },
        undefined,
        [tempDir],
        'test-5',
      ),
    ).rejects.toThrow(/\.agentv\/templates\/missing-template\.yaml/);
  });
});

describe('parseEvaluators - type: rubrics with criteria', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = path.join(os.tmpdir(), `agentv-test-rubrics-criteria-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('parses rubrics type with criteria array', async () => {
    const evaluators = await parseEvaluators(
      {
        assertions: [
          {
            type: 'rubrics',
            criteria: [
              { id: 'accuracy', outcome: 'Correct answer', weight: 5.0 },
              { id: 'reasoning', outcome: 'Clear reasoning', weight: 3.0 },
            ],
            weight: 4.0,
          },
        ],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0].type).toBe('llm-grader');
    expect((evaluators?.[0] as LlmGraderEvaluatorConfig).rubrics).toHaveLength(2);
    expect((evaluators?.[0] as LlmGraderEvaluatorConfig).weight).toBe(4.0);
  });

  it('auto-generates name for rubrics type', async () => {
    const evaluators = await parseEvaluators(
      {
        assertions: [
          {
            type: 'rubrics',
            criteria: [{ id: 'check-1', outcome: 'Some check', weight: 1.0 }],
          },
        ],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0].name).toBeTruthy();
  });

  it('skips rubrics with empty criteria array', async () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    const evaluators = await parseEvaluators(
      {
        assertions: [
          {
            type: 'rubrics',
            criteria: [],
          },
        ],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('criteria must be a non-empty array'),
    );
    warnSpy.mockRestore();
  });

  it('skips rubrics with missing criteria', async () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    const evaluators = await parseEvaluators(
      {
        assertions: [
          {
            type: 'rubrics',
          },
        ],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('criteria must be a non-empty array'),
    );
    warnSpy.mockRestore();
  });

  it('supports string shorthand in criteria', async () => {
    const evaluators = await parseEvaluators(
      {
        assertions: [
          {
            type: 'rubrics',
            criteria: ['Must be polite', 'Must be accurate'],
          },
        ],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    expect((evaluators?.[0] as LlmGraderEvaluatorConfig).rubrics).toHaveLength(2);
  });
});

describe('parseEvaluators - required field', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = path.join(os.tmpdir(), `agentv-test-required-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    await writeFile(path.join(tempDir, 'test_script.ts'), '// dummy script');
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('parses required: true on contains evaluator', async () => {
    const evaluators = await parseEvaluators(
      {
        evaluators: [{ name: 'check', type: 'contains', value: 'DENIED', required: true }],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0] as ContainsEvaluatorConfig;
    expect(config.required).toBe(true);
  });

  it('parses required: 0.6 (numeric threshold) on contains evaluator', async () => {
    const evaluators = await parseEvaluators(
      {
        evaluators: [{ name: 'check', type: 'contains', value: 'DENIED', required: 0.6 }],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0] as ContainsEvaluatorConfig;
    expect(config.required).toBe(0.6);
  });

  it('ignores required: false', async () => {
    const evaluators = await parseEvaluators(
      {
        evaluators: [{ name: 'check', type: 'contains', value: 'DENIED', required: false }],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0] as ContainsEvaluatorConfig;
    expect(config.required).toBeUndefined();
  });

  it('parses required on latency evaluator', async () => {
    const evaluators = await parseEvaluators(
      {
        evaluators: [{ name: 'lat', type: 'latency', threshold: 5000, required: true }],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0] as LatencyEvaluatorConfig;
    expect(config.required).toBe(true);
  });

  it('parses required on code-grader evaluator', async () => {
    const evaluators = await parseEvaluators(
      {
        evaluators: [
          {
            name: 'code-check',
            type: 'code-grader',
            script: ['bun', 'run', './test_script.ts'],
            required: true,
          },
        ],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0] as CodeEvaluatorConfig;
    expect(config.required).toBe(true);
  });

  it('parses required on llm-grader evaluator', async () => {
    const evaluators = await parseEvaluators(
      {
        evaluators: [{ name: 'grader', type: 'llm-grader', required: 0.7 }],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0] as LlmGraderEvaluatorConfig;
    expect(config.required).toBe(0.7);
  });

  it('ignores invalid required values (string, negative, > 1)', async () => {
    const evaluators = await parseEvaluators(
      {
        evaluators: [
          { name: 'c1', type: 'contains', value: 'A', required: 'yes' },
          { name: 'c2', type: 'contains', value: 'B', required: -0.5 },
          { name: 'c3', type: 'contains', value: 'C', required: 1.5 },
          { name: 'c4', type: 'contains', value: 'D', required: 0 },
        ],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(4);
    // All invalid required values should be dropped (undefined)
    for (const config of evaluators ?? []) {
      expect((config as ContainsEvaluatorConfig).required).toBeUndefined();
    }
  });
});

describe('parseEvaluators - composite assertions field', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = path.join(os.tmpdir(), `agentv-test-composite-assert-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    // Create dummy prompt files for llm-grader members (must include required template fields)
    await writeFile(path.join(tempDir, 'safety.md'), 'Evaluate safety of {{ output }}');
    await writeFile(path.join(tempDir, 'quality.md'), 'Evaluate quality of {{ output }}');
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('parses composite with assertions field', async () => {
    const evaluators = await parseEvaluators(
      {
        assertions: [
          {
            name: 'combined',
            type: 'composite',
            assertions: [
              { name: 'safety', type: 'llm-grader', prompt: './safety.md' },
              { name: 'quality', type: 'llm-grader', prompt: './quality.md' },
            ],
            aggregator: { type: 'weighted_average' },
          },
        ],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0].type).toBe('composite');
  });

  it('composite still works with evaluators field (backward compat)', async () => {
    const evaluators = await parseEvaluators(
      {
        evaluators: [
          {
            name: 'combined',
            type: 'composite',
            evaluators: [
              { name: 'safety', type: 'llm-grader', prompt: './safety.md' },
              { name: 'quality', type: 'llm-grader', prompt: './quality.md' },
            ],
            aggregator: { type: 'weighted_average' },
          },
        ],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0].type).toBe('composite');
  });

  it('composite assertions takes precedence over evaluators', async () => {
    const evaluators = await parseEvaluators(
      {
        assertions: [
          {
            name: 'combined',
            type: 'composite',
            assertions: [{ name: 'safety', type: 'llm-grader', prompt: './safety.md' }],
            evaluators: [{ name: 'quality', type: 'llm-grader', prompt: './quality.md' }],
            aggregator: { type: 'weighted_average' },
          },
        ],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    // assertions takes precedence - only 1 inner evaluator
    const composite = evaluators?.[0] as CompositeEvaluatorConfig;
    expect(composite.assertions).toHaveLength(1);
    expect(composite.assertions[0].name).toBe('safety');
  });
});

describe('parseEvaluators - string shorthand in assertions', () => {
  it('treats all-string assertions array as a single rubrics evaluator', async () => {
    const evaluators = await parseEvaluators(
      {
        assertions: [
          'Mentions divide-and-conquer approach',
          'Explains partition step',
          'States time complexity',
        ],
      },
      undefined,
      ['/tmp'],
      'test-id',
    );

    expect(evaluators).toHaveLength(1);
    const rubrics = evaluators?.[0];
    expect(rubrics?.type).toBe('llm-grader');
    expect((rubrics as LlmGraderEvaluatorConfig).rubrics).toHaveLength(3);
    expect((rubrics as LlmGraderEvaluatorConfig).rubrics?.[0].outcome).toBe(
      'Mentions divide-and-conquer approach',
    );
    expect((rubrics as LlmGraderEvaluatorConfig).rubrics?.[1].outcome).toBe(
      'Explains partition step',
    );
    expect((rubrics as LlmGraderEvaluatorConfig).rubrics?.[2].outcome).toBe(
      'States time complexity',
    );
  });

  it('groups strings into rubrics and preserves object evaluators', async () => {
    const evaluators = await parseEvaluators(
      {
        assertions: [
          'Mentions divide-and-conquer approach',
          { name: 'syntax-check', type: 'contains', value: 'quicksort' },
          'States time complexity',
        ],
      },
      undefined,
      ['/tmp'],
      'test-id',
    );

    expect(evaluators).toHaveLength(2);
    // First: rubrics (at position of first string)
    expect(evaluators?.[0].type).toBe('llm-grader');
    expect((evaluators?.[0] as LlmGraderEvaluatorConfig).rubrics).toHaveLength(2);
    expect((evaluators?.[0] as LlmGraderEvaluatorConfig).rubrics?.[0].outcome).toBe(
      'Mentions divide-and-conquer approach',
    );
    // Second: the contains evaluator
    expect(evaluators?.[1].type).toBe('contains');
    expect(evaluators?.[1].name).toBe('syntax-check');
  });

  it('treats a single string as a single-criterion rubrics evaluator', async () => {
    const evaluators = await parseEvaluators(
      {
        assertions: ['Response must be polite'],
      },
      undefined,
      ['/tmp'],
      'test-id',
    );

    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0].type).toBe('llm-grader');
    expect((evaluators?.[0] as LlmGraderEvaluatorConfig).rubrics).toHaveLength(1);
    expect((evaluators?.[0] as LlmGraderEvaluatorConfig).rubrics?.[0].outcome).toBe(
      'Response must be polite',
    );
  });

  it('ignores all-whitespace strings and produces no rubrics evaluator', async () => {
    const evaluators = await parseEvaluators(
      {
        assertions: ['   ', ''],
      },
      undefined,
      ['/tmp'],
      'test-id',
    );

    expect(evaluators).toBeUndefined();
  });
});

describe('parseEvaluators - file:// prefix prompt resolution', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = path.join(os.tmpdir(), `agentv-test-file-prefix-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    await writeFile(path.join(tempDir, 'grader.md'), 'Evaluate the quality of {{ output }}');
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('file:// prefix resolves existing file', async () => {
    const evaluators = await parseEvaluators(
      {
        assertions: [{ name: 'quality', type: 'llm-grader', prompt: 'file://grader.md' }],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0] as LlmGraderEvaluatorConfig;
    expect(config.promptPath).toBeTruthy();
    expect(config.promptPath).toContain('grader.md');
  });

  it('file:// prefix throws when file not found', async () => {
    await expect(
      parseEvaluators(
        {
          assertions: [{ name: 'missing', type: 'llm-grader', prompt: 'file://nonexistent.md' }],
        },
        undefined,
        [tempDir],
        'test-1',
      ),
    ).rejects.toThrow(/prompt file not found/);
  });

  it('bare path is always treated as inline text even if file exists', async () => {
    const evaluators = await parseEvaluators(
      {
        assertions: [{ name: 'quality', type: 'llm-grader', prompt: 'grader.md' }],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0] as LlmGraderEvaluatorConfig;
    // Bare string is inline text — no file resolution, no promptPath
    expect(config.prompt).toBe('grader.md');
    expect(config.promptPath).toBeUndefined();
  });
});
