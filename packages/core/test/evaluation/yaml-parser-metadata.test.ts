import { describe, expect, it } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { loadTestSuite } from '../../src/evaluation/yaml-parser.js';

function createTempYaml(content: string): { filePath: string; dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'metadata-test-'));
  const filePath = path.join(dir, 'dataset.yaml');
  writeFileSync(filePath, content);
  return { filePath, dir };
}

describe('loadTestSuite - metadata parsing', () => {
  it('parses suite-level metadata with all fields', async () => {
    const { filePath, dir } = createTempYaml(`
name: export-screening
description: Evaluates export screening accuracy
version: "1.0"
author: acme-compliance
tags:
  - compliance
  - agents
license: Apache-2.0
requires:
  agentv: ">=0.6.0"
tests:
  - id: test-1
    input: "Hello"
    criteria: "Greet"
`);

    const suite = await loadTestSuite(filePath, dir);
    expect(suite.metadata).toBeDefined();
    expect(suite.metadata).toEqual({
      name: 'export-screening',
      description: 'Evaluates export screening accuracy',
      version: '1.0',
      author: 'acme-compliance',
      tags: ['compliance', 'agents'],
      license: 'Apache-2.0',
      requires: { agentv: '>=0.6.0' },
    });
  });

  it('parses minimal metadata (name + description only)', async () => {
    const { filePath, dir } = createTempYaml(`
name: my-eval
description: A simple eval
tests:
  - id: test-1
    input: "Hello"
    criteria: "Greet"
`);

    const suite = await loadTestSuite(filePath, dir);
    expect(suite.metadata).toBeDefined();
    expect(suite.metadata).toEqual({
      name: 'my-eval',
      description: 'A simple eval',
    });
  });

  it('returns undefined metadata when no metadata fields present', async () => {
    const { filePath, dir } = createTempYaml(`
tests:
  - id: test-1
    input: "Hello"
    criteria: "Greet"
`);

    const suite = await loadTestSuite(filePath, dir);
    expect(suite.metadata).toBeUndefined();
  });

  it('still loads tests correctly when metadata is present', async () => {
    const { filePath, dir } = createTempYaml(`
name: my-eval
description: A test eval
tests:
  - id: test-1
    input: "Hello"
    criteria: "Greet the user"
  - id: test-2
    input: "Goodbye"
    criteria: "Say farewell"
`);

    const suite = await loadTestSuite(filePath, dir);
    expect(suite.tests).toHaveLength(2);
    expect(suite.tests[0].id).toBe('test-1');
    expect(suite.tests[1].id).toBe('test-2');
    expect(suite.metadata).toBeDefined();
    expect(suite.metadata?.name).toBe('my-eval');
  });

  it('works with metadata alongside execution config', async () => {
    const { filePath, dir } = createTempYaml(`
name: matrix-eval
description: Eval with targets
execution:
  targets:
    - copilot
    - claude
tests:
  - id: test-1
    input: "Hello"
    criteria: "Greet"
`);

    const suite = await loadTestSuite(filePath, dir);
    expect(suite.metadata).toBeDefined();
    expect(suite.metadata?.name).toBe('matrix-eval');
    expect(suite.targets).toEqual(['copilot', 'claude']);
  });

  it('parses metadata with tags as array', async () => {
    const { filePath, dir } = createTempYaml(`
name: tagged-eval
description: An eval with tags
tags:
  - unit
  - integration
  - smoke
tests:
  - id: test-1
    input: "Hello"
    criteria: "Greet"
`);

    const suite = await loadTestSuite(filePath, dir);
    expect(suite.metadata?.tags).toEqual(['unit', 'integration', 'smoke']);
  });
});
