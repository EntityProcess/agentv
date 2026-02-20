import { describe, expect, it } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { loadTestSuite } from '../../src/evaluation/yaml-parser.js';

function createTempYaml(content: string): { filePath: string; dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'matrix-test-'));
  const filePath = path.join(dir, 'dataset.yaml');
  writeFileSync(filePath, content);
  return { filePath, dir };
}

describe('matrix evaluation - loadTestSuite', () => {
  it('extracts suite-level targets from execution.targets', async () => {
    const { filePath, dir } = createTempYaml(`
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
    expect(suite.targets).toEqual(['copilot', 'claude']);
  });

  it('returns undefined targets when not specified', async () => {
    const { filePath, dir } = createTempYaml(`
execution:
  target: copilot
tests:
  - id: test-1
    input: "Hello"
    criteria: "Greet"
`);

    const suite = await loadTestSuite(filePath, dir);
    expect(suite.targets).toBeUndefined();
  });

  it('populates per-test targets from test-level execution.targets', async () => {
    const { filePath, dir } = createTempYaml(`
execution:
  targets:
    - copilot
    - claude
tests:
  - id: general-test
    input: "Hello"
    criteria: "Greet"
  - id: copilot-only
    input: "GitHub task"
    criteria: "Reference GitHub"
    execution:
      targets:
        - copilot
`);

    const suite = await loadTestSuite(filePath, dir);
    expect(suite.targets).toEqual(['copilot', 'claude']);
    expect(suite.tests.length).toBe(2);

    const generalTest = suite.tests.find((t) => t.id === 'general-test');
    expect(generalTest?.targets).toBeUndefined();

    const copilotOnly = suite.tests.find((t) => t.id === 'copilot-only');
    expect(copilotOnly?.targets).toEqual(['copilot']);
  });
});
