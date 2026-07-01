import { describe, expect, it } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { loadTestSuite } from '../../src/evaluation/yaml-parser.js';

function createTempYaml(content: string): { filePath: string; dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'tags-map-test-'));
  const filePath = path.join(dir, 'dataset.eval.yaml');
  writeFileSync(filePath, content);
  return { filePath, dir };
}

describe('loadTestSuite - promptfoo-shaped tags map', () => {
  it('parses map-form tags into EvalSuiteResult.tags and exposes the experiment key', async () => {
    const { filePath, dir } = createTempYaml(`
name: mapped-eval
description: A map-form tags eval
tags:
  experiment: baseline-v2
  team: compliance
tests:
  - id: test-1
    input: "Hello"
    criteria: "Greet"
`);

    const suite = await loadTestSuite(filePath, dir);
    expect(suite.tags).toEqual({ experiment: 'baseline-v2', team: 'compliance' });
    // The map form must NOT populate the selection list on metadata.
    expect(suite.metadata?.tags).toBeUndefined();
    // The map form must NOT be inherited as case selection tags.
    expect(suite.tests[0].metadata?.tags).toBeUndefined();
  });

  it('does not crash when a named suite authors map-form tags', async () => {
    const { filePath, dir } = createTempYaml(`
name: named-eval
tags:
  experiment: run-a
tests:
  - id: test-1
    input: "Hi"
    criteria: "Greet"
`);

    const suite = await loadTestSuite(filePath, dir);
    expect(suite.tags).toEqual({ experiment: 'run-a' });
    expect(suite.metadata?.name).toBe('named-eval');
  });

  it('keeps list-form tags as a selection list, with no tags map', async () => {
    const { filePath, dir } = createTempYaml(`
name: listed-eval
tags:
  - unit
  - smoke
tests:
  - id: test-1
    input: "Hello"
    criteria: "Greet"
`);

    const suite = await loadTestSuite(filePath, dir);
    // List form still drives selection via metadata.tags (unchanged behavior).
    expect(suite.metadata?.tags).toEqual(['unit', 'smoke']);
    expect(suite.tests[0].metadata?.tags).toEqual(['unit', 'smoke']);
    // No promptfoo map for the list form.
    expect(suite.tags).toBeUndefined();
  });

  it('reads a tags map authored under the metadata block', async () => {
    const { filePath, dir } = createTempYaml(`
name: metadata-mapped
metadata:
  tags:
    experiment: from-metadata
tests:
  - id: test-1
    input: "Hi"
    criteria: "Greet"
`);

    const suite = await loadTestSuite(filePath, dir);
    expect(suite.tags).toEqual({ experiment: 'from-metadata' });
    expect(suite.tests[0].metadata?.tags).toBeUndefined();
  });

  it('rejects a malformed scalar tags value loudly rather than dropping it', async () => {
    const { filePath, dir } = createTempYaml(`
name: scalar-tags
tags: not-a-list
tests:
  - id: test-1
    input: "Hi"
    criteria: "Greet"
`);

    await expect(loadTestSuite(filePath, dir)).rejects.toThrow(/Invalid .*tags/);
  });

  it('lets top-level tags override metadata-block tags on key collisions', async () => {
    const { filePath, dir } = createTempYaml(`
name: collision-eval
tags:
  experiment: top-level
metadata:
  tags:
    experiment: metadata-block
    team: compliance
tests:
  - id: test-1
    input: "Hi"
    criteria: "Greet"
`);

    const suite = await loadTestSuite(filePath, dir);
    expect(suite.tags).toEqual({ experiment: 'top-level', team: 'compliance' });
  });
});
