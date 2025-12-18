import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { parseEvaluators } from '../../../src/evaluation/loaders/evaluator-parser.js';
import type { ToolTrajectoryEvaluatorConfig } from '../../../src/evaluation/trace.js';

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
