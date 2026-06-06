import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { loadTests } from '../../src/evaluation/yaml-parser.js';

describe('rubric criterion operators', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('converts YAML operator fields into typed internal rubric items', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'agentv-rubric-operators-'));
    tempDirs.push(dir);

    await writeFile(
      path.join(dir, 'suite.eval.yaml'),
      `tests:
  - id: finance-summary
    input: "Summarize the finance note"
    criteria: "Keep supported facts and avoid contradictions"
    assertions:
      - type: rubrics
        criteria:
          - id: supported-revenue
            operator: correctness
            outcome: "States revenue increased to $10M"
          - id: no-revenue-conflict
            operator: contradiction
            outcome: "Revenue increased to $10M"
`,
      'utf8',
    );

    const tests = await loadTests(path.join(dir, 'suite.eval.yaml'), dir);
    const evaluator = tests[0]?.assertions?.[0];

    expect(evaluator?.type).toBe('llm-grader');
    if (!evaluator || evaluator.type !== 'llm-grader') {
      throw new Error('expected rubrics to normalize to llm-grader');
    }

    expect(evaluator.rubrics?.map((rubric) => rubric.operator)).toEqual([
      'correctness',
      'contradiction',
    ]);
  });
});
