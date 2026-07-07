import { afterAll, beforeAll, describe, expect, it, spyOn } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { parseGraders } from '../../../src/evaluation/loaders/grader-parser.js';
import type {
  AssertSetGraderConfig,
  ContainsGraderConfig,
  EqualsGraderConfig,
  IsJsonGraderConfig,
  LatencyGraderConfig,
  LlmGraderConfig,
  LlmRubricGraderConfig,
  RegexGraderConfig,
  ScriptGraderConfig,
  SkillUsedGraderConfig,
  TrajectoryGraderConfig,
} from '../../../src/evaluation/types.js';

describe('parseGraders - deterministic assertion types', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = path.join(os.tmpdir(), `agentv-test-assertions-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('parses type: contains', async () => {
    const evaluators = await parseGraders(
      {
        assert: [{ metric: 'check-denied', type: 'contains', value: 'DENIED' }],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0].type).toBe('contains');
    const config = evaluators?.[0] as ContainsGraderConfig;
    expect(config.name).toBe('check-denied');
    expect(config.value).toBe('DENIED');
  });

  it('auto-generates name for contains when not provided', async () => {
    const evaluators = await parseGraders(
      {
        assert: [{ type: 'contains', value: 'DENIED' }],
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
    const evaluators = await parseGraders(
      {
        assert: [{ metric: 'no-value', type: 'contains' }],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toBeUndefined();
  });

  it('parses type: contains with weight', async () => {
    const evaluators = await parseGraders(
      {
        assert: [{ metric: 'weighted-contains', type: 'contains', value: 'OK', weight: 2.0 }],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0] as ContainsGraderConfig;
    expect(config.weight).toBe(2.0);
  });

  it('parses type: regex', async () => {
    const evaluators = await parseGraders(
      {
        assert: [{ metric: 'risk-check', type: 'regex', value: 'risk: \\w+' }],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0].type).toBe('regex');
    const config = evaluators?.[0] as RegexGraderConfig;
    expect(config.name).toBe('risk-check');
    expect(config.value).toBe('risk: \\w+');
  });

  it('auto-generates name for regex when not provided', async () => {
    const evaluators = await parseGraders(
      {
        assert: [{ type: 'regex', value: '^\\d{3}-\\d{4}$' }],
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
    const evaluators = await parseGraders(
      {
        assert: [{ metric: 'no-pattern', type: 'regex' }],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toBeUndefined();
  });

  it('parses type: is-json', async () => {
    const evaluators = await parseGraders(
      {
        assert: [{ metric: 'json-check', type: 'is-json' }],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0].type).toBe('is-json');
    const config = evaluators?.[0] as IsJsonGraderConfig;
    expect(config.name).toBe('json-check');
  });

  it('auto-generates name for is-json when not provided', async () => {
    const evaluators = await parseGraders(
      {
        assert: [{ type: 'is-json' }],
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
    const evaluators = await parseGraders(
      {
        assert: [{ metric: 'json-weighted', type: 'is-json', weight: 0.5 }],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0] as IsJsonGraderConfig;
    expect(config.weight).toBe(0.5);
  });

  it('parses type: equals', async () => {
    const evaluators = await parseGraders(
      {
        assert: [{ metric: 'exact-match', type: 'equals', value: 'DENIED' }],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0].type).toBe('equals');
    const config = evaluators?.[0] as EqualsGraderConfig;
    expect(config.name).toBe('exact-match');
    expect(config.value).toBe('DENIED');
  });

  it('auto-generates name for equals when not provided', async () => {
    const evaluators = await parseGraders(
      {
        assert: [{ type: 'equals', value: 'APPROVED' }],
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
    const evaluators = await parseGraders(
      {
        assert: [{ metric: 'no-value', type: 'equals' }],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toBeUndefined();
  });

  it('rejects removed rubrics assertion type with llm-rubric migration hint', async () => {
    await expect(
      parseGraders(
        {
          assert: [
            {
              metric: 'rubrics-eval',
              type: 'rubrics',
              criteria: [{ id: 'r1', outcome: 'Must be polite', weight: 1.0, required: true }],
            },
          ],
        },
        undefined,
        [tempDir],
        'test-1',
      ),
    ).rejects.toThrow(
      "Unsupported grader 'rubrics' in 'test-1'. Use 'llm-rubric with value' instead.",
    );
  });

  it('parses multiple assertion types in one evaluators array', async () => {
    const evaluators = await parseGraders(
      {
        assert: [
          { metric: 'c1', type: 'contains', value: 'hello' },
          { metric: 'r1', type: 'regex', value: '\\d+' },
          { metric: 'j1', type: 'is-json' },
          { metric: 'e1', type: 'equals', value: 'exact' },
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

  it('parses explicit llm-rubric criteria with score ranges', async () => {
    const evaluators = await parseGraders(
      {
        assert: [
          {
            metric: 'quality',
            type: 'llm-rubric',
            value: {
              id: 'quality',
              outcome: 'Answer quality',
              min_score: 0.8,
              score_ranges: [
                { score_range: [0, 4], outcome: 'Weak' },
                { score_range: [5, 7], outcome: 'Adequate' },
                { score_range: [8, 10], outcome: 'Strong' },
              ],
            },
          },
        ],
      },
      undefined,
      [tempDir],
      'test-1',
    );

    const config = evaluators?.[0] as LlmRubricGraderConfig;
    expect(config.type).toBe('llm-rubric');
    expect(config.rubrics?.[0]).toMatchObject({
      id: 'quality',
      outcome: 'Answer quality',
      min_score: 0.8,
      score_ranges: [
        { score_range: [0, 4], outcome: 'Weak' },
        { score_range: [5, 7], outcome: 'Adequate' },
        { score_range: [8, 10], outcome: 'Strong' },
      ],
    });
  });

  it('parses llm-rubric as free-form rubric text', async () => {
    const evaluators = await parseGraders(
      {
        assert: [{ metric: 'freeform', type: 'llm-rubric', value: 'Judge whether it is helpful' }],
      },
      undefined,
      [tempDir],
      'test-1',
    );

    expect(evaluators?.[0]).toMatchObject({
      name: 'freeform',
      type: 'llm-rubric',
      value: 'Judge whether it is helpful',
    });
  });

  it('keeps arbitrary llm-rubric object value for promptfoo-compatible prompts', async () => {
    const evaluators = await parseGraders(
      {
        assert: [
          {
            metric: 'object-rubric',
            type: 'llm-rubric',
            value: {
              role: 'system',
              content: 'Evaluate the response for accuracy',
            },
          },
        ],
      },
      undefined,
      [tempDir],
      'test-1',
    );

    const config = evaluators?.[0] as LlmRubricGraderConfig;
    expect(config.type).toBe('llm-rubric');
    expect(config.value).toEqual({
      role: 'system',
      content: 'Evaluate the response for accuracy',
    });
    expect(config.rubrics).toBeUndefined();
  });

  it('parses promptfoo-style llm-rubric value array as structured rubrics', async () => {
    const evaluators = await parseGraders(
      {
        assert: [
          {
            metric: 'structured-array',
            type: 'llm-rubric',
            value: [
              {
                id: 'implementation-repositories',
                outcome: 'Routes branch setup to implementation repositories',
                weight: 2,
                required: true,
              },
              {
                id: 'not-docs-only',
                outcome: 'Does not route only to the docs repository',
                weight: 1.5,
                required: true,
              },
            ],
          },
        ],
      },
      undefined,
      [tempDir],
      'test-1',
    );

    const config = evaluators?.[0] as LlmRubricGraderConfig;
    expect(config.type).toBe('llm-rubric');
    expect(config.value).toBeUndefined();
    expect(config.rubrics).toHaveLength(2);
    expect(config.rubrics?.[1]).toMatchObject({
      id: 'not-docs-only',
      outcome: 'Does not route only to the docs repository',
      weight: 1.5,
      required: true,
    });
  });

  it('parses promptfoo-compatible agent-rubric as an agent-backed rubric grader', async () => {
    const evaluators = await parseGraders(
      {
        assert: [
          {
            metric: 'agent-check',
            type: 'agent-rubric',
            value: 'Inspect the workspace and verify the claimed file exists',
            provider: 'codex-grader',
            max_steps: 4,
          },
        ],
      },
      undefined,
      [tempDir],
      'test-1',
    );

    expect(evaluators?.[0]).toMatchObject({
      name: 'agent-check',
      type: 'agent-rubric',
      value: 'Inspect the workspace and verify the claimed file exists',
      target: 'codex-grader',
      max_steps: 4,
    });
  });

  it('inherits default rubric prompt for llm-rubric assertions only', async () => {
    const evaluators = await parseGraders(
      {
        assert: [
          { metric: 'rubric', type: 'llm-rubric', value: 'Judge whether it is helpful' },
          { metric: 'contains-check', type: 'contains', value: 'ok' },
        ],
      },
      undefined,
      [tempDir],
      'test-1',
      undefined,
      'Grade {{ output }} against {{ rubric }}',
    );

    expect(evaluators?.[0]).toMatchObject({
      name: 'rubric',
      type: 'llm-rubric',
      prompt: 'Grade {{ output }} against {{ rubric }}',
    });
    expect(evaluators?.[1]).toMatchObject({
      name: 'contains-check',
      type: 'contains',
      value: 'ok',
    });
  });

  it('rejects explicit g-eval until AgentV implements promptfoo two-call semantics', async () => {
    await expect(
      parseGraders(
        {
          assert: [{ metric: 'geval', type: 'g-eval', value: 'Judge whether it is helpful' }],
        },
        undefined,
        [tempDir],
        'test-1',
      ),
    ).rejects.toThrow("Unsupported grader 'g-eval' in 'test-1'. Use 'llm-rubric' instead.");
  });

  it('rejects known unimplemented promptfoo assertion types', async () => {
    await expect(
      parseGraders(
        {
          assert: [{ metric: 'bleu', type: 'bleu', value: 'reference' }],
        },
        undefined,
        [tempDir],
        'test-1',
      ),
    ).rejects.toThrow("Unsupported promptfoo assertion type 'bleu'");
  });

  it('parses promptfoo trajectory assertion types as built-ins', async () => {
    const evaluators = await parseGraders(
      {
        assert: [
          { metric: 'tool-sequence', type: 'trajectory:tool-sequence', value: ['search'] },
          { type: 'not-trajectory:tool-used', value: 'delete_order' },
        ],
      },
      undefined,
      [tempDir],
      'test-1',
    );

    expect(evaluators).toHaveLength(2);
    expect(evaluators?.[0]).toEqual({
      name: 'tool-sequence',
      type: 'trajectory:tool-sequence',
      value: ['search'],
    } satisfies TrajectoryGraderConfig);
    expect(evaluators?.[1]).toEqual({
      name: 'trajectory:tool-used',
      type: 'trajectory:tool-used',
      value: 'delete_order',
      inverse: true,
    } satisfies TrajectoryGraderConfig);

    await expect(
      parseGraders(
        {
          assert: [{ metric: 'tool-f1', type: 'tool-call-f1', value: ['search'] }],
        },
        undefined,
        [tempDir],
        'test-1',
      ),
    ).rejects.toThrow("Unsupported promptfoo assertion type 'tool-call-f1'");
  });

  it('parses promptfoo-compatible skill-used assertions', async () => {
    const evaluators = await parseGraders(
      {
        assert: [
          { type: 'skill-used', value: 'csv-analyzer' },
          { type: 'not-skill-used', value: { pattern: 'web-*', max: 0 } },
        ],
      },
      undefined,
      [tempDir],
      'test-1',
    );

    expect(evaluators).toHaveLength(2);
    expect(evaluators?.[0]).toMatchObject({
      name: 'skill-used-csv-analyzer',
      type: 'skill-used',
      value: 'csv-analyzer',
    } satisfies Partial<SkillUsedGraderConfig>);
    expect(evaluators?.[1]).toMatchObject({
      name: 'not-skill-used',
      type: 'not-skill-used',
      value: { pattern: 'web-*', max: 0 },
    } satisfies Partial<SkillUsedGraderConfig>);
  });
});

describe('parseGraders - stale authored graders', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = path.join(os.tmpdir(), `agentv-test-eval-parser-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('rejects skill-trigger with skill-used guidance', async () => {
    await expect(
      parseGraders(
        {
          assert: [{ metric: 'skill-check', type: 'skill-trigger', skill: 'csv-analyzer' }],
        },
        undefined,
        [tempDir],
        'test-case',
      ),
    ).rejects.toThrow('Replace skill: csv-analyzer with type: skill-used, value: csv-analyzer');
  });

  it('rejects negative skill-trigger with not-skill-used guidance', async () => {
    await expect(
      parseGraders(
        {
          assert: [
            {
              metric: 'skill-check',
              type: 'skill-trigger',
              skill: 'web-search',
              should_trigger: false,
            },
          ],
        },
        undefined,
        [tempDir],
        'test-case',
      ),
    ).rejects.toThrow('Replace skill: web-search with type: not-skill-used, value: web-search');
  });

  it('rejects tool-trajectory any_order with trajectory:tool-used guidance', async () => {
    await expect(
      parseGraders(
        {
          assert: [
            {
              metric: 'tool-usage-check',
              type: 'tool-trajectory',
              mode: 'any_order',
              minimums: { knowledgeSearch: 3 },
            },
          ],
        },
        undefined,
        [tempDir],
        'test-case',
      ),
    ).rejects.toThrow('trajectory:tool-used');
  });

  it('rejects tool-trajectory ordered steps with sequence and args guidance', async () => {
    await expect(
      parseGraders(
        {
          assert: [
            {
              metric: 'sequence-check',
              type: 'tool-trajectory',
              mode: 'exact',
              expected: [{ tool: 'search', args: { q: 'agentv' } }, { tool: 'fetch' }],
            },
          ],
        },
        undefined,
        [tempDir],
        'test-case',
      ),
    ).rejects.toThrow('trajectory:tool-args-match');
  });

  it('rejects tool-trajectory latency checks as unsupported future scope', async () => {
    await expect(
      parseGraders(
        {
          assert: [
            {
              metric: 'latency-check',
              type: 'tool-trajectory',
              mode: 'exact',
              expected: [{ tool: 'Read', max_duration_ms: 500 }],
            },
          ],
        },
        undefined,
        [tempDir],
        'test-case',
      ),
    ).rejects.toThrow('unsupported future scope');
  });
});

