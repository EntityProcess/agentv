import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { loadTests } from '../../src/evaluation/yaml-parser.js';

describe('eval YAML preprocessors', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('merges suite-level preprocessors into llm-graders and resolves command paths', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'agentv-yaml-preprocessors-'));
    tempDirs.push(dir);

    await writeFile(path.join(dir, 'xlsx-default.js'), 'console.log("default")', 'utf8');
    await writeFile(path.join(dir, 'xlsx-override.js'), 'console.log("override")', 'utf8');
    await writeFile(
      path.join(dir, 'suite.eval.yaml'),
      `preprocessors:
  - type: xlsx
    command: ["node", "xlsx-default.js"]
tests:
  - id: report
    input: "grade this"
    criteria: "works"
    assertions:
      - name: grade
        type: llm-grader
        prompt: "Evaluate {{ output }}"
        preprocessors:
          - type: xlsx
            command: ["node", "xlsx-override.js"]
`,
      'utf8',
    );

    const tests = await loadTests(path.join(dir, 'suite.eval.yaml'), dir);
    const evaluator = tests[0]?.assertions?.[0];

    expect(evaluator?.type).toBe('llm-grader');
    if (!evaluator || evaluator.type !== 'llm-grader') {
      throw new Error('expected llm-grader evaluator');
    }

    expect(evaluator.preprocessors).toHaveLength(1);
    expect(evaluator.preprocessors?.[0]?.resolvedCommand?.[1]).toBe(
      path.join(dir, 'xlsx-override.js'),
    );
  });

  it('lets alias-based evaluator overrides replace MIME-typed suite defaults', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'agentv-yaml-preprocessors-'));
    tempDirs.push(dir);

    await writeFile(path.join(dir, 'xlsx-default.js'), 'console.log("default")', 'utf8');
    await writeFile(path.join(dir, 'xlsx-override.js'), 'console.log("override")', 'utf8');
    await writeFile(
      path.join(dir, 'suite.eval.yaml'),
      `preprocessors:
  - type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
    command: ["node", "xlsx-default.js"]
tests:
  - id: report
    input: "grade this"
    criteria: "works"
    assertions:
      - name: grade
        type: llm-grader
        prompt: "Evaluate {{ output }}"
        preprocessors:
          - type: xlsx
            command: ["node", "xlsx-override.js"]
`,
      'utf8',
    );

    const tests = await loadTests(path.join(dir, 'suite.eval.yaml'), dir);
    const evaluator = tests[0]?.assertions?.[0];
    if (!evaluator || evaluator.type !== 'llm-grader') {
      throw new Error('expected llm-grader evaluator');
    }

    expect(evaluator.preprocessors).toHaveLength(1);
    expect(evaluator.preprocessors?.[0]?.resolvedCommand?.[1]).toBe(
      path.join(dir, 'xlsx-override.js'),
    );
  });
});
