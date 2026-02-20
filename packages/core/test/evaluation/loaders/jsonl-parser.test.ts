import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { detectFormat, loadTestsFromJsonl } from '../../../src/evaluation/loaders/jsonl-parser.js';
import { loadTests } from '../../../src/evaluation/yaml-parser.js';

describe('detectFormat', () => {
  it('returns jsonl for .jsonl extension', () => {
    expect(detectFormat('test.jsonl')).toBe('jsonl');
    expect(detectFormat('/path/to/dataset.jsonl')).toBe('jsonl');
  });

  it('returns yaml for .yaml extension', () => {
    expect(detectFormat('test.yaml')).toBe('yaml');
    expect(detectFormat('/path/to/config.yaml')).toBe('yaml');
  });

  it('returns yaml for .yml extension', () => {
    expect(detectFormat('test.yml')).toBe('yaml');
    expect(detectFormat('/path/to/config.yml')).toBe('yaml');
  });

  it('throws for unsupported extensions', () => {
    expect(() => detectFormat('test.json')).toThrow('Unsupported file format');
    expect(() => detectFormat('test.txt')).toThrow('Unsupported file format');
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
      '{"id": "test-1", "criteria": "Goal", "input_messages": [{"role": "user", "content": "Query"}]}\n',
    );

    const cases = await loadTestsFromJsonl(jsonlPath, tempDir);

    expect(cases).toHaveLength(1);
    expect(cases[0].id).toBe('test-1');
    expect(cases[0].criteria).toBe('Goal');
    expect(cases[0].input_messages).toHaveLength(1);
    expect(cases[0].input_messages[0].role).toBe('user');
    expect(cases[0].input_messages[0].content).toBe('Query');
  });

  it('parses multi-line JSONL', async () => {
    const jsonlPath = path.join(tempDir, 'multi.jsonl');
    await writeFile(
      jsonlPath,
      [
        '{"id": "test-1", "criteria": "Goal 1", "input_messages": [{"role": "user", "content": "Query 1"}]}',
        '{"id": "test-2", "criteria": "Goal 2", "input_messages": [{"role": "user", "content": "Query 2"}]}',
        '{"id": "test-3", "criteria": "Goal 3", "input_messages": [{"role": "user", "content": "Query 3"}]}',
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
        '{"id": "test-1", "criteria": "Goal 1", "input_messages": [{"role": "user", "content": "Query 1"}]}',
        '',
        '{"id": "test-2", "criteria": "Goal 2", "input_messages": [{"role": "user", "content": "Query 2"}]}',
        '   ',
        '{"id": "test-3", "criteria": "Goal 3", "input_messages": [{"role": "user", "content": "Query 3"}]}',
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
        '{"id": "test-1", "criteria": "Goal 1", "input_messages": [{"role": "user", "content": "Query 1"}]}',
        '{"id": "test-2", "criteria": "Goal 2", "input_messages": [{"role": "user", "content": "Query 2"}]}',
        '{"id": "test-3", "criteria": "Goal 3" "input_messages": []}', // Missing comma
      ].join('\n'),
    );

    await expect(loadTestsFromJsonl(jsonlPath, tempDir)).rejects.toThrow(/Line 3/);
  });

  it('skips cases with missing required fields', async () => {
    const jsonlPath = path.join(tempDir, 'missing-fields.jsonl');
    await writeFile(
      jsonlPath,
      [
        '{"id": "test-1", "criteria": "Goal 1", "input_messages": [{"role": "user", "content": "Query 1"}]}',
        '{"id": "test-2", "input_messages": [{"role": "user", "content": "Query 2"}]}', // Missing criteria
        '{"criteria": "Goal 3", "input_messages": [{"role": "user", "content": "Query 3"}]}', // Missing id
        '{"id": "test-4", "criteria": "Goal 4"}', // Missing input_messages
        '{"id": "test-5", "criteria": "Goal 5", "input_messages": [{"role": "user", "content": "Query 5"}]}',
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
      '{"id": "test-1", "criteria": "Goal", "input_messages": [{"role": "user", "content": "Query"}]}\n',
    );
    await writeFile(
      sidecarPath,
      'description: Test dataset\ndataset: my-tests\nevaluator: llm_judge\n',
    );

    const cases = await loadTestsFromJsonl(jsonlPath, tempDir);

    expect(cases).toHaveLength(1);
    expect(cases[0].dataset).toBe('my-tests');
    expect(cases[0].evaluator).toBe('llm_judge');
  });

  it('uses default dataset name from filename when no sidecar', async () => {
    const jsonlPath = path.join(tempDir, 'my-dataset.jsonl');
    await writeFile(
      jsonlPath,
      '{"id": "test-1", "criteria": "Goal", "input_messages": [{"role": "user", "content": "Query"}]}\n',
    );

    const cases = await loadTestsFromJsonl(jsonlPath, tempDir);

    expect(cases).toHaveLength(1);
    expect(cases[0].dataset).toBe('my-dataset');
  });

  it('supports per-case evaluators override', async () => {
    const jsonlPath = path.join(tempDir, 'with-evaluators.jsonl');
    await writeFile(
      jsonlPath,
      '{"id": "test-1", "criteria": "Goal", "input_messages": [{"role": "user", "content": "Query"}], "evaluators": [{"name": "rubric-check", "type": "llm_judge", "rubrics": [{"id": "r1", "description": "Must be polite", "weight": 1.0, "required": true}]}]}\n',
    );

    const cases = await loadTestsFromJsonl(jsonlPath, tempDir);

    expect(cases).toHaveLength(1);
    expect(cases[0].evaluators).toHaveLength(1);
    expect(cases[0].evaluators?.[0].name).toBe('rubric-check');
  });

  it('supports inline rubrics field', async () => {
    const jsonlPath = path.join(tempDir, 'with-rubrics.jsonl');
    await writeFile(
      jsonlPath,
      '{"id": "test-1", "criteria": "Goal", "input_messages": [{"role": "user", "content": "Query"}], "rubrics": ["Must be polite", "Must be helpful"]}\n',
    );

    const cases = await loadTestsFromJsonl(jsonlPath, tempDir);

    expect(cases).toHaveLength(1);
    expect(cases[0].evaluators).toHaveLength(1);
    expect(cases[0].evaluators?.[0].type).toBe('llm_judge');
    const rubricEvaluator = cases[0].evaluators?.[0] as { type: string; rubrics?: unknown[] };
    expect(rubricEvaluator.rubrics).toHaveLength(2);
  });

  it('filters by pattern (exact match)', async () => {
    const jsonlPath = path.join(tempDir, 'filter.jsonl');
    await writeFile(
      jsonlPath,
      [
        '{"id": "test-1", "criteria": "Goal 1", "input_messages": [{"role": "user", "content": "Query 1"}]}',
        '{"id": "test-2", "criteria": "Goal 2", "input_messages": [{"role": "user", "content": "Query 2"}]}',
        '{"id": "test-3", "criteria": "Goal 3", "input_messages": [{"role": "user", "content": "Query 3"}]}',
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
        '{"id": "summary-basic", "criteria": "Goal 1", "input_messages": [{"role": "user", "content": "Query 1"}]}',
        '{"id": "summary-advanced", "criteria": "Goal 2", "input_messages": [{"role": "user", "content": "Query 2"}]}',
        '{"id": "code-review", "criteria": "Goal 3", "input_messages": [{"role": "user", "content": "Query 3"}]}',
      ].join('\n'),
    );

    const cases = await loadTestsFromJsonl(jsonlPath, tempDir, { filter: 'summary-*' });

    expect(cases).toHaveLength(2);
    expect(cases.map((c) => c.id)).toEqual(['summary-basic', 'summary-advanced']);
  });

  it('supports conversation_id field', async () => {
    const jsonlPath = path.join(tempDir, 'with-conv-id.jsonl');
    await writeFile(
      jsonlPath,
      '{"id": "test-1", "conversation_id": "conv-123", "criteria": "Goal", "input_messages": [{"role": "user", "content": "Query"}]}\n',
    );

    const cases = await loadTestsFromJsonl(jsonlPath, tempDir);

    expect(cases).toHaveLength(1);
    expect(cases[0].conversation_id).toBe('conv-123');
  });

  it('supports expected_messages field', async () => {
    const jsonlPath = path.join(tempDir, 'with-expected.jsonl');
    await writeFile(
      jsonlPath,
      '{"id": "test-1", "criteria": "Goal", "input_messages": [{"role": "user", "content": "Query"}], "expected_messages": [{"role": "assistant", "content": "Response"}]}\n',
    );

    const cases = await loadTestsFromJsonl(jsonlPath, tempDir);

    expect(cases).toHaveLength(1);
    expect(cases[0].expected_messages).toHaveLength(1);
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
      '{"id": "jsonl-test", "criteria": "Goal", "input_messages": [{"role": "user", "content": "Query"}]}\n',
    );

    const cases = await loadTests(jsonlPath, tempDir);

    expect(cases).toHaveLength(1);
    expect(cases[0].id).toBe('jsonl-test');
  });

  it('routes .yaml to YAML parser', async () => {
    const yamlPath = path.join(tempDir, 'test.yaml');
    await writeFile(
      yamlPath,
      `tests:
  - id: yaml-test
    criteria: Goal
    input_messages:
      - role: user
        content: Query
`,
    );

    const cases = await loadTests(yamlPath, tempDir);

    expect(cases).toHaveLength(1);
    expect(cases[0].id).toBe('yaml-test');
  });

  it('routes .yml to YAML parser', async () => {
    const ymlPath = path.join(tempDir, 'test.yml');
    await writeFile(
      ymlPath,
      `tests:
  - id: yml-test
    criteria: Goal
    input_messages:
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
      `dataset: my-dataset
tests:
  - id: test-1
    criteria: "The agent should respond with a helpful answer"
    input_messages:
      - role: user
        content: "What is 2+2?"
`,
    );

    // JSONL with equivalent sidecar
    const sidecarPath = path.join(tempDir, 'equiv-sidecar.yaml');
    await writeFile(sidecarPath, 'dataset: my-dataset\n');

    const jsonlPath2 = path.join(tempDir, 'equiv-sidecar.jsonl');
    await writeFile(
      jsonlPath2,
      '{"id": "test-1", "criteria": "The agent should respond with a helpful answer", "input_messages": [{"role": "user", "content": "What is 2+2?"}]}\n',
    );

    const yamlCases = await loadTests(yamlPath, tempDir);
    const jsonlCases = await loadTests(jsonlPath2, tempDir);

    expect(yamlCases).toHaveLength(1);
    expect(jsonlCases).toHaveLength(1);

    // Core fields should match
    expect(jsonlCases[0].id).toBe(yamlCases[0].id);
    expect(jsonlCases[0].criteria).toBe(yamlCases[0].criteria);
    expect(jsonlCases[0].dataset).toBe(yamlCases[0].dataset);
    expect(jsonlCases[0].input_messages.length).toBe(yamlCases[0].input_messages.length);
    expect(jsonlCases[0].input_messages[0].role).toBe(yamlCases[0].input_messages[0].role);
    expect(jsonlCases[0].input_messages[0].content).toBe(yamlCases[0].input_messages[0].content);
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
      expect(cases[0].input_messages).toHaveLength(1);
      expect(cases[0].input_messages[0].role).toBe('user');
      expect(cases[0].input_messages[0].content).toBe('What is 2+2?');
    });

    it('supports input as message array', async () => {
      const jsonlPath = path.join(tempDir, 'input-array.jsonl');
      await writeFile(
        jsonlPath,
        '{"id": "test-1", "criteria": "Goal", "input": [{"role": "system", "content": "Be helpful"}, {"role": "user", "content": "Hello"}]}\n',
      );

      const cases = await loadTestsFromJsonl(jsonlPath, tempDir);

      expect(cases).toHaveLength(1);
      expect(cases[0].input_messages).toHaveLength(2);
      expect(cases[0].input_messages[0].role).toBe('system');
      expect(cases[0].input_messages[1].role).toBe('user');
    });

    it('supports expected_output string shorthand', async () => {
      const jsonlPath = path.join(tempDir, 'expected-string.jsonl');
      await writeFile(
        jsonlPath,
        '{"id": "test-1", "criteria": "Goal", "input": "Query", "expected_output": "The answer is 4"}\n',
      );

      const cases = await loadTestsFromJsonl(jsonlPath, tempDir);

      expect(cases).toHaveLength(1);
      expect(cases[0].expected_messages).toHaveLength(1);
      expect(cases[0].expected_messages[0].role).toBe('assistant');
      expect(cases[0].expected_messages[0].content).toBe('The answer is 4');
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
      expect(cases[0].expected_messages).toHaveLength(1);
      expect(cases[0].expected_messages[0].role).toBe('assistant');
      const content = cases[0].expected_messages[0].content as { riskLevel: string };
      expect(content.riskLevel).toBe('High');
    });

    it('canonical input_messages takes precedence over input alias', async () => {
      const jsonlPath = path.join(tempDir, 'canonical-precedence.jsonl');
      await writeFile(
        jsonlPath,
        '{"id": "test-1", "criteria": "Goal", "input_messages": [{"role": "user", "content": "Canonical"}], "input": "Should be ignored"}\n',
      );

      const cases = await loadTestsFromJsonl(jsonlPath, tempDir);

      expect(cases).toHaveLength(1);
      expect(cases[0].input_messages[0].content).toBe('Canonical');
    });

    it('canonical expected_messages takes precedence over expected_output alias', async () => {
      const jsonlPath = path.join(tempDir, 'canonical-expected-precedence.jsonl');
      await writeFile(
        jsonlPath,
        '{"id": "test-1", "criteria": "Goal", "input": "Query", "expected_messages": [{"role": "assistant", "content": "Canonical"}], "expected_output": "Should be ignored"}\n',
      );

      const cases = await loadTestsFromJsonl(jsonlPath, tempDir);

      expect(cases).toHaveLength(1);
      expect(cases[0].expected_messages[0].content).toBe('Canonical');
    });
  });

  describe('YAML aliases', () => {
    it('supports input string shorthand', async () => {
      const yamlPath = path.join(tempDir, 'input-shorthand.yaml');
      await writeFile(
        yamlPath,
        `tests:
  - id: test-1
    criteria: Goal
    input: "What is 2+2?"
`,
      );

      const cases = await loadTests(yamlPath, tempDir);

      expect(cases).toHaveLength(1);
      expect(cases[0].input_messages).toHaveLength(1);
      expect(cases[0].input_messages[0].role).toBe('user');
      expect(cases[0].input_messages[0].content).toBe('What is 2+2?');
    });

    it('supports input as message array', async () => {
      const yamlPath = path.join(tempDir, 'input-array.yaml');
      await writeFile(
        yamlPath,
        `tests:
  - id: test-1
    criteria: Goal
    input:
      - role: system
        content: Be helpful
      - role: user
        content: Hello
`,
      );

      const cases = await loadTests(yamlPath, tempDir);

      expect(cases).toHaveLength(1);
      expect(cases[0].input_messages).toHaveLength(2);
      expect(cases[0].input_messages[0].role).toBe('system');
      expect(cases[0].input_messages[1].role).toBe('user');
    });

    it('supports expected_output string shorthand', async () => {
      const yamlPath = path.join(tempDir, 'expected-string.yaml');
      await writeFile(
        yamlPath,
        `tests:
  - id: test-1
    criteria: Goal
    input: Query
    expected_output: "The answer is 4"
`,
      );

      const cases = await loadTests(yamlPath, tempDir);

      expect(cases).toHaveLength(1);
      expect(cases[0].expected_messages).toHaveLength(1);
      expect(cases[0].expected_messages[0].role).toBe('assistant');
      expect(cases[0].expected_messages[0].content).toBe('The answer is 4');
    });

    it('supports expected_output object shorthand', async () => {
      const yamlPath = path.join(tempDir, 'expected-object.yaml');
      await writeFile(
        yamlPath,
        `tests:
  - id: test-1
    criteria: Goal
    input: Query
    expected_output:
      riskLevel: High
      confidence: 0.95
`,
      );

      const cases = await loadTests(yamlPath, tempDir);

      expect(cases).toHaveLength(1);
      expect(cases[0].expected_messages).toHaveLength(1);
      expect(cases[0].expected_messages[0].role).toBe('assistant');
      const content = cases[0].expected_messages[0].content as { riskLevel: string };
      expect(content.riskLevel).toBe('High');
    });

    it('canonical input_messages takes precedence over input alias', async () => {
      const yamlPath = path.join(tempDir, 'canonical-precedence.yaml');
      await writeFile(
        yamlPath,
        `tests:
  - id: test-1
    criteria: Goal
    input_messages:
      - role: user
        content: Canonical
    input: Should be ignored
`,
      );

      const cases = await loadTests(yamlPath, tempDir);

      expect(cases).toHaveLength(1);
      expect(cases[0].input_messages[0].content).toBe('Canonical');
    });
  });

  describe('Mixed canonical and alias usage', () => {
    it('allows mixing canonical and alias in same file', async () => {
      const yamlPath = path.join(tempDir, 'mixed.yaml');
      await writeFile(
        yamlPath,
        `tests:
  - id: test-canonical
    criteria: Goal
    input_messages:
      - role: user
        content: Using canonical
    expected_messages:
      - role: assistant
        content: Canonical response
  - id: test-alias
    criteria: Goal
    input: "Using alias shorthand"
    expected_output: "Alias response"
`,
      );

      const cases = await loadTests(yamlPath, tempDir);

      expect(cases).toHaveLength(2);
      expect(cases[0].id).toBe('test-canonical');
      expect(cases[0].input_messages[0].content).toBe('Using canonical');
      expect(cases[1].id).toBe('test-alias');
      expect(cases[1].input_messages[0].content).toBe('Using alias shorthand');
      expect(cases[1].expected_messages[0].content).toBe('Alias response');
    });

    it('YAML and JSONL aliases produce equivalent results', async () => {
      const yamlPath = path.join(tempDir, 'equiv-alias.yaml');
      const jsonlPath = path.join(tempDir, 'equiv-alias.jsonl');

      await writeFile(
        yamlPath,
        `tests:
  - id: test-1
    criteria: Goal
    input: "What is 2+2?"
    expected_output:
      answer: 4
`,
      );

      await writeFile(
        jsonlPath,
        '{"id": "test-1", "criteria": "Goal", "input": "What is 2+2?", "expected_output": {"answer": 4}}\n',
      );

      const yamlCases = await loadTests(yamlPath, tempDir);
      const jsonlCases = await loadTests(jsonlPath, tempDir);

      expect(yamlCases).toHaveLength(1);
      expect(jsonlCases).toHaveLength(1);

      // Input should match
      expect(jsonlCases[0].input_messages[0].role).toBe(yamlCases[0].input_messages[0].role);
      expect(jsonlCases[0].input_messages[0].content).toBe(yamlCases[0].input_messages[0].content);

      // Expected output should match
      expect(jsonlCases[0].expected_messages[0].role).toBe(yamlCases[0].expected_messages[0].role);
      const yamlContent = yamlCases[0].expected_messages[0].content as { answer: number };
      const jsonlContent = jsonlCases[0].expected_messages[0].content as { answer: number };
      expect(jsonlContent.answer).toBe(yamlContent.answer);
    });
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

  describe('eval_cases → tests alias (YAML)', () => {
    it('supports eval_cases as deprecated alias for tests', async () => {
      const yamlPath = path.join(tempDir, 'eval-cases-alias.yaml');
      await writeFile(
        yamlPath,
        `eval_cases:
  - id: test-1
    criteria: Goal
    input_messages:
      - role: user
        content: Query
`,
      );

      const cases = await loadTests(yamlPath, tempDir);

      expect(cases).toHaveLength(1);
      expect(cases[0].id).toBe('test-1');
      expect(cases[0].criteria).toBe('Goal');
    });

    it('supports evalcases as deprecated alias for tests', async () => {
      const yamlPath = path.join(tempDir, 'evalcases-alias.yaml');
      await writeFile(
        yamlPath,
        `evalcases:
  - id: test-1
    criteria: Goal
    input_messages:
      - role: user
        content: Query
`,
      );

      const cases = await loadTests(yamlPath, tempDir);

      expect(cases).toHaveLength(1);
      expect(cases[0].id).toBe('test-1');
    });

    it('tests takes precedence over eval_cases', async () => {
      const yamlPath = path.join(tempDir, 'cases-precedence.yaml');
      await writeFile(
        yamlPath,
        `tests:
  - id: canonical
    criteria: Goal
    input_messages:
      - role: user
        content: Query
eval_cases:
  - id: deprecated
    criteria: Goal
    input_messages:
      - role: user
        content: Query
`,
      );

      const cases = await loadTests(yamlPath, tempDir);

      expect(cases).toHaveLength(1);
      expect(cases[0].id).toBe('canonical');
    });
  });

  describe('expected_outcome → criteria alias (YAML)', () => {
    it('supports expected_outcome as deprecated alias for criteria', async () => {
      const yamlPath = path.join(tempDir, 'expected-outcome-alias.yaml');
      await writeFile(
        yamlPath,
        `tests:
  - id: test-1
    expected_outcome: Goal
    input_messages:
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
        `tests:
  - id: test-1
    criteria: Canonical
    expected_outcome: Deprecated
    input_messages:
      - role: user
        content: Query
`,
      );

      const cases = await loadTests(yamlPath, tempDir);

      expect(cases).toHaveLength(1);
      expect(cases[0].criteria).toBe('Canonical');
    });
  });

  describe('expected_outcome → criteria alias (JSONL)', () => {
    it('supports expected_outcome as deprecated alias for criteria', async () => {
      const jsonlPath = path.join(tempDir, 'expected-outcome-alias.jsonl');
      await writeFile(
        jsonlPath,
        '{"id": "test-1", "expected_outcome": "Goal", "input_messages": [{"role": "user", "content": "Query"}]}\n',
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
        '{"id": "test-1", "criteria": "Canonical", "expected_outcome": "Deprecated", "input_messages": [{"role": "user", "content": "Query"}]}\n',
      );

      const cases = await loadTestsFromJsonl(jsonlPath, tempDir);

      expect(cases).toHaveLength(1);
      expect(cases[0].criteria).toBe('Canonical');
    });
  });
});
