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

  it('rejects removed suite-level preprocessors with transform guidance', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'agentv-yaml-preprocessors-'));
    tempDirs.push(dir);

    await writeFile(
      path.join(dir, 'suite.eval.yaml'),
      `preprocessors:
  - type: xlsx
    command:
      - node
      - xlsx-default.js
prompts:
  - "{{ input }}"
tests:
  - id: report
    criteria: works
    vars:
      input: grade this
`,
      'utf8',
    );

    await expect(loadTests(path.join(dir, 'suite.eval.yaml'), dir)).rejects.toThrow(
      'preprocessors has been removed from authored eval YAML. Use default_test.options.transform or assertion-level transform instead.',
    );
  });

  it('rejects removed assertion preprocessors with transform guidance', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'agentv-yaml-preprocessors-'));
    tempDirs.push(dir);

    await writeFile(
      path.join(dir, 'suite.eval.yaml'),
      `prompts:
  - "{{ input }}"
tests:
  - id: report
    criteria: works
    assert:
      - name: grade
        type: llm-rubric
        prompt: Evaluate {{ output }}
        preprocessors:
          - type: xlsx
            command:
              - node
              - xlsx-override.js
    vars:
      input: grade this
`,
      'utf8',
    );

    await expect(loadTests(path.join(dir, 'suite.eval.yaml'), dir)).rejects.toThrow(
      'tests[0].assert[0].preprocessors has been removed from authored eval YAML. Use tests[0].assert[0].transform instead.',
    );
  });
});