describe('parseGraders - script config pass-through', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = path.join(os.tmpdir(), `agentv-test-script-grader-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    // Create a dummy script file
    await writeFile(path.join(tempDir, 'test_script.ts'), '// dummy script');
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('passes unrecognized properties as config', async () => {
    const rawEvalCase = {
      assert: [
        {
          metric: 'fuzzy-matcher',
          type: 'script',
          command: ['bun', 'run', './test_script.ts'],
          fields: [
            { path: 'supplier.name', threshold: 0.85 },
            { path: 'importer.name', threshold: 0.9 },
          ],
          algorithm: 'levenshtein',
          customOption: true,
        },
      ],
    };

    const evaluators = await parseGraders(rawEvalCase, undefined, [tempDir], 'test-case');

    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0] as ScriptGraderConfig;
    expect(config.type).toBe('script');
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
      assert: [
        {
          metric: 'simple-grader',
          type: 'script',
          command: ['bun', 'run', './test_script.ts'],
        },
      ],
    };

    const evaluators = await parseGraders(rawEvalCase, undefined, [tempDir], 'test-case');

    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0] as ScriptGraderConfig;
    expect(config.type).toBe('script');
    expect(config.config).toBeUndefined();
  });

  it('excludes known properties from config', async () => {
    const rawEvalCase = {
      assert: [
        {
          metric: 'with-weight',
          type: 'script',
          command: ['bun', 'run', './test_script.ts'],
          cwd: tempDir,
          weight: 2.0,
          required: true,
          min_score: 0.75,
          negate: true,
          config: {
            algorithm: 'levenshtein',
            threshold: 0.9,
          },
          threshold: 0.85, // This should go to config
        },
      ],
    };

    const evaluators = await parseGraders(rawEvalCase, undefined, [tempDir], 'test-case');

    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0] as ScriptGraderConfig;
    expect(config.weight).toBe(2.0);
    expect(config.required).toBe(true);
    expect(config.min_score).toBe(0.75);
    expect(config.negate).toBe(true);
    expect(config.config).toEqual({ threshold: 0.9, algorithm: 'levenshtein' });
  });

  it('parses script provider proxy config', async () => {
    const rawEvalCase = {
      assert: [
        {
          metric: 'provider-backed-script',
          type: 'script',
          command: ['bun', 'run', './test_script.ts'],
          provider: { max_calls: 2 },
        },
      ],
    };

    const evaluators = await parseGraders(rawEvalCase, undefined, [tempDir], 'test-case');

    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0] as ScriptGraderConfig;
    expect(config.provider).toEqual({ max_calls: 2 });
    expect(config.config).toBeUndefined();
  });

  it('rejects removed script provider proxy target config', async () => {
    await expect(
      parseGraders(
        {
          assert: [
            {
              metric: 'legacy-provider-access',
              type: 'script',
              command: ['bun', 'run', './test_script.ts'],
              target: { max_calls: 2 },
            },
          ],
        },
        undefined,
        [tempDir],
        'test-case',
      ),
    ).rejects.toThrow(/Script evaluator field 'target' has been removed.*provider/);
  });

  it('converts string commands into argv using a shell', async () => {
    const rawEvalCase = {
      assert: [
        {
          metric: 'shell-command',
          type: 'script',
          command: './test_script.ts',
        },
      ],
    };

    const evaluators = await parseGraders(rawEvalCase, undefined, [tempDir], 'test-case');

    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0] as ScriptGraderConfig;
    if (process.platform === 'win32') {
      expect(config.command).toEqual(['cmd.exe', '/c', './test_script.ts']);
    } else {
      expect(config.command).toEqual(['sh', '-lc', './test_script.ts']);
    }
  });

  it('rejects removed script-grader script alias', async () => {
    await expect(
      parseGraders(
        {
          assert: [
            {
              metric: 'legacy-script',
              type: 'script',
              script: './test_script.ts',
            },
          ],
        },
        undefined,
        [tempDir],
        'test-case',
      ),
    ).rejects.toThrow(/'script' field has been removed.*command/);
  });
});

describe('parseGraders - kebab-case type normalization', () => {
  const tempDir = '/tmp';

  it('normalizes kebab-case grader types to snake_case', async () => {
    const rawEvalCase = {
      assert: [
        {
          metric: 'kebab-llm',
          type: 'llm-rubric',
          prompt: 'test prompt',
          provider: 'grader-low-cost-a',
        },
      ],
    };

    const evaluators = await parseGraders(rawEvalCase, undefined, [tempDir], 'test-case');

    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0].type).toBe('llm-rubric');
    expect((evaluators?.[0] as LlmGraderConfig).target).toBe('grader-low-cost-a');
  });

  it('rejects removed script-grader type', async () => {
    const rawEvalCase = {
      assert: [
        {
          metric: 'kebab-code',
          type: 'script-grader',
          command: ['bun', 'run', './test_script.ts'],
        },
      ],
    };

    await expect(parseGraders(rawEvalCase, undefined, [tempDir], 'test-case')).rejects.toThrow(
      /Unsupported grader 'script-grader'.*Use 'script'/,
    );
  });

  it('accepts script as the subprocess grader type', async () => {
    const rawEvalCase = {
      assert: [
        {
          metric: 'subprocess-check',
          type: 'script',
          command: ['bun', 'run', './test_script.ts'],
        },
      ],
    };

    const evaluators = await parseGraders(rawEvalCase, undefined, [tempDir], 'test-case');

    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0].type).toBe('script');
    expect((evaluators?.[0] as ScriptGraderConfig).command).toEqual([
      'bun',
      'run',
      './test_script.ts',
    ]);
  });

  it('accepts is-json kebab-case as canonical form', async () => {
    const rawEvalCase = {
      assert: [
        {
          metric: 'kebab-json',
          type: 'is-json',
        },
      ],
    };

    const evaluators = await parseGraders(rawEvalCase, undefined, [tempDir], 'test-case');

    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0].type).toBe('is-json');
  });

  it('rejects public llm-grader assertion type with migration guidance', async () => {
    const rawEvalCase = {
      assert: [
        {
          metric: 'public-llm',
          type: 'llm-grader',
          prompt: 'test prompt',
        },
      ],
    };

    await expect(parseGraders(rawEvalCase, undefined, [tempDir], 'test-case')).rejects.toThrow(
      "Unsupported grader 'llm-grader' in 'test-case'. Use 'llm-rubric' for free-form rubric checks or 'agent-rubric' for agentic rubric checks.",
    );
  });

  it('rejects removed snake_case llm-grader alias with migration guidance', async () => {
    const rawEvalCase = {
      assert: [
        {
          metric: 'snake-llm',
          type: 'llm_grader',
          prompt: 'test prompt',
        },
      ],
    };

    await expect(parseGraders(rawEvalCase, undefined, [tempDir], 'test-case')).rejects.toThrow(
      "Unsupported grader 'llm_grader' in 'test-case'. Use 'llm-rubric' for free-form rubric checks or 'agent-rubric' for agentic rubric checks.",
    );
  });

  it('leaves single-word types unchanged', async () => {
    const rawEvalCase = {
      assert: [
        {
          metric: 'contains-check',
          type: 'contains',
          value: 'hello',
        },
      ],
    };

    const evaluators = await parseGraders(rawEvalCase, undefined, [tempDir], 'test-case');

    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0].type).toBe('contains');
  });
});

describe('parseGraders - score_ranges rubrics', () => {
  it('parses valid score_ranges with min_score', async () => {
    const rawEvalCase = {
      assert: [
        {
          metric: 'correctness',
          type: 'llm-rubric',
          value: [
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

    const evaluators = await parseGraders(rawEvalCase, undefined, [process.cwd()], 'test-case');

    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0];
    expect(config?.type).toBe('llm-rubric');
    if (config?.type === 'llm-rubric') {
      expect(config.rubrics).toHaveLength(1);
      const rubric = config.rubrics?.[0];
      expect(rubric?.id).toBe('accuracy');
      expect(rubric?.weight).toBe(2.0);
      expect(rubric?.min_score).toBe(0.7);
      expect(rubric?.score_ranges).toHaveLength(4);
    }
  });

  it('rejects removed required_min_score', async () => {
    const rawEvalCase = {
      assert: [
        {
          metric: 'correctness',
          type: 'llm-rubric',
          value: [
            {
              id: 'accuracy',
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

    await expect(
      parseGraders(rawEvalCase, undefined, [process.cwd()], 'test-case'),
    ).rejects.toThrow(/required_min_score.*has been removed/i);
  });

  it('throws on overlapping score_ranges', async () => {
    const rawEvalCase = {
      assert: [
        {
          metric: 'overlapping',
          type: 'llm-rubric',
          value: [
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
      parseGraders(rawEvalCase, undefined, [process.cwd()], 'test-case'),
    ).rejects.toThrow(/overlapping/i);
  });

  it('throws on incomplete score_ranges coverage', async () => {
    const rawEvalCase = {
      assert: [
        {
          metric: 'incomplete',
          type: 'llm-rubric',
          value: [
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
      parseGraders(rawEvalCase, undefined, [process.cwd()], 'test-case'),
    ).rejects.toThrow(/coverage/i);
  });

  it('keeps legacy description objects as promptfoo-compatible llm-rubric value', async () => {
    const rawEvalCase = {
      assert: [
        {
          metric: 'legacy',
          type: 'llm-rubric',
          value: [
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

    const evaluators = await parseGraders(rawEvalCase, undefined, [process.cwd()], 'test-case');

    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0];
    if (config?.type !== 'llm-rubric') {
      throw new Error('expected llm-rubric config');
    }
    expect(config.rubrics).toBeUndefined();
    expect(config.value).toEqual([
      {
        id: 'r1',
        description: 'Must be polite',
        weight: 1.0,
        required: true,
      },
    ]);
  });
});

describe('parseGraders - score_ranges shorthand map', () => {
  it('normalizes shorthand map to correct array format', async () => {
    const rawEvalCase = {
      assert: [
        {
          metric: 'shorthand-test',
          type: 'llm-rubric',
          value: [
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

    const evaluators = await parseGraders(rawEvalCase, undefined, [process.cwd()], 'test-case');

    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0];
    expect(config?.type).toBe('llm-rubric');
    if (config?.type === 'llm-rubric') {
      expect(config.rubrics).toHaveLength(1);
      const rubric = config.rubrics?.[0];
      expect(rubric?.id).toBe('accuracy');
      expect(rubric?.min_score).toBe(0.7);
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
      assert: [
        {
          metric: 'bad-start',
          type: 'llm-rubric',
          value: [
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
      parseGraders(rawEvalCase, undefined, [process.cwd()], 'test-case'),
    ).rejects.toThrow(/must start at 0/);
  });

  it('passes through existing array format unchanged', async () => {
    const rawEvalCase = {
      assert: [
        {
          metric: 'array-format',
          type: 'llm-rubric',
          value: [
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

    const evaluators = await parseGraders(rawEvalCase, undefined, [process.cwd()], 'test-case');

    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0];
    if (config?.type === 'llm-rubric') {
      expect(config.rubrics?.[0]?.score_ranges).toHaveLength(4);
    }
  });
});

describe('parseGraders - token-usage', () => {
  it('parses token-usage evaluator with limits', async () => {
    const rawEvalCase = {
      assert: [
        {
          metric: 'token-budget',
          type: 'token-usage',
          max_total: 1000,
          max_output: 200,
        },
      ],
    };

    const evaluators = await parseGraders(rawEvalCase, undefined, [process.cwd()], 'test-case');

    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0]).toEqual({
      name: 'token-budget',
      type: 'token-usage',
      max_total: 1000,
      max_output: 200,
    });
  });

  it('inherits suite-level assert when case has execution object without assert', async () => {
    const rawEvalCase = {
      execution: {
        constraints: {
          max_total_tokens: 123,
        },
      },
    };

    const globalExecution = {
      assert: [
        {
          metric: 'token-budget',
          type: 'token-usage',
          max_total: 1000,
          max_output: 200,
        },
      ],
    };

    const evaluators = await parseGraders(rawEvalCase, globalExecution, [process.cwd()], 'test');

    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0]).toEqual({
      name: 'token-budget',
      type: 'token-usage',
      max_total: 1000,
      max_output: 200,
    });
  });
});

describe('parseGraders - execution-metrics', () => {
  it('parses execution-metrics evaluator with all thresholds', async () => {
    const rawEvalCase = {
      assert: [
        {
          metric: 'efficiency-check',
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

    const evaluators = await parseGraders(rawEvalCase, undefined, [process.cwd()], 'test-case');

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
      assert: [
        {
          metric: 'tool-limit',
          type: 'execution-metrics',
          max_tool_calls: 15,
        },
      ],
    };

    const evaluators = await parseGraders(rawEvalCase, undefined, [process.cwd()], 'test-case');

    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0]).toEqual({
      name: 'tool-limit',
      type: 'execution-metrics',
      max_tool_calls: 15,
    });
  });

  it('parses execution-metrics with camelCase aliases', async () => {
    const rawEvalCase = {
      assert: [
        {
          metric: 'camel-case',
          type: 'execution-metrics',
          maxToolCalls: 10,
          maxLlmCalls: 5,
          maxTokens: 2000,
          maxCostUsd: 0.1,
          maxDurationMs: 5000,
        },
      ],
    };

    const evaluators = await parseGraders(rawEvalCase, undefined, [process.cwd()], 'test-case');

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
      assert: [
        {
          metric: 'no-thresholds',
          type: 'execution-metrics',
        },
      ],
    };

    const evaluators = await parseGraders(rawEvalCase, undefined, [process.cwd()], 'test-case');

    expect(evaluators).toBeUndefined();
  });

  it('skips execution-metrics when only exploration_tolerance is set (no threshold)', async () => {
    const rawEvalCase = {
      assert: [
        {
          metric: 'only-tolerance',
          type: 'execution-metrics',
          exploration_tolerance: 0.2,
        },
      ],
    };

    const evaluators = await parseGraders(rawEvalCase, undefined, [process.cwd()], 'test-case');

    expect(evaluators).toBeUndefined();
  });

  it('skips execution-metrics with invalid threshold value (negative)', async () => {
    const rawEvalCase = {
      assert: [
        {
          metric: 'negative-threshold',
          type: 'execution-metrics',
          max_tool_calls: -5,
        },
      ],
    };

    const evaluators = await parseGraders(rawEvalCase, undefined, [process.cwd()], 'test-case');

    expect(evaluators).toBeUndefined();
  });

  it('skips execution-metrics with invalid threshold value (non-number)', async () => {
    const rawEvalCase = {
      assert: [
        {
          metric: 'string-threshold',
          type: 'execution-metrics',
          max_tool_calls: 'ten',
        },
      ],
    };

    const evaluators = await parseGraders(rawEvalCase, undefined, [process.cwd()], 'test-case');

    expect(evaluators).toBeUndefined();
  });

  it('skips execution-metrics with Infinity threshold value', async () => {
    const rawEvalCase = {
      assert: [
        {
          metric: 'infinity-threshold',
          type: 'execution-metrics',
          max_tokens: Number.POSITIVE_INFINITY,
        },
      ],
    };

    const evaluators = await parseGraders(rawEvalCase, undefined, [process.cwd()], 'test-case');

    expect(evaluators).toBeUndefined();
  });

  it('parses execution-metrics with target_exploration_ratio', async () => {
    const rawEvalCase = {
      assert: [
        {
          metric: 'exploration-check',
          type: 'execution-metrics',
          target_exploration_ratio: 0.7,
        },
      ],
    };

    const evaluators = await parseGraders(rawEvalCase, undefined, [process.cwd()], 'test-case');

    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0]).toEqual({
      name: 'exploration-check',
      type: 'execution-metrics',
      target_exploration_ratio: 0.7,
    });
  });
});

describe('parseGraders - default evaluators merge', () => {
  it('appends root evaluators after case-level evaluators', async () => {
    const rawEvalCase = {
      execution: {
        assert: [{ metric: 'case-eval', type: 'latency', threshold: 3000 }],
      },
    };

    const globalExecution = {
      assert: [{ metric: 'root-eval', type: 'latency', threshold: 5000 }],
    };

    const evaluators = await parseGraders(rawEvalCase, globalExecution, [process.cwd()], 'test');

    expect(evaluators).toHaveLength(2);
    expect(evaluators?.[0]).toEqual({ name: 'case-eval', type: 'latency', threshold: 3000 });
    expect(evaluators?.[1]).toEqual({ name: 'root-eval', type: 'latency', threshold: 5000 });
  });

  it('uses only root evaluators when case has none', async () => {
    const rawEvalCase = {};

    const globalExecution = {
      assert: [{ metric: 'root-eval', type: 'latency', threshold: 5000 }],
    };

    const evaluators = await parseGraders(rawEvalCase, globalExecution, [process.cwd()], 'test');

    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0]).toEqual({ name: 'root-eval', type: 'latency', threshold: 5000 });
  });

  it('skips root evaluators when skip_defaults is true', async () => {
    const rawEvalCase = {
      execution: {
        skip_defaults: true,
        assert: [{ metric: 'case-eval', type: 'latency', threshold: 3000 }],
      },
    };

    const globalExecution = {
      assert: [{ metric: 'root-eval', type: 'latency', threshold: 5000 }],
    };

    const evaluators = await parseGraders(rawEvalCase, globalExecution, [process.cwd()], 'test');

    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0]).toEqual({ name: 'case-eval', type: 'latency', threshold: 3000 });
  });

  it('returns undefined when no evaluators at any level', async () => {
    const rawEvalCase = {};
    const evaluators = await parseGraders(rawEvalCase, undefined, [process.cwd()], 'test');
    expect(evaluators).toBeUndefined();
  });

  it('returns undefined when skip_defaults and no case evaluators', async () => {
    const rawEvalCase = {
      execution: { skip_defaults: true },
    };

    const globalExecution = {
      assert: [{ metric: 'root-eval', type: 'latency', threshold: 5000 }],
    };

    const evaluators = await parseGraders(rawEvalCase, globalExecution, [process.cwd()], 'test');
    expect(evaluators).toBeUndefined();
  });

  it('backward compat: case with execution object but no evaluators inherits root', async () => {
    const rawEvalCase = {
      execution: {
        constraints: { max_total_tokens: 123 },
      },
    };

    const globalExecution = {
      assert: [{ metric: 'root-eval', type: 'latency', threshold: 5000 }],
    };

    const evaluators = await parseGraders(rawEvalCase, globalExecution, [process.cwd()], 'test');

    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0]).toEqual({ name: 'root-eval', type: 'latency', threshold: 5000 });
  });

  it('case top-level evaluators field also merges with root', async () => {
    const rawEvalCase = {
      assert: [{ metric: 'case-eval', type: 'latency', threshold: 3000 }],
    };

    const globalExecution = {
      assert: [{ metric: 'root-eval', type: 'latency', threshold: 5000 }],
    };

    const evaluators = await parseGraders(rawEvalCase, globalExecution, [process.cwd()], 'test');

    expect(evaluators).toHaveLength(2);
    expect(evaluators?.[0]).toEqual({ name: 'case-eval', type: 'latency', threshold: 3000 });
    expect(evaluators?.[1]).toEqual({ name: 'root-eval', type: 'latency', threshold: 5000 });
  });
});

describe('parseGraders - assert field', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = path.join(os.tmpdir(), `agentv-test-assert-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('parses assert field as evaluators', async () => {
    const evaluators = await parseGraders(
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

  it('assert takes precedence over execution.assert', async () => {
    const evaluators = await parseGraders(
      {
        assert: [{ type: 'contains', value: 'DENIED' }],
        execution: {
          assert: [{ metric: 'latency-check', type: 'latency', threshold: 5000 }],
        },
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0].type).toBe('contains');
  });

  it('merges suite-level assert entries with test-level assert entries', async () => {
    const evaluators = await parseGraders(
      {
        assert: [{ type: 'contains', value: 'DENIED' }],
      },
      { assert: [{ metric: 'latency-check', type: 'latency', threshold: 5000 }] },
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(2);
    expect(evaluators?.[0].type).toBe('contains');
    expect(evaluators?.[1].type).toBe('latency');
  });

  it('skip_defaults prevents suite-level assert entries from being appended', async () => {
    const evaluators = await parseGraders(
      {
        assert: [{ type: 'contains', value: 'DENIED' }],
        execution: { skip_defaults: true },
      },
      { assert: [{ metric: 'latency-check', type: 'latency', threshold: 5000 }] },
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0].type).toBe('contains');
  });

  it('falls back to execution.assert when assert is not present', async () => {
    const evaluators = await parseGraders(
      {
        execution: {
          assert: [{ metric: 'latency-check', type: 'latency', threshold: 5000 }],
        },
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0].type).toBe('latency');
  });

  it('falls back to execution.assert when case-level assert is not present', async () => {
    const evaluators = await parseGraders(
      {
        execution: {
          assert: [{ type: 'contains', value: 'EXEC' }],
        },
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0]).toMatchObject({ type: 'contains', value: 'EXEC' });
  });

  it('falls back to suite-level assert', async () => {
    const evaluators = await parseGraders(
      {},
      {
        assert: [{ metric: 'latency-check', type: 'latency', threshold: 5000 }],
      },
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0].type).toBe('latency');
  });
});

describe('parseGraders - assertion templates', () => {
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
assert:
  - type: contains
    value: shared
`,
    );

    const evaluators = await parseGraders(
      {
        assert: [{ include: 'shared' }],
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
assert:
  - type: contains
    value: local
`,
    );

    const evaluators = await parseGraders(
      {
        assert: [{ type: 'contains', value: 'case-only' }],
        execution: { skip_defaults: true },
      },
      {
        assert: [{ include: './shared/local.yaml' }],
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
assert:
  - include: ./inner.yaml
  - type: regex
    value: nested
`,
    );
    await writeTemplate(
      'templates/nested/inner.yaml',
      `
assert:
  - type: contains
    value: inner
`,
    );

    const evaluators = await parseGraders(
      {
        assert: [{ include: './templates/nested/outer.yaml' }],
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
assert:
  - include: level-b
`,
    );
    await writeTemplate(
      '.agentv/templates/level-b.yaml',
      `
assert:
  - include: level-c
`,
    );
    await writeTemplate(
      '.agentv/templates/level-c.yaml',
      `
assert:
  - type: contains
    value: nested-ok
`,
    );

    const evaluators = await parseGraders(
      {
        assert: [{ include: 'level-a' }],
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
assert:
  - include: depth-b
`,
    );
    await writeTemplate(
      '.agentv/templates/depth-b.yaml',
      `
assert:
  - include: depth-c
`,
    );
    await writeTemplate(
      '.agentv/templates/depth-c.yaml',
      `
assert:
  - include: depth-d
`,
    );
    await writeTemplate(
      '.agentv/templates/depth-d.yaml',
      `
assert:
  - type: contains
    value: too-deep
`,
    );

    await expect(
      parseGraders(
        {
          assert: [{ include: 'depth-a' }],
        },
        undefined,
        [tempDir],
        'test-4',
      ),
    ).rejects.toThrow(/depth exceeded 3/i);
  });

  it('throws a clear error when a template is missing', async () => {
    await expect(
      parseGraders(
        {
          assert: [{ include: 'missing-template' }],
        },
        undefined,
        [tempDir],
        'test-5',
      ),
    ).rejects.toThrow(/\.agentv[/\\]templates[/\\]missing-template\.yaml/);
  });
});

describe('parseGraders - structured llm-rubric value', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = path.join(os.tmpdir(), `agentv-test-llm-rubric-value-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('parses structured value array as rubric items', async () => {
    const evaluators = await parseGraders(
      {
        assert: [
          {
            type: 'llm-rubric',
            value: [
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
    expect(evaluators?.[0].type).toBe('llm-rubric');
    expect((evaluators?.[0] as LlmRubricGraderConfig).rubrics).toHaveLength(2);
    expect((evaluators?.[0] as LlmRubricGraderConfig).weight).toBe(4.0);
  });

  it('preserves optional rubric criterion operators', async () => {
    const evaluators = await parseGraders(
      {
        assert: [
          {
            type: 'llm-rubric',
            value: [
              {
                id: 'correct-fact',
                operator: 'correctness',
                outcome: 'Revenue increased to $10M',
              },
              {
                id: 'no-conflict',
                operator: 'contradiction',
                outcome: 'Revenue increased to $10M',
              },
            ],
          },
        ],
      },
      undefined,
      [tempDir],
      'test-1',
    );

    const config = evaluators?.[0] as LlmRubricGraderConfig;
    expect(config.rubrics?.[0]?.operator).toBe('correctness');
    expect(config.rubrics?.[1]?.operator).toBe('contradiction');
  });

  it('ignores invalid rubric criterion operators without dropping the criterion', async () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    const evaluators = await parseGraders(
      {
        assert: [
          {
            type: 'llm-rubric',
            value: [
              {
                id: 'fact',
                operator: 'unsupported',
                outcome: 'Revenue increased to $10M',
              },
            ],
          },
        ],
      },
      undefined,
      [tempDir],
      'test-1',
    );

    const config = evaluators?.[0] as LlmRubricGraderConfig;
    expect(config.rubrics).toHaveLength(1);
    expect(config.rubrics?.[0]?.operator).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Ignoring invalid operator'));
    warnSpy.mockRestore();
  });

  it('auto-generates name for llm-rubric type', async () => {
    const evaluators = await parseGraders(
      {
        assert: [
          {
            type: 'llm-rubric',
            value: [{ id: 'check-1', outcome: 'Some check', weight: 1.0 }],
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

  it('skips llm-rubric with empty value array', async () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    const evaluators = await parseGraders(
      {
        assert: [
          {
            type: 'llm-rubric',
            value: [],
          },
        ],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('expected value or prompt'));
    warnSpy.mockRestore();
  });

  it('skips llm-rubric with missing value', async () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    const evaluators = await parseGraders(
      {
        assert: [
          {
            type: 'llm-rubric',
          },
        ],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('expected value or prompt'));
    warnSpy.mockRestore();
  });

  it('supports string items in value arrays', async () => {
    const evaluators = await parseGraders(
      {
        assert: [
          {
            type: 'llm-rubric',
            value: ['Must be polite', 'Must be accurate'],
          },
        ],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    expect((evaluators?.[0] as LlmRubricGraderConfig).rubrics).toHaveLength(2);
  });

  it('preserves score_ranges in structured value array', async () => {
    const evaluators = await parseGraders(
      {
        assert: [
          {
            type: 'llm-rubric',
            value: [
              {
                id: 'quality',
                outcome: 'Answer quality',
                min_score: 0.8,
                score_ranges: [
                  { score_range: [0, 4], outcome: 'Weak' },
                  { score_range: [5, 7], outcome: 'Adequate' },
                  { score_range: [8, 10], outcome: 'Strong' },
                ],
              },
            ],
          },
        ],
      },
      undefined,
      [tempDir],
      'test-1',
    );

    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0] as LlmRubricGraderConfig;
    expect(config.name).toBe('llm-rubric');
    expect(config.type).toBe('llm-rubric');
    expect(config.rubrics?.[0]?.min_score).toBe(0.8);
    expect(config.rubrics?.[0]?.score_ranges).toEqual([
      { score_range: [0, 4], outcome: 'Weak' },
      { score_range: [5, 7], outcome: 'Adequate' },
      { score_range: [8, 10], outcome: 'Strong' },
    ]);
  });

  it('rejects structured criteria fields on llm-rubric', async () => {
    await expect(
      parseGraders(
        {
          assert: [
            {
              type: 'llm-rubric',
              criteria: [{ id: 'check-1', outcome: 'Some check' }],
            },
          ],
        },
        undefined,
        [tempDir],
        'test-1',
      ),
    ).rejects.toThrow(
      "Unsupported llm-rubric field 'criteria' in 'test-1' for evaluator 'llm-rubric'. Use 'value' instead.",
    );
  });
});

describe('parseGraders - required field', () => {
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
    const evaluators = await parseGraders(
      {
        assert: [{ metric: 'check', type: 'contains', value: 'DENIED', required: true }],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0] as ContainsGraderConfig;
    expect(config.required).toBe(true);
  });

  it('rejects required: 0.6 numeric threshold on contains evaluator', async () => {
    await expect(
      parseGraders(
        {
          assert: [{ metric: 'check', type: 'contains', value: 'DENIED', required: 0.6 }],
        },
        undefined,
        [tempDir],
        'test-1',
      ),
    ).rejects.toThrow(/numeric 'required: 0\.6' has been removed/i);
  });

  it('parses required: true with min_score on contains evaluator', async () => {
    const evaluators = await parseGraders(
      {
        assert: [
          {
            metric: 'check',
            type: 'contains',
            value: 'DENIED',
            required: true,
            min_score: 0.6,
          },
        ],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0] as ContainsGraderConfig;
    expect(config.required).toBe(true);
    expect(config.min_score).toBe(0.6);
  });

  it('ignores required: false', async () => {
    const evaluators = await parseGraders(
      {
        assert: [{ metric: 'check', type: 'contains', value: 'DENIED', required: false }],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0] as ContainsGraderConfig;
    expect(config.required).toBeUndefined();
  });

  it('parses required on latency evaluator', async () => {
    const evaluators = await parseGraders(
      {
        assert: [{ metric: 'lat', type: 'latency', threshold: 5000, required: true }],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0] as LatencyGraderConfig;
    expect(config.required).toBe(true);
  });

  it('parses required on script evaluator', async () => {
    const evaluators = await parseGraders(
      {
        assert: [
          {
            metric: 'code-check',
            type: 'script',
            command: ['bun', 'run', './test_script.ts'],
            required: true,
          },
        ],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0] as ScriptGraderConfig;
    expect(config.required).toBe(true);
  });

  it('parses required with min_score on llm-rubric evaluator', async () => {
    const evaluators = await parseGraders(
      {
        assert: [
          {
            metric: 'grader',
            type: 'llm-rubric',
            value: 'Judge whether it is helpful',
            required: true,
            min_score: 0.7,
          },
        ],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0] as LlmGraderConfig;
    expect(config.required).toBe(true);
    expect(config.min_score).toBe(0.7);
  });

  it('rejects numeric required values', async () => {
    await expect(
      parseGraders(
        {
          assert: [{ metric: 'check', type: 'contains', value: 'DENIED', required: 0 }],
        },
        undefined,
        [tempDir],
        'test-1',
      ),
    ).rejects.toThrow(/numeric 'required: 0' has been removed/i);

    await expect(
      parseGraders(
        {
          assert: [{ metric: 'check', type: 'contains', value: 'DENIED', required: 1.5 }],
        },
        undefined,
        [tempDir],
        'test-1',
      ),
    ).rejects.toThrow(/numeric 'required: 1\.5' has been removed/i);

    await expect(
      parseGraders(
        {
          assert: [{ metric: 'check', type: 'contains', value: 'DENIED', required: -0.5 }],
        },
        undefined,
        [tempDir],
        'test-1',
      ),
    ).rejects.toThrow(/numeric 'required: -0\.5' has been removed/i);
  });

  it('ignores non-numeric invalid required values', async () => {
    const evaluators = await parseGraders(
      {
        assert: [{ metric: 'c1', type: 'contains', value: 'A', required: 'yes' }],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    for (const config of evaluators ?? []) {
      expect((config as ContainsGraderConfig).required).toBeUndefined();
    }
  });
});

describe('parseGraders - assert-set grouping', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = path.join(os.tmpdir(), `agentv-test-assert-set-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    // Create dummy prompt files for llm-rubric members (must include required template fields)
    await writeFile(path.join(tempDir, 'safety.md'), 'Evaluate safety of {{ output }}');
    await writeFile(path.join(tempDir, 'quality.md'), 'Evaluate quality of {{ output }}');
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('parses assert-set with assert field', async () => {
    const evaluators = await parseGraders(
      {
        assert: [
          {
            metric: 'combined',
            type: 'assert-set',
            assert: [
              { metric: 'safety', type: 'llm-rubric', prompt: './safety.md' },
              { metric: 'quality', type: 'llm-rubric', prompt: './quality.md' },
            ],
            threshold: 0.7,
          },
        ],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    const assertSet = evaluators?.[0] as AssertSetGraderConfig;
    expect(assertSet.type).toBe('assert-set');
    expect(assertSet.threshold).toBe(0.7);
    expect(assertSet.assertions).toHaveLength(2);
  });

  it('propagates assert-set config into child assertions', async () => {
    const evaluators = await parseGraders(
      {
        assert: [
          {
            metric: 'semantic_similarity',
            type: 'assert-set',
            config: {
              embedding_provider: {
                base_url: 'http://127.0.0.1:1234/v1',
                model: 'text-embedding-test',
              },
              shared: 'parent',
              child_override: 'parent',
            },
            assert: [
              {
                metric: 'similarity',
                type: 'similar',
                value: 'Paris is the capital of France.',
                config: {
                  child_override: 'child',
                },
              },
              {
                metric: 'scripted',
                type: 'javascript',
                value: 'context.config.shared === "parent"',
              },
            ],
          },
        ],
      },
      undefined,
      [tempDir],
      'test-1',
    );

    const assertSet = evaluators?.[0] as AssertSetGraderConfig;
    expect(assertSet.type).toBe('assert-set');
    expect(assertSet.config).toEqual({
      embedding_provider: {
        base_url: 'http://127.0.0.1:1234/v1',
        model: 'text-embedding-test',
      },
      shared: 'parent',
      child_override: 'parent',
    });
    expect(assertSet.assertions[0]).toMatchObject({
      type: 'similar',
      config: {
        embedding_provider: {
          base_url: 'http://127.0.0.1:1234/v1',
          model: 'text-embedding-test',
        },
        shared: 'parent',
        child_override: 'child',
      },
    });
    expect(assertSet.assertions[1]).toMatchObject({
      type: 'javascript',
      config: {
        embedding_provider: {
          base_url: 'http://127.0.0.1:1234/v1',
          model: 'text-embedding-test',
        },
        shared: 'parent',
        child_override: 'parent',
      },
    });
  });

  it('keeps llm-rubric child assertions inside assert-set groups', async () => {
    const evaluators = await parseGraders(
      {
        assert: [
          {
            metric: 'combined',
            type: 'assert-set',
            assert: [
              { metric: 'safety', type: 'llm-rubric', prompt: './safety.md' },
              { metric: 'quality', type: 'llm-rubric', prompt: './quality.md' },
            ],
          },
        ],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    const assertSet = evaluators?.[0] as AssertSetGraderConfig;
    expect(assertSet.type).toBe('assert-set');
    expect(assertSet.assertions.map((assertion) => assertion.type)).toEqual([
      'llm-rubric',
      'llm-rubric',
    ]);
  });

  it('rejects composite with an assert-set migration hint', async () => {
    await expect(
      parseGraders(
        {
          assert: [
            {
              metric: 'combined',
              type: 'composite',
              assert: [{ metric: 'safety', type: 'contains', value: 'safe' }],
              aggregator: { type: 'weighted_average' },
            },
          ],
        },
        undefined,
        [tempDir],
        'test-1',
      ),
    ).rejects.toThrow("Unsupported grader 'composite' in 'test-1'. Use 'assert-set' instead.");
  });
});

describe('parseGraders - string shorthand in assert', () => {
  it('treats all-string assert array as a single rubrics evaluator', async () => {
    const evaluators = await parseGraders(
      {
        assert: [
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
    expect(rubrics?.type).toBe('llm-rubric');
    expect((rubrics as LlmRubricGraderConfig).rubrics).toHaveLength(3);
    expect((rubrics as LlmRubricGraderConfig).rubrics?.[0].outcome).toBe(
      'Mentions divide-and-conquer approach',
    );
    expect((rubrics as LlmRubricGraderConfig).rubrics?.[1].outcome).toBe('Explains partition step');
    expect((rubrics as LlmRubricGraderConfig).rubrics?.[2].outcome).toBe('States time complexity');
  });

  it('groups strings into rubrics and preserves object evaluators', async () => {
    const evaluators = await parseGraders(
      {
        assert: [
          'Mentions divide-and-conquer approach',
          { metric: 'syntax-check', type: 'contains', value: 'quicksort' },
          'States time complexity',
        ],
      },
      undefined,
      ['/tmp'],
      'test-id',
    );

    expect(evaluators).toHaveLength(2);
    // First: rubrics (at position of first string)
    expect(evaluators?.[0].type).toBe('llm-rubric');
    expect((evaluators?.[0] as LlmRubricGraderConfig).rubrics).toHaveLength(2);
    expect((evaluators?.[0] as LlmRubricGraderConfig).rubrics?.[0].outcome).toBe(
      'Mentions divide-and-conquer approach',
    );
    // Second: the contains evaluator
    expect(evaluators?.[1].type).toBe('contains');
    expect(evaluators?.[1].name).toBe('syntax-check');
  });

  it('treats a single string as a single-criterion rubrics evaluator', async () => {
    const evaluators = await parseGraders(
      {
        assert: ['Response must be polite'],
      },
      undefined,
      ['/tmp'],
      'test-id',
    );

    expect(evaluators).toHaveLength(1);
    expect(evaluators?.[0].type).toBe('llm-rubric');
    expect((evaluators?.[0] as LlmRubricGraderConfig).rubrics).toHaveLength(1);
    expect((evaluators?.[0] as LlmRubricGraderConfig).rubrics?.[0].outcome).toBe(
      'Response must be polite',
    );
  });

  it('ignores all-whitespace strings and produces no rubrics evaluator', async () => {
    const evaluators = await parseGraders(
      {
        assert: ['   ', ''],
      },
      undefined,
      ['/tmp'],
      'test-id',
    );

    expect(evaluators).toBeUndefined();
  });

  it('sets rubrics grader weight = criteria count when mixed with other graders', async () => {
    // User sees 4 assertions; each should contribute equal weight.
    // rubrics(w=3) + contains(w=1) → each visible assertion = 1/4.
    const evaluators = await parseGraders(
      {
        assert: [
          'Identifies the undefined access',
          'Suggests a null-safe fix',
          'Explains why the original code is dangerous',
          { type: 'contains', value: 'null' },
        ],
      },
      undefined,
      ['/tmp'],
      'test-id',
    );

    expect(evaluators).toHaveLength(2);
    const rubrics = evaluators?.[0] as LlmRubricGraderConfig;
    expect(rubrics.type).toBe('llm-rubric');
    expect(rubrics.rubrics).toHaveLength(3);
    expect(rubrics.weight).toBe(3);
    expect(evaluators?.[1].type).toBe('contains');
    expect(evaluators?.[1].weight).toBeUndefined(); // explicit graders keep their own weight
  });
});

describe('parseGraders - file:// prefix prompt resolution', () => {
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
    const evaluators = await parseGraders(
      {
        assert: [
          {
            metric: 'quality',
            type: 'llm-rubric',
            value: 'Judge the answer quality',
            prompt: 'file://grader.md',
          },
        ],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0] as LlmGraderConfig;
    expect(config.promptPath).toBeTruthy();
    expect(config.promptPath).toContain('grader.md');
  });

  it('file:// prefix throws when file not found', async () => {
    await expect(
      parseGraders(
        {
          assert: [{ metric: 'missing', type: 'llm-rubric', prompt: 'file://nonexistent.md' }],
        },
        undefined,
        [tempDir],
        'test-1',
      ),
    ).rejects.toThrow(/prompt file not found/);
  });

  it('bare path is always treated as inline text even if file exists', async () => {
    const evaluators = await parseGraders(
      {
        assert: [{ metric: 'quality', type: 'llm-rubric', prompt: 'grader.md' }],
      },
      undefined,
      [tempDir],
      'test-1',
    );
    expect(evaluators).toHaveLength(1);
    const config = evaluators?.[0] as LlmGraderConfig;
    // Bare string is inline text — no file resolution, no promptPath
    expect(config.prompt).toBe('grader.md');
    expect(config.promptPath).toBeUndefined();
  });
});
