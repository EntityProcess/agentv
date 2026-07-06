import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { detectFormat, loadTestsFromJsonl } from '../../../src/evaluation/loaders/jsonl-parser.js';
import { loadTests } from '../../../src/evaluation/yaml-parser.js';

describe('detectFormat', () => {
  it('returns jsonl for .jsonl extension', () => {
    expect(detectFormat('test.jsonl')).toBe('jsonl');
    expect(detectFormat('/path/to/suite.jsonl')).toBe('jsonl');
  });

  it('returns yaml for .yaml extension', () => {
    expect(detectFormat('test.yaml')).toBe('yaml');
    expect(detectFormat('/path/to/config.yaml')).toBe('yaml');
  });

  it('returns yaml for .yml extension', () => {
    expect(detectFormat('test.yml')).toBe('yaml');
    expect(detectFormat('/path/to/config.yml')).toBe('yaml');
  });

  it('returns typescript for .ts extension', () => {
    expect(detectFormat('greeting.eval.ts')).toBe('typescript');
    expect(detectFormat('/path/to/eval.ts')).toBe('typescript');
  });

  it('returns typescript for .mts extension', () => {
    expect(detectFormat('greeting.eval.mts')).toBe('typescript');
  });

  it('throws for unsupported extensions', () => {
    expect(() => detectFormat('test.txt')).toThrow('Unsupported file format');
    expect(() => detectFormat('evals.json')).toThrow('Unsupported file format');
    expect(() => detectFormat('test')).toThrow('Unsupported file format');
  });
});

