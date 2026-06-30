import { describe, expect, it } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { loadTestSuite } from '../../src/evaluation/yaml-parser.js';

function createTempYaml(content: string): { filePath: string; dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'metadata-test-'));
  const filePath = path.join(dir, 'dataset.eval.yaml');
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

  it('uses explicit YAML category as a canonical taxonomy path override', async () => {
    const { filePath, dir } = createTempYaml(`
category: " security / network "
tests:
  - id: test-1
    input: "Hello"
    criteria: "Greet"
`);

    const suite = await loadTestSuite(filePath, dir, { category: 'derived/path' });
    expect(suite.tests[0].category).toBe('security/network');
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

  it('works with metadata alongside target config', async () => {
    const { filePath, dir } = createTempYaml(`
name: matrix-eval
description: Eval with targets
target: copilot
tests:
  - id: test-1
    input: "Hello"
    criteria: "Greet"
`);

    const suite = await loadTestSuite(filePath, dir);
    expect(suite.metadata).toBeDefined();
    expect(suite.metadata?.name).toBe('matrix-eval');
    expect(suite.targetSpec).toEqual({ name: 'copilot' });
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

  it('merges case-level governance into suite-level (arrays concat, scalars override)', async () => {
    const { filePath, dir } = createTempYaml(`
name: red-team
governance:
  owasp_llm_top_10_2025: [LLM01]
  controls:
    - NIST-AI-RMF-1.0:MEASURE-2.7
  risk_tier: high
tests:
  - id: case-1
    criteria: "Refuses"
    input: "Query"
    metadata:
      governance:
        owasp_llm_top_10_2025: [LLM06]
        risk_tier: limited
`);

    const suite = await loadTestSuite(filePath, dir);
    const govern = suite.tests[0].metadata?.governance as Record<string, unknown>;
    expect(govern.owasp_llm_top_10_2025).toEqual(['LLM01', 'LLM06']);
    expect(govern.controls).toEqual(['NIST-AI-RMF-1.0:MEASURE-2.7']);
    expect(govern.risk_tier).toBe('limited');
  });

  it('keeps suite governance on cases that have no metadata of their own', async () => {
    const { filePath, dir } = createTempYaml(`
governance:
  owasp_llm_top_10_2025: [LLM01]
tests:
  - id: case-1
    criteria: "Refuses"
    input: "Query"
`);

    const suite = await loadTestSuite(filePath, dir);
    expect(suite.tests[0].metadata?.governance).toEqual({
      owasp_llm_top_10_2025: ['LLM01'],
    });
  });

  it('merges arbitrary suite metadata into each case and lets case scalars override', async () => {
    const { filePath, dir } = createTempYaml(`
tags: [cargowise, database]
metadata:
  source_repo: https://github.com/virattt/dexter
  source_commit: 8d9419829f443f84b804d033bb2c3b1fbd788629
  source_file: src/evals/dataset/finance_agent.csv
  tags: [sql, database]
tests:
  - id: case-1
    criteria: "Answer"
    input: "Query"
    metadata:
      source_file: override.csv
      tags: [review, sql]
`);

    const suite = await loadTestSuite(filePath, dir);
    expect(suite.tests[0].metadata).toMatchObject({
      source_repo: 'https://github.com/virattt/dexter',
      source_commit: '8d9419829f443f84b804d033bb2c3b1fbd788629',
      source_file: 'override.csv',
      tags: ['cargowise', 'database', 'sql', 'review'],
    });
  });

  it('loads structured input objects and rubric criteria aliases', async () => {
    const { filePath, dir } = createTempYaml(`
tests:
  - id: case-1
    input:
      company: Apple
      ticker: AAPL
    assertions:
      - name: dexter_rubric
        type: llm-grader
        rubrics:
          - id: factual
            operator: correctness
            criteria: "Uses the supplied company and ticker"
`);

    const suite = await loadTestSuite(filePath, dir);
    expect(suite.tests[0].input[0].content).toEqual({ company: 'Apple', ticker: 'AAPL' });
    expect(suite.tests[0].question).toContain('"ticker": "AAPL"');
    const grader = suite.tests[0].assertions?.[0];
    expect(grader?.type).toBe('llm-grader');
    if (grader?.type === 'llm-grader') {
      expect(grader.rubrics?.[0]).toMatchObject({
        id: 'factual',
        operator: 'correctness',
        outcome: 'Uses the supplied company and ticker',
      });
    }
  });
});
