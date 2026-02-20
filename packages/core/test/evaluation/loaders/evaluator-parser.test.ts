import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
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
  LlmJudgeEvaluatorConfig,
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

  it('parses type: is_json', async () => {
    const evaluators = await parseEvaluators(
      {
        evaluators: [{ name: 'json-check', type: 'is_json' }],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0].type).toBe('is_json');
    const config = evaluators?.[0] as IsJsonEvaluatorConfig;
    expect(config.name).toBe('json-check');
  });

  it('auto-generates name for is_json when not provided', async () => {
    const evaluators = await parseEvaluators(
      {
        evaluators: [{ type: 'is_json' }],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0].name).toBeTruthy();
    expect(evaluators?.[0].type).toBe('is_json');
  });

  it('parses type: is_json with weight', async () => {
    const evaluators = await parseEvaluators(
      {
        evaluators: [{ name: 'json-weighted', type: 'is_json', weight: 0.5 }],
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

  it('parses type: rubrics with criteria as llm_judge', async () => {
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
    expect(evaluators?.[0].type).toBe('llm_judge');
    expect((evaluators?.[0] as LlmJudgeEvaluatorConfig).rubrics).toHaveLength(1);
  });

  it('parses multiple assertion types in one evaluators array', async () => {
    const evaluators = await parseEvaluators(
      {
        evaluators: [
          { name: 'c1', type: 'contains', value: 'hello' },
          { name: 'r1', type: 'regex', value: '\\d+' },
          { name: 'j1', type: 'is_json' },
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
    expect(evaluators?.[2].type).toBe('is_json');
    expect(evaluators?.[3].type).toBe('equals');
  });
});

describe('parseEvaluators - tool_trajectory', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = path.join(os.tmpdir(), `agentv-test-eval-parser-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('parses tool_trajectory evaluator with any_order mode and minimums', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'tool-usage-check',
          type: 'tool_trajectory',
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
    expect(config.type).toBe('tool_trajectory');
    expect(config.name).toBe('tool-usage-check');
    expect(config.mode).toBe('any_order');
    expect(config.minimums).toEqual({ knowledgeSearch: 3, getTime: 1 });
    expect(config.expected).toBeUndefined();
  });

  it('parses tool_trajectory evaluator with in_order mode and expected', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'sequence-check',
          type: 'tool_trajectory',
          mode: 'in_order',
          expected: [{ tool: 'search' }, { tool: 'analyze' }, { tool: 'report' }],
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [tempDir], 'test-case');

    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0] as ToolTrajectoryEvaluatorConfig;
    expect(config.type).toBe('tool_trajectory');
    expect(config.mode).toBe('in_order');
    expect(config.expected).toEqual([{ tool: 'search' }, { tool: 'analyze' }, { tool: 'report' }]);
  });

  it('parses tool_trajectory evaluator with exact mode', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'exact-sequence',
          type: 'tool_trajectory',
          mode: 'exact',
          expected: [{ tool: 'toolA' }, { tool: 'toolB' }],
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [tempDir], 'test-case');

    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0] as ToolTrajectoryEvaluatorConfig;
    expect(config.type).toBe('tool_trajectory');
    expect(config.mode).toBe('exact');
    expect(config.expected).toEqual([{ tool: 'toolA' }, { tool: 'toolB' }]);
  });

  it('skips tool_trajectory with invalid mode', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'invalid-mode',
          type: 'tool_trajectory',
          mode: 'invalid_mode',
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [tempDir], 'test-case');

    expect(evaluators).toBeUndefined();
  });

  it('skips tool_trajectory with any_order mode but no minimums', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'missing-minimums',
          type: 'tool_trajectory',
          mode: 'any_order',
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [tempDir], 'test-case');

    expect(evaluators).toBeUndefined();
  });

  it('skips tool_trajectory with in_order mode but no expected', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'missing-expected',
          type: 'tool_trajectory',
          mode: 'in_order',
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [tempDir], 'test-case');

    expect(evaluators).toBeUndefined();
  });

  it('skips tool_trajectory with exact mode but no expected', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'missing-expected',
          type: 'tool_trajectory',
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
          type: 'tool_trajectory',
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
          type: 'tool_trajectory',
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

describe('parseEvaluators - code_judge config pass-through', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = path.join(os.tmpdir(), `agentv-test-code-judge-${Date.now()}`);
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
          type: 'code_judge',
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
    expect(config.type).toBe('code');
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
          name: 'simple-judge',
          type: 'code_judge',
          script: ['bun', 'run', './test_script.ts'],
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [tempDir], 'test-case');

    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0] as CodeEvaluatorConfig;
    expect(config.type).toBe('code');
    expect(config.config).toBeUndefined();
  });

  it('excludes known properties from config', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'with-weight',
          type: 'code_judge',
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
          type: 'code_judge',
          script: './test_script.ts',
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [tempDir], 'test-case');

    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0] as CodeEvaluatorConfig;
    if (process.platform === 'win32') {
      expect(config.script).toEqual(['cmd.exe', '/c', './test_script.ts']);
    } else {
      expect(config.script).toEqual(['sh', '-lc', './test_script.ts']);
    }
  });
});

describe('parseEvaluators - score_ranges rubrics', () => {
  it('parses valid score_ranges with required_min_score', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'correctness',
          type: 'llm_judge',
          rubrics: [
            {
              id: 'accuracy',
              weight: 2.0,
              required_min_score: 7,
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
    expect(config?.type).toBe('llm_judge');
    if (config?.type === 'llm_judge') {
      expect(config.rubrics).toHaveLength(1);
      const rubric = config.rubrics?.[0];
      expect(rubric?.id).toBe('accuracy');
      expect(rubric?.weight).toBe(2.0);
      expect(rubric?.required_min_score).toBe(7);
      expect(rubric?.score_ranges).toHaveLength(4);
    }
  });

  it('throws on overlapping score_ranges', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'overlapping',
          type: 'llm_judge',
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
          type: 'llm_judge',
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
    const rawEvalCase = {
      evaluators: [
        {
          name: 'legacy',
          type: 'llm_judge',
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
    if (config?.type === 'llm_judge') {
      // Rubric should be skipped since it has no 'outcome' field
      expect(config.rubrics ?? []).toHaveLength(0);
    }
  });
});

describe('parseEvaluators - score_ranges shorthand map', () => {
  it('normalizes shorthand map to correct array format', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'shorthand-test',
          type: 'llm_judge',
          rubrics: [
            {
              id: 'accuracy',
              weight: 2.0,
              required_min_score: 7,
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
    expect(config?.type).toBe('llm_judge');
    if (config?.type === 'llm_judge') {
      expect(config.rubrics).toHaveLength(1);
      const rubric = config.rubrics?.[0];
      expect(rubric?.id).toBe('accuracy');
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
          type: 'llm_judge',
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
          type: 'llm_judge',
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
    if (config?.type === 'llm_judge') {
      expect(config.rubrics?.[0]?.score_ranges).toHaveLength(4);
    }
  });
});

describe('parseEvaluators - token_usage', () => {
  it('parses token_usage evaluator with limits', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'token-budget',
          type: 'token_usage',
          max_total: 1000,
          max_output: 200,
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [process.cwd()], 'test-case');

    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0]).toEqual({
      name: 'token-budget',
      type: 'token_usage',
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
          type: 'token_usage',
          max_total: 1000,
          max_output: 200,
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, globalExecution, [process.cwd()], 'test');

    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0]).toEqual({
      name: 'token-budget',
      type: 'token_usage',
      max_total: 1000,
      max_output: 200,
    });
  });
});

describe('parseEvaluators - execution_metrics', () => {
  it('parses execution_metrics evaluator with all thresholds', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'efficiency-check',
          type: 'execution_metrics',
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
      type: 'execution_metrics',
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

  it('parses execution_metrics with only max_tool_calls', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'tool-limit',
          type: 'execution_metrics',
          max_tool_calls: 15,
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [process.cwd()], 'test-case');

    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0]).toEqual({
      name: 'tool-limit',
      type: 'execution_metrics',
      max_tool_calls: 15,
    });
  });

  it('parses execution_metrics with camelCase aliases', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'camel-case',
          type: 'execution_metrics',
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
      type: 'execution_metrics',
      max_tool_calls: 10,
      max_llm_calls: 5,
      max_tokens: 2000,
      max_cost_usd: 0.1,
      max_duration_ms: 5000,
    });
  });

  it('skips execution_metrics with no thresholds specified', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'no-thresholds',
          type: 'execution_metrics',
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [process.cwd()], 'test-case');

    expect(evaluators).toBeUndefined();
  });

  it('skips execution_metrics when only exploration_tolerance is set (no threshold)', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'only-tolerance',
          type: 'execution_metrics',
          exploration_tolerance: 0.2,
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [process.cwd()], 'test-case');

    expect(evaluators).toBeUndefined();
  });

  it('skips execution_metrics with invalid threshold value (negative)', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'negative-threshold',
          type: 'execution_metrics',
          max_tool_calls: -5,
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [process.cwd()], 'test-case');

    expect(evaluators).toBeUndefined();
  });

  it('skips execution_metrics with invalid threshold value (non-number)', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'string-threshold',
          type: 'execution_metrics',
          max_tool_calls: 'ten',
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [process.cwd()], 'test-case');

    expect(evaluators).toBeUndefined();
  });

  it('skips execution_metrics with Infinity threshold value', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'infinity-threshold',
          type: 'execution_metrics',
          max_tokens: Number.POSITIVE_INFINITY,
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [process.cwd()], 'test-case');

    expect(evaluators).toBeUndefined();
  });

  it('parses execution_metrics with target_exploration_ratio', async () => {
    const rawEvalCase = {
      evaluators: [
        {
          name: 'exploration-check',
          type: 'execution_metrics',
          target_exploration_ratio: 0.7,
        },
      ],
    };

    const evaluators = await parseEvaluators(rawEvalCase, undefined, [process.cwd()], 'test-case');

    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0]).toEqual({
      name: 'exploration-check',
      type: 'execution_metrics',
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

  it('parses assert field as evaluators', async () => {
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

  it('assert takes precedence over execution.evaluators', async () => {
    const evaluators = await parseEvaluators(
      {
        assert: [{ type: 'contains', value: 'DENIED' }],
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

  it('assert takes precedence over top-level evaluators', async () => {
    const evaluators = await parseEvaluators(
      {
        assert: [{ type: 'contains', value: 'DENIED' }],
        evaluators: [{ name: 'latency-check', type: 'latency', threshold: 5000 }],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0].type).toBe('contains');
  });

  it('merges suite-level assert with test-level assert', async () => {
    const evaluators = await parseEvaluators(
      {
        assert: [{ type: 'contains', value: 'DENIED' }],
      },
      { assert: [{ name: 'latency-check', type: 'latency', threshold: 5000 }] },
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(2);
    expect(evaluators?.[0].type).toBe('contains');
    expect(evaluators?.[1].type).toBe('latency');
  });

  it('skip_defaults prevents suite-level assert from being appended', async () => {
    const evaluators = await parseEvaluators(
      {
        assert: [{ type: 'contains', value: 'DENIED' }],
        execution: { skip_defaults: true },
      },
      { assert: [{ name: 'latency-check', type: 'latency', threshold: 5000 }] },
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

  it('suite-level assert takes precedence over suite-level execution.evaluators', async () => {
    const evaluators = await parseEvaluators(
      {},
      {
        assert: [{ type: 'contains', value: 'HELLO' }],
        evaluators: [{ name: 'latency-check', type: 'latency', threshold: 5000 }],
      },
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0].type).toBe('contains');
  });

  it('falls back to suite-level execution.evaluators when suite assert is not present', async () => {
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
        assert: [
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
    expect(evaluators?.[0].type).toBe('llm_judge');
    expect((evaluators?.[0] as LlmJudgeEvaluatorConfig).rubrics).toHaveLength(2);
    expect((evaluators?.[0] as LlmJudgeEvaluatorConfig).weight).toBe(4.0);
  });

  it('auto-generates name for rubrics type', async () => {
    const evaluators = await parseEvaluators(
      {
        assert: [
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
    const evaluators = await parseEvaluators(
      {
        assert: [
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
  });

  it('skips rubrics with missing criteria', async () => {
    const evaluators = await parseEvaluators(
      {
        assert: [
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
  });

  it('supports string shorthand in criteria', async () => {
    const evaluators = await parseEvaluators(
      {
        assert: [
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
    expect((evaluators?.[0] as LlmJudgeEvaluatorConfig).rubrics).toHaveLength(2);
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

  it('parses required on code_judge evaluator', async () => {
    const evaluators = await parseEvaluators(
      {
        evaluators: [
          {
            name: 'code-check',
            type: 'code_judge',
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

  it('parses required on llm_judge evaluator', async () => {
    const evaluators = await parseEvaluators(
      {
        evaluators: [{ name: 'judge', type: 'llm_judge', required: 0.7 }],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0] as LlmJudgeEvaluatorConfig;
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

describe('parseEvaluators - composite assert field', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = path.join(os.tmpdir(), `agentv-test-composite-assert-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    // Create dummy prompt files for llm_judge members (must include required template fields)
    await writeFile(path.join(tempDir, 'safety.md'), 'Evaluate safety of {{ candidate_answer }}');
    await writeFile(path.join(tempDir, 'quality.md'), 'Evaluate quality of {{ candidate_answer }}');
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('parses composite with assert field (new syntax)', async () => {
    const evaluators = await parseEvaluators(
      {
        assert: [
          {
            name: 'combined',
            type: 'composite',
            assert: [
              { name: 'safety', type: 'llm_judge', prompt: './safety.md' },
              { name: 'quality', type: 'llm_judge', prompt: './quality.md' },
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
    expect(evaluators![0].type).toBe('composite');
  });

  it('composite still works with evaluators field (backward compat)', async () => {
    const evaluators = await parseEvaluators(
      {
        evaluators: [
          {
            name: 'combined',
            type: 'composite',
            evaluators: [
              { name: 'safety', type: 'llm_judge', prompt: './safety.md' },
              { name: 'quality', type: 'llm_judge', prompt: './quality.md' },
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
    expect(evaluators![0].type).toBe('composite');
  });

  it('composite assert takes precedence over evaluators', async () => {
    const evaluators = await parseEvaluators(
      {
        assert: [
          {
            name: 'combined',
            type: 'composite',
            assert: [
              { name: 'safety', type: 'llm_judge', prompt: './safety.md' },
            ],
            evaluators: [
              { name: 'quality', type: 'llm_judge', prompt: './quality.md' },
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
    // assert takes precedence - only 1 inner evaluator
    const composite = evaluators![0] as CompositeEvaluatorConfig;
    expect(composite.evaluators).toHaveLength(1);
    expect(composite.evaluators[0].name).toBe('safety');
  });
});