describe('loadTestsFromJsonl', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = path.join(os.tmpdir(), `agentv-test-jsonl-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('parses valid single-line JSONL', async () => {
    const jsonlPath = path.join(tempDir, 'single.jsonl');
    await writeFile(
      jsonlPath,
      '{"id": "test-1", "criteria": "Goal", "input": [{"role": "user", "content": "Query"}]}\n',
    );

    const cases = await loadTestsFromJsonl(jsonlPath, tempDir);

    expect(cases).toHaveLength(1);
    expect(cases[0].id).toBe('test-1');
    expect(cases[0].criteria).toBe('Goal');
    expect(cases[0].input).toHaveLength(1);
    expect(cases[0].input[0].role).toBe('user');
    expect(cases[0].input[0].content).toBe('Query');
    expect(cases[0].assertions?.[0]?.type).toBe('llm-rubric');
    expect(cases[0].assertions?.[0]?.rubrics?.[0]?.outcome).toBe('Goal');
  });

  it('keeps expected_output-only JSONL cases passive without implicit assertions', async () => {
    const jsonlPath = path.join(tempDir, 'expected-output-only.jsonl');
    await writeFile(
      jsonlPath,
      '{"id": "test-1", "input": "Query", "expected_output": "Reference answer"}\n',
    );

    const cases = await loadTestsFromJsonl(jsonlPath, tempDir);

    expect(cases).toHaveLength(1);
    expect(cases[0].criteria).toBe('');
    expect(cases[0].expected_output[0].content).toBe('Reference answer');
    expect(cases[0].assertions).toBeUndefined();
  });

  it('parses multi-line JSONL', async () => {
    const jsonlPath = path.join(tempDir, 'multi.jsonl');
    await writeFile(
      jsonlPath,
      [
        '{"id": "test-1", "criteria": "Goal 1", "input": [{"role": "user", "content": "Query 1"}]}',
        '{"id": "test-2", "criteria": "Goal 2", "input": [{"role": "user", "content": "Query 2"}]}',
        '{"id": "test-3", "criteria": "Goal 3", "input": [{"role": "user", "content": "Query 3"}]}',
      ].join('\n'),
    );

    const cases = await loadTestsFromJsonl(jsonlPath, tempDir);

    expect(cases).toHaveLength(3);
    expect(cases[0].id).toBe('test-1');
    expect(cases[1].id).toBe('test-2');
    expect(cases[2].id).toBe('test-3');
    expect(cases[0].criteria).toBe('Goal 1');
    expect(cases[1].criteria).toBe('Goal 2');
    expect(cases[2].criteria).toBe('Goal 3');
  });

  it('skips empty lines and whitespace-only lines', async () => {
    const jsonlPath = path.join(tempDir, 'empty-lines.jsonl');
    await writeFile(
      jsonlPath,
      [
        '{"id": "test-1", "criteria": "Goal 1", "input": [{"role": "user", "content": "Query 1"}]}',
        '',
        '{"id": "test-2", "criteria": "Goal 2", "input": [{"role": "user", "content": "Query 2"}]}',
        '   ',
        '{"id": "test-3", "criteria": "Goal 3", "input": [{"role": "user", "content": "Query 3"}]}',
        '',
      ].join('\n'),
    );

    const cases = await loadTestsFromJsonl(jsonlPath, tempDir);

    expect(cases).toHaveLength(3);
    expect(cases[0].id).toBe('test-1');
    expect(cases[1].id).toBe('test-2');
    expect(cases[2].id).toBe('test-3');
  });

  it('throws error on malformed JSON with line number', async () => {
    const jsonlPath = path.join(tempDir, 'malformed.jsonl');
    await writeFile(
      jsonlPath,
      [
        '{"id": "test-1", "criteria": "Goal 1", "input": [{"role": "user", "content": "Query 1"}]}',
        '{"id": "test-2", "criteria": "Goal 2", "input": [{"role": "user", "content": "Query 2"}]}',
        '{"id": "test-3", "criteria": "Goal 3" "input": []}', // Missing comma
      ].join('\n'),
    );

    await expect(loadTestsFromJsonl(jsonlPath, tempDir)).rejects.toThrow(/Line 3/);
  });

  it('skips cases with missing required fields', async () => {
    const jsonlPath = path.join(tempDir, 'missing-fields.jsonl');
    await writeFile(
      jsonlPath,
      [
        '{"id": "test-1", "criteria": "Goal 1", "input": [{"role": "user", "content": "Query 1"}]}',
        '{"id": "test-2", "input": [{"role": "user", "content": "Query 2"}]}', // Missing criteria
        '{"criteria": "Goal 3", "input": [{"role": "user", "content": "Query 3"}]}', // Missing id
        '{"id": "test-4", "criteria": "Goal 4"}', // Missing input
        '{"id": "test-5", "criteria": "Goal 5", "input": [{"role": "user", "content": "Query 5"}]}',
      ].join('\n'),
    );

    const cases = await loadTestsFromJsonl(jsonlPath, tempDir);

    expect(cases).toHaveLength(2);
    expect(cases[0].id).toBe('test-1');
    expect(cases[1].id).toBe('test-5');
  });

  it('loads sidecar YAML metadata', async () => {
    const jsonlPath = path.join(tempDir, 'with-sidecar.jsonl');
    const sidecarPath = path.join(tempDir, 'with-sidecar.yaml');

    await writeFile(
      jsonlPath,
      '{"id": "test-1", "criteria": "Goal", "input": [{"role": "user", "content": "Query"}]}\n',
    );
    await writeFile(
      sidecarPath,
      'description: Test dataset\nname: my-tests\nevaluator: llm-grader\n',
    );

    const cases = await loadTestsFromJsonl(jsonlPath, tempDir);

    expect(cases).toHaveLength(1);
    expect(cases[0].suite).toBe('my-tests');
    expect(cases[0].evaluator).toBe('llm-grader');
  });

  it('rejects deprecated sidecar evaluator aliases', async () => {
    const jsonlPath = path.join(tempDir, 'with-deprecated-sidecar.jsonl');
    const sidecarPath = path.join(tempDir, 'with-deprecated-sidecar.yaml');

    await writeFile(
      jsonlPath,
      '{"id": "test-1", "criteria": "Goal", "input": [{"role": "user", "content": "Query"}]}\n',
    );
    await writeFile(
      sidecarPath,
      'description: Test dataset\nname: my-tests\nevaluator: llm_judge\n',
    );

    await expect(loadTestsFromJsonl(jsonlPath, tempDir)).rejects.toThrow(
      "Unsupported grader 'llm_judge' in sidecar. Use 'llm-grader' instead.",
    );
  });

  it('uses default suite name from filename when no sidecar', async () => {
    const jsonlPath = path.join(tempDir, 'my-dataset.jsonl');
    await writeFile(
      jsonlPath,
      '{"id": "test-1", "criteria": "Goal", "input": [{"role": "user", "content": "Query"}]}\n',
    );

    const cases = await loadTestsFromJsonl(jsonlPath, tempDir);

    expect(cases).toHaveLength(1);
    expect(cases[0].suite).toBe('my-dataset');
  });

  it('supports per-case assert override', async () => {
    const jsonlPath = path.join(tempDir, 'with-assert.jsonl');
    await writeFile(
      jsonlPath,
      '{"id": "test-1", "criteria": "Goal", "input": [{"role": "user", "content": "Query"}], "assert": [{"metric": "rubric-check", "type": "llm-grader", "rubrics": [{"id": "r1", "description": "Must be polite", "weight": 1.0, "required": true}]}]}\n',
    );

    const cases = await loadTestsFromJsonl(jsonlPath, tempDir);

    expect(cases).toHaveLength(1);
    expect(cases[0].assertions).toHaveLength(1);
    expect(cases[0].assertions?.[0].name).toBe('rubric-check');
  });

  it('supports structured llm-rubric value arrays', async () => {
    const jsonlPath = path.join(tempDir, 'with-llm-rubric-value.jsonl');
    await writeFile(
      jsonlPath,
      '{"id": "test-1", "criteria": "Goal", "input": [{"role": "user", "content": "Query"}], "assert": [{"metric": "rubric-check", "type": "llm-rubric", "value": ["Must be polite", "Must be helpful"]}]}\n',
    );

    const cases = await loadTestsFromJsonl(jsonlPath, tempDir);

    expect(cases).toHaveLength(1);
    expect(cases[0].assertions).toHaveLength(1);
    expect(cases[0].assertions?.[0].type).toBe('llm-rubric');
    const rubricEvaluator = cases[0].assertions?.[0] as { type: string; rubrics?: unknown[] };
    expect(rubricEvaluator.rubrics).toHaveLength(2);
  });

  it('supports structured llm-rubric value arrays with score_ranges', async () => {
    const jsonlPath = path.join(tempDir, 'with-score-range-llm-rubric.jsonl');
    await writeFile(
      jsonlPath,
      `${JSON.stringify({
        id: 'test-1',
        criteria: 'Goal',
        input: [{ role: 'user', content: 'Query' }],
        assert: [
          {
            metric: 'quality',
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
      })}\n`,
    );

    const cases = await loadTestsFromJsonl(jsonlPath, tempDir);

    expect(cases).toHaveLength(1);
    expect(cases[0].assertions).toHaveLength(1);
    expect(cases[0].assertions?.[0]).toMatchObject({
      name: 'quality',
      type: 'llm-rubric',
      rubrics: [
        {
          id: 'quality',
          outcome: 'Answer quality',
          min_score: 0.8,
          weight: 1,
          score_ranges: [
            { score_range: [0, 4], outcome: 'Weak' },
            { score_range: [5, 7], outcome: 'Adequate' },
            { score_range: [8, 10], outcome: 'Strong' },
          ],
        },
      ],
    });
  });

  it('filters by pattern (exact match)', async () => {
    const jsonlPath = path.join(tempDir, 'filter.jsonl');
    await writeFile(
      jsonlPath,
      [
        '{"id": "test-1", "criteria": "Goal 1", "input": [{"role": "user", "content": "Query 1"}]}',
        '{"id": "test-2", "criteria": "Goal 2", "input": [{"role": "user", "content": "Query 2"}]}',
        '{"id": "test-3", "criteria": "Goal 3", "input": [{"role": "user", "content": "Query 3"}]}',
      ].join('\n'),
    );

    const cases = await loadTestsFromJsonl(jsonlPath, tempDir, { filter: 'test-2' });

    expect(cases).toHaveLength(1);
    expect(cases[0].id).toBe('test-2');
  });

  it('filters by glob pattern', async () => {
    const jsonlPath = path.join(tempDir, 'filter-glob.jsonl');
    await writeFile(
      jsonlPath,
      [
        '{"id": "summary-basic", "criteria": "Goal 1", "input": [{"role": "user", "content": "Query 1"}]}',
        '{"id": "summary-advanced", "criteria": "Goal 2", "input": [{"role": "user", "content": "Query 2"}]}',
        '{"id": "code-review", "criteria": "Goal 3", "input": [{"role": "user", "content": "Query 3"}]}',
      ].join('\n'),
    );

    const cases = await loadTestsFromJsonl(jsonlPath, tempDir, { filter: 'summary-*' });

    expect(cases).toHaveLength(2);
    expect(cases.map((c) => c.id)).toEqual(['summary-basic', 'summary-advanced']);
  });

  it('filters by multiple patterns with OR logic', async () => {
    const jsonlPath = path.join(tempDir, 'filter-multi.jsonl');
    await writeFile(
      jsonlPath,
      [
        '{"id": "alpha-case", "criteria": "Goal 1", "input": [{"role": "user", "content": "Query 1"}]}',
        '{"id": "beta-case", "criteria": "Goal 2", "input": [{"role": "user", "content": "Query 2"}]}',
        '{"id": "gamma-case", "criteria": "Goal 3", "input": [{"role": "user", "content": "Query 3"}]}',
      ].join('\n'),
    );

    const cases = await loadTestsFromJsonl(jsonlPath, tempDir, {
      filter: ['alpha-*', 'beta-case'],
    });

    expect(cases).toHaveLength(2);
    expect(cases.map((c) => c.id)).toEqual(['alpha-case', 'beta-case']);
  });

  it('supports conversation_id field', async () => {
    const jsonlPath = path.join(tempDir, 'with-conv-id.jsonl');
    await writeFile(
      jsonlPath,
      '{"id": "test-1", "conversation_id": "conv-123", "criteria": "Goal", "input": [{"role": "user", "content": "Query"}]}\n',
    );

    const cases = await loadTestsFromJsonl(jsonlPath, tempDir);

    expect(cases).toHaveLength(1);
    expect(cases[0].conversation_id).toBe('conv-123');
  });

  it('supports expected_output field', async () => {
    const jsonlPath = path.join(tempDir, 'with-expected.jsonl');
    await writeFile(
      jsonlPath,
      '{"id": "test-1", "criteria": "Goal", "input": [{"role": "user", "content": "Query"}], "expected_output": [{"role": "assistant", "content": "Response"}]}\n',
    );

    const cases = await loadTestsFromJsonl(jsonlPath, tempDir);

    expect(cases).toHaveLength(1);
    expect(cases[0].expected_output).toHaveLength(1);
    expect(cases[0].reference_answer).toBe('Response');
  });

  it('handles empty JSONL file', async () => {
    const jsonlPath = path.join(tempDir, 'empty.jsonl');
    await writeFile(jsonlPath, '');

    const cases = await loadTestsFromJsonl(jsonlPath, tempDir);

    expect(cases).toHaveLength(0);
  });
});

describe('loadTests with format detection', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = path.join(os.tmpdir(), `agentv-test-loadTests-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('routes .jsonl to JSONL parser', async () => {
    const jsonlPath = path.join(tempDir, 'test.jsonl');
    await writeFile(
      jsonlPath,
      '{"id": "jsonl-test", "criteria": "Goal", "input": [{"role": "user", "content": "Query"}]}\n',
    );

    const cases = await loadTests(jsonlPath, tempDir);

    expect(cases).toHaveLength(1);
    expect(cases[0].id).toBe('jsonl-test');
  });

  it('routes .yaml to YAML parser', async () => {
    const yamlPath = path.join(tempDir, 'test.yaml');
    await writeFile(
      yamlPath,
      `prompts:
  - "{{ input }}"
tests:
  - id: yaml-test
    criteria: Goal
    vars:
      input:
        - role: user
          content: Query
`,
    );

    const cases = await loadTests(yamlPath, tempDir);

    expect(cases).toHaveLength(1);
    expect(cases[0].id).toBe('yaml-test');
    expect(cases[0].assertions?.[0]?.type).toBe('llm-rubric');
    expect(cases[0].assertions?.[0]?.rubrics?.[0]?.outcome).toBe('Goal');
  });

  it('keeps vars.expected_output-only YAML cases passive without implicit assertions', async () => {
    const yamlPath = path.join(tempDir, 'expected-output-only.yaml');
    await writeFile(
      yamlPath,
      `prompts:
  - "{{ input }}"
tests:
  - id: expected-only
    vars:
      input: Query
      expected_output: Reference answer
`,
    );

    const cases = await loadTests(yamlPath, tempDir);

    expect(cases).toHaveLength(0);
  });

  it('rejects top-level authored YAML expected_output', async () => {
    const yamlPath = path.join(tempDir, 'top-level-expected-output.yaml');
    await writeFile(
      yamlPath,
      `expected_output: Shared reference
prompts:
  - "{{ input }}"
tests:
  - id: expected-only
    criteria: Goal
    vars:
      input: Query
`,
    );

    await expect(loadTests(yamlPath, tempDir)).rejects.toThrow(
      "Top-level 'expected_output' has been removed",
    );
  });

  it('rejects default_test authored YAML expected_output', async () => {
    const yamlPath = path.join(tempDir, 'default-test-expected-output.yaml');
    await writeFile(
      yamlPath,
      `default_test:
  expected_output: Shared reference
prompts:
  - "{{ input }}"
tests:
  - id: expected-only
    criteria: Goal
    vars:
      input: Query
`,
    );

    await expect(loadTests(yamlPath, tempDir)).rejects.toThrow(
      'default_test.expected_output has been removed',
    );
  });

  it('accepts direct input shorthand without deprecation warnings', async () => {
    const yamlPath = path.join(tempDir, 'direct-input-shorthand.yaml');
    await writeFile(
      yamlPath,
      `prompts:
  - "{{ input }}"
tests:
  - id: direct-input
    criteria: Answer directly
    vars:
      input:
        - role: user
          content: Shared instruction
        - role: user
          content: Query
`,
    );
    const warn = console.warn;
    const warnings: string[] = [];
    console.warn = (message?: unknown) => {
      warnings.push(String(message));
    };

    try {
      const cases = await loadTests(yamlPath, tempDir);

      expect(cases).toHaveLength(1);
      expect(cases[0].criteria).toBe('Answer directly');
      expect(warnings).toEqual([]);
    } finally {
      console.warn = warn;
    }
  });

  it('routes .yml to YAML parser', async () => {
    const ymlPath = path.join(tempDir, 'test.yml');
    await writeFile(
      ymlPath,
      `prompts:
  - "{{ input }}"
tests:
  - id: yml-test
    criteria: Goal
    vars:
      input:
        - role: user
          content: Query
`,
    );

    const cases = await loadTests(ymlPath, tempDir);

    expect(cases).toHaveLength(1);
    expect(cases[0].id).toBe('yml-test');
  });

  it('throws for unsupported extensions via loadTests', async () => {
    const txtPath = path.join(tempDir, 'test.txt');
    await writeFile(txtPath, '{}');

    await expect(loadTests(txtPath, tempDir)).rejects.toThrow('Unsupported file format');
  });
});

describe('JSONL and YAML produce equivalent EvalTests', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = path.join(os.tmpdir(), `agentv-test-equivalence-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('produces identical EvalTest structure from both formats', async () => {
    // Create equivalent YAML and JSONL files
    const yamlPath = path.join(tempDir, 'equiv.yaml');
    const jsonlPath = path.join(tempDir, 'equiv.jsonl');

    await writeFile(
      yamlPath,
      `name: my-dataset
prompts:
  - "{{ input }}"
tests:
  - id: test-1
    criteria: The agent should respond with a helpful answer
    vars:
      input:
        - role: user
          content: What is 2+2?
`,
    );

    // JSONL with equivalent sidecar
    const sidecarPath = path.join(tempDir, 'equiv-sidecar.yaml');
    await writeFile(sidecarPath, 'name: my-dataset\n');

    const jsonlPath2 = path.join(tempDir, 'equiv-sidecar.jsonl');
    await writeFile(
      jsonlPath2,
      '{"id": "test-1", "criteria": "The agent should respond with a helpful answer", "input": [{"role": "user", "content": "What is 2+2?"}]}\n',
    );

    const yamlCases = await loadTests(yamlPath, tempDir);
    const jsonlCases = await loadTests(jsonlPath2, tempDir);

    expect(yamlCases).toHaveLength(1);
    expect(jsonlCases).toHaveLength(1);

    // Core fields should match
    expect(jsonlCases[0].id).toBe(yamlCases[0].id);
    expect(jsonlCases[0].criteria).toBe(yamlCases[0].criteria);
    expect(jsonlCases[0].suite).toBe(yamlCases[0].suite);
    expect(jsonlCases[0].input.length).toBe(yamlCases[0].input.length);
    expect(jsonlCases[0].input[0].role).toBe(yamlCases[0].input[0].role);
    expect(jsonlCases[0].input[0].content).toBe(yamlCases[0].input[0].content);
  });
});

describe('Input/expected_output aliases and shorthand', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = path.join(os.tmpdir(), `agentv-test-aliases-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('JSONL aliases', () => {
    it('supports input string shorthand', async () => {
      const jsonlPath = path.join(tempDir, 'input-shorthand.jsonl');
      await writeFile(jsonlPath, '{"id": "test-1", "criteria": "Goal", "input": "What is 2+2?"}\n');

      const cases = await loadTestsFromJsonl(jsonlPath, tempDir);

      expect(cases).toHaveLength(1);
      expect(cases[0].input).toHaveLength(1);
      expect(cases[0].input[0].role).toBe('user');
      expect(cases[0].input[0].content).toBe('What is 2+2?');
    });

    it('supports input as message array', async () => {
      const jsonlPath = path.join(tempDir, 'input-array.jsonl');
      await writeFile(
        jsonlPath,
        '{"id": "test-1", "criteria": "Goal", "input": [{"role": "system", "content": "Be helpful"}, {"role": "user", "content": "Hello"}]}\n',
      );

      const cases = await loadTestsFromJsonl(jsonlPath, tempDir);

      expect(cases).toHaveLength(1);
      expect(cases[0].input).toHaveLength(2);
      expect(cases[0].input[0].role).toBe('system');
      expect(cases[0].input[1].role).toBe('user');
    });

    it('supports expected_output string shorthand', async () => {
      const jsonlPath = path.join(tempDir, 'expected-string.jsonl');
      await writeFile(
        jsonlPath,
        '{"id": "test-1", "criteria": "Goal", "input": "Query", "expected_output": "The answer is 4"}\n',
      );

      const cases = await loadTestsFromJsonl(jsonlPath, tempDir);

      expect(cases).toHaveLength(1);
      expect(cases[0].expected_output).toHaveLength(1);
      expect(cases[0].expected_output[0].role).toBe('assistant');
      expect(cases[0].expected_output[0].content).toBe('The answer is 4');
      expect(cases[0].reference_answer).toBe('The answer is 4');
    });

    it('supports expected_output object shorthand', async () => {
      const jsonlPath = path.join(tempDir, 'expected-object.jsonl');
      await writeFile(
        jsonlPath,
        '{"id": "test-1", "criteria": "Goal", "input": "Query", "expected_output": {"riskLevel": "High", "confidence": 0.95}}\n',
      );

      const cases = await loadTestsFromJsonl(jsonlPath, tempDir);

      expect(cases).toHaveLength(1);
      expect(cases[0].expected_output).toHaveLength(1);
      expect(cases[0].expected_output[0].role).toBe('assistant');
      const content = cases[0].expected_output[0].content as { riskLevel: string };
      expect(content.riskLevel).toBe('High');
    });

    it('resolves input message array', async () => {
      const jsonlPath = path.join(tempDir, 'input-messages.jsonl');
      await writeFile(
        jsonlPath,
        '{"id": "test-1", "criteria": "Goal", "input": [{"role": "user", "content": "Hello"}]}\n',
      );

      const cases = await loadTestsFromJsonl(jsonlPath, tempDir);

      expect(cases).toHaveLength(1);
      expect(cases[0].input[0].content).toBe('Hello');
    });

    it('resolves expected_output message array', async () => {
      const jsonlPath = path.join(tempDir, 'expected-output.jsonl');
      await writeFile(
        jsonlPath,
        '{"id": "test-1", "criteria": "Goal", "input": "Query", "expected_output": [{"role": "assistant", "content": "Response"}]}\n',
      );

      const cases = await loadTestsFromJsonl(jsonlPath, tempDir);

      expect(cases).toHaveLength(1);
      expect(cases[0].expected_output[0].content).toBe('Response');
    });
  });

  describe('YAML aliases', () => {
    it('supports input string shorthand', async () => {
      const yamlPath = path.join(tempDir, 'input-shorthand.yaml');
      await writeFile(
        yamlPath,
        `prompts:
  - "{{ input }}"
tests:
  - id: test-1
    criteria: Goal
    vars:
      input: What is 2+2?
`,
      );

      const cases = await loadTests(yamlPath, tempDir);

      expect(cases).toHaveLength(1);
      expect(cases[0].input).toHaveLength(1);
      expect(cases[0].input[0].role).toBe('user');
      expect(cases[0].input[0].content).toBe('What is 2+2?');
    });

    it('supports input as message array', async () => {
      const yamlPath = path.join(tempDir, 'input-array.yaml');
      await writeFile(
        yamlPath,
        `prompts:
  - "{{ input }}"
tests:
  - id: test-1
    criteria: Goal
    vars:
      input:
        - role: system
          content: Be helpful
        - role: user
          content: Hello
`,
      );

      const cases = await loadTests(yamlPath, tempDir);

      expect(cases).toHaveLength(1);
      expect(cases[0].input).toHaveLength(2);
      expect(cases[0].input[0].role).toBe('system');
      expect(cases[0].input[1].role).toBe('user');
    });

    it('rejects authored YAML expected_output string shorthand', async () => {
      const yamlPath = path.join(tempDir, 'expected-string.yaml');
      await writeFile(
        yamlPath,
        `prompts:
  - "{{ input }}"
tests:
  - id: test-1
    criteria: Goal
    expected_output: The answer is 4
    vars:
      input: Query
`,
      );

      await expect(loadTests(yamlPath, tempDir)).rejects.toThrow(
        'tests[0].expected_output has been removed',
      );
    });

    it('rejects authored YAML expected_output object shorthand', async () => {
      const yamlPath = path.join(tempDir, 'expected-object.yaml');
      await writeFile(
        yamlPath,
        `prompts:
  - "{{ input }}"
tests:
  - id: test-1
    criteria: Goal
    expected_output:
      riskLevel: High
      confidence: 0.95
    vars:
      input: Query
`,
      );

      await expect(loadTests(yamlPath, tempDir)).rejects.toThrow(
        'tests[0].expected_output has been removed',
      );
    });

    it('resolves input message array from YAML', async () => {
      const yamlPath = path.join(tempDir, 'input-messages.yaml');
      await writeFile(
        yamlPath,
        `prompts:
  - "{{ input }}"
tests:
  - id: test-1
    criteria: Goal
    vars:
      input:
        - role: user
          content: Hello from YAML
`,
      );

      const cases = await loadTests(yamlPath, tempDir);

      expect(cases).toHaveLength(1);
      expect(cases[0].input[0].content).toBe('Hello from YAML');
    });
  });

  describe('Mixed canonical and alias usage', () => {
    it('rejects mixing authored YAML expected_output forms', async () => {
      const yamlPath = path.join(tempDir, 'mixed.yaml');
      await writeFile(
        yamlPath,
        `prompts:
  - "{{ input }}"
tests:
  - id: test-canonical
    criteria: Goal
    expected_output:
      - role: assistant
        content: Canonical response
    vars:
      input:
        - role: user
          content: Using canonical
  - id: test-alias
    criteria: Goal
    expected_output: Alias response
    vars:
      input: Using alias shorthand
`,
      );

      await expect(loadTests(yamlPath, tempDir)).rejects.toThrow(
        'tests[0].expected_output has been removed',
      );
    });

    it('supports expected_output in JSONL raw cases but rejects authored YAML', async () => {
      const yamlPath = path.join(tempDir, 'equiv-alias.yaml');
      const jsonlPath = path.join(tempDir, 'equiv-alias.jsonl');

      await writeFile(
        yamlPath,
        `prompts:
  - "{{ input }}"
tests:
  - id: test-1
    criteria: Goal
    expected_output:
      answer: 4
    vars:
      input: What is 2+2?
`,
      );

      await writeFile(
        jsonlPath,
        '{"id": "test-1", "criteria": "Goal", "input": "What is 2+2?", "expected_output": {"answer": 4}}\n',
      );

      await expect(loadTests(yamlPath, tempDir)).rejects.toThrow(
        'tests[0].expected_output has been removed',
      );
      const jsonlCases = await loadTests(jsonlPath, tempDir);

      expect(jsonlCases).toHaveLength(1);
      const jsonlContent = jsonlCases[0].expected_output[0].content as { answer: number };
      expect(jsonlContent.answer).toBe(4);
    });
  });
});

describe('Promptfoo scenarios (YAML)', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = path.join(os.tmpdir(), `agentv-test-scenarios-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('loads scenarios-only files as ordinary tests', async () => {
    const yamlPath = path.join(tempDir, 'scenarios-only.yaml');
    await writeFile(
      yamlPath,
      `prompts:
  - "Review {{ severity }} {{ diff }}"
scenarios:
  - config:
      - vars:
          severity: high
    tests:
      - vars:
          diff: critical fix
        assert:
          - type: contains
            value: critical
`,
    );

    const cases = await loadTests(yamlPath, tempDir);

    expect(cases).toHaveLength(1);
    expect(cases[0].id).toBe('scenario-1-1-1');
    expect(cases[0].question).toBe('Review high critical fix');
    expect(cases[0].vars).toEqual({ severity: 'high', diff: 'critical fix' });
    expect(cases[0].assertions?.[0]).toMatchObject({ type: 'contains', value: 'critical' });
  });

  it('appends lowered scenarios after normal tests', async () => {
    const yamlPath = path.join(tempDir, 'tests-and-scenarios.yaml');
    await writeFile(
      yamlPath,
      `prompts:
  - "Review {{ diff }}"
tests:
  - id: canonical
    vars:
      diff: ordinary change
    assert:
      - type: contains
        value: ordinary
scenarios:
  - config:
      - vars:
          severity: high
    tests:
      - vars:
          diff: critical fix
        assert:
          - type: contains
            value: critical
`,
    );

    const cases = await loadTests(yamlPath, tempDir);

    expect(cases.map((test) => test.id)).toEqual(['canonical', 'scenario-1-1-1']);
  });

  it('merges default_test, scenario config, and scenario test fields in precedence order', async () => {
    const yamlPath = path.join(tempDir, 'scenario-merge.yaml');
    await writeFile(
      yamlPath,
      `prompts:
  - "Review {{ shared }} {{ default_only }} {{ config_only }} {{ test_only }}"
default_test:
  vars:
    shared: default
    default_only: base
  options:
    repeat:
      count: 2
  assert:
    - type: contains
      value: default assertion
scenarios:
  - config:
      - vars:
          shared: config
          config_only: config value
        metadata:
          owner: config
          source: scenario-config
        options:
          repeat:
            count: 3
        run:
          timeout_seconds: 10
        assert:
          - type: contains
            value: config assertion
    tests:
      - vars:
          shared: test
          test_only: test value
        metadata:
          owner: test
        options:
          repeat:
            count: 4
        run:
          threshold: 0.8
        assert:
          - type: contains
            value: test assertion
`,
    );

    const cases = await loadTests(yamlPath, tempDir);

    expect(cases).toHaveLength(1);
    expect(cases[0].vars).toEqual({
      shared: 'test',
      default_only: 'base',
      config_only: 'config value',
      test_only: 'test value',
    });
    expect(cases[0].metadata).toMatchObject({
      owner: 'test',
      source: 'scenario-config',
    });
    expect(cases[0].run).toMatchObject({
      repeat: { count: 4, strategy: 'pass_any' },
      timeoutSeconds: 10,
      threshold: 0.8,
    });
    expect(cases[0].assertions?.map((assertion) => assertion.value)).toEqual([
      'config assertion',
      'test assertion',
      'default assertion',
    ]);
  });

  it('expands top-level prompt matrices through lowered scenarios', async () => {
    const yamlPath = path.join(tempDir, 'scenario-prompts.yaml');
    await writeFile(
      yamlPath,
      `prompts:
  - id: alpha
    raw: "Alpha {{ diff }}"
  - id: beta
    raw: "Beta {{ diff }}"
scenarios:
  - config:
      - vars:
          severity: high
    tests:
      - vars:
          diff: critical fix
        assert:
          - type: contains
            value: fix
`,
    );

    const cases = await loadTests(yamlPath, tempDir);

    expect(cases.map((test) => test.id)).toEqual([
      'scenario-1-1-1__prompt_alpha',
      'scenario-1-1-1__prompt_beta',
    ]);
    expect(cases.map((test) => test.testId)).toEqual(['scenario-1-1-1', 'scenario-1-1-1']);
    expect(cases.map((test) => test.question)).toEqual(['Alpha critical fix', 'Beta critical fix']);
  });

  it('rejects malformed scenarios at load time', async () => {
    const yamlPath = path.join(tempDir, 'malformed-scenario.yaml');
    await writeFile(
      yamlPath,
      `prompts:
  - "Review {{ diff }}"
scenarios:
  - tests:
      - vars:
          diff: critical fix
        assert:
          - type: contains
            value: critical
`,
    );

    await expect(loadTests(yamlPath, tempDir)).rejects.toThrow(
      'scenarios[0].config must be an array',
    );
  });

  it('hard-errors removed fields inside scenarios at load time', async () => {
    const yamlPath = path.join(tempDir, 'scenario-removed-field.yaml');
    await writeFile(
      yamlPath,
      `prompts:
  - "Review {{ diff }}"
scenarios:
  - config:
      - vars:
          severity: high
    tests:
      - input: removed
        vars:
          diff: critical fix
        assert:
          - type: contains
            value: critical
`,
    );

    await expect(loadTests(yamlPath, tempDir)).rejects.toThrow(
      'scenarios[0].tests[0].input has been removed',
    );
  });
});

describe('Backward-compat aliases', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = path.join(os.tmpdir(), `agentv-test-compat-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('removed eval_cases/evalcases aliases (YAML)', () => {
    it('rejects eval_cases as a removed top-level alias for tests', async () => {
      const yamlPath = path.join(tempDir, 'eval-cases-alias.yaml');
      await writeFile(
        yamlPath,
        `eval_cases:
  - id: test-1
    criteria: Goal
    vars:
      input:
        - role: user
          content: Query
prompts:
  - "{{ input }}"
`,
      );

      await expect(loadTests(yamlPath, tempDir)).rejects.toThrow(
        "Top-level 'eval_cases' has been removed from authored eval YAML. Use 'tests' instead.",
      );
    });

    it('rejects evalcases as a removed top-level alias for tests', async () => {
      const yamlPath = path.join(tempDir, 'evalcases-alias.yaml');
      await writeFile(
        yamlPath,
        `evalcases:
  - id: test-1
    criteria: Goal
    input:
      - role: user
        content: Query
`,
      );

      await expect(loadTests(yamlPath, tempDir)).rejects.toThrow(
        "Top-level 'evalcases' has been removed from authored eval YAML. Use 'tests' instead.",
      );
    });

    it('rejects eval_cases even when canonical tests is present', async () => {
      const yamlPath = path.join(tempDir, 'cases-precedence.yaml');
      await writeFile(
        yamlPath,
        `prompts:
  - "{{ input }}"
tests:
  - id: canonical
    criteria: Goal
    vars:
      input:
        - role: user
          content: Query
eval_cases:
  - id: deprecated
    criteria: Goal
    input:
      - role: user
        content: Query
`,
      );

      await expect(loadTests(yamlPath, tempDir)).rejects.toThrow(
        "Top-level 'eval_cases' has been removed from authored eval YAML. Use 'tests' instead.",
      );
    });
  });

  describe('expected_outcome → assert compatibility (YAML)', () => {
    it('supports expected_outcome as deprecated assertion shorthand', async () => {
      const yamlPath = path.join(tempDir, 'expected-outcome-alias.yaml');
      await writeFile(
        yamlPath,
        `prompts:
  - "{{ input }}"
tests:
  - id: test-1
    expected_outcome: Goal
    vars:
      input:
        - role: user
          content: Query
`,
      );

      const cases = await loadTests(yamlPath, tempDir);

      expect(cases).toHaveLength(1);
      expect(cases[0].id).toBe('test-1');
      expect(cases[0].criteria).toBe('Goal');
    });

    it('criteria takes precedence over expected_outcome', async () => {
      const yamlPath = path.join(tempDir, 'criteria-precedence.yaml');
      await writeFile(
        yamlPath,
        `prompts:
  - "{{ input }}"
tests:
  - id: test-1
    criteria: Canonical
    expected_outcome: Deprecated
    vars:
      input:
        - role: user
          content: Query
`,
      );

      const cases = await loadTests(yamlPath, tempDir);

      expect(cases).toHaveLength(1);
      expect(cases[0].criteria).toBe('Canonical');
    });
  });

  describe('expected_outcome → assert compatibility (JSONL)', () => {
    it('supports expected_outcome as deprecated assertion shorthand', async () => {
      const jsonlPath = path.join(tempDir, 'expected-outcome-alias.jsonl');
      await writeFile(
        jsonlPath,
        '{"id": "test-1", "expected_outcome": "Goal", "input": [{"role": "user", "content": "Query"}]}\n',
      );

      const cases = await loadTestsFromJsonl(jsonlPath, tempDir);

      expect(cases).toHaveLength(1);
      expect(cases[0].id).toBe('test-1');
      expect(cases[0].criteria).toBe('Goal');
    });

    it('criteria takes precedence over expected_outcome in JSONL', async () => {
      const jsonlPath = path.join(tempDir, 'criteria-precedence.jsonl');
      await writeFile(
        jsonlPath,
        '{"id": "test-1", "criteria": "Canonical", "expected_outcome": "Deprecated", "input": [{"role": "user", "content": "Query"}]}\n',
      );

      const cases = await loadTestsFromJsonl(jsonlPath, tempDir);

      expect(cases).toHaveLength(1);
      expect(cases[0].criteria).toBe('Canonical');
    });
  });
});
