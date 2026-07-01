import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { validateEvalFile } from '../../../src/evaluation/validation/eval-validator.js';

describe('validateEvalFile', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = path.join(os.tmpdir(), `agentv-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('validates eval file with input alias string shorthand', async () => {
    const filePath = path.join(tempDir, 'input-alias.yaml');
    await writeFile(
      filePath,
      `tests:
  - id: test-1
    criteria: Goal
    input: "What is 2+2?"
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validates top-level target and run controls with flatter import entries', async () => {
    const filePath = path.join(tempDir, 'run-controls-include.yaml');
    await writeFile(
      filePath,
      `name: wrapper
target: codex
threshold: 0.8
repeat:
  count: 2
  strategy: pass_any
  early_exit: true
tests:
  - id: local-case
    input: "Hello"
imports:
  suites:
    - path: ./evals/**/*.eval.yaml
      select:
        test_ids: [pr50857-*]
        tags: [sql-migration]
        metadata:
          type: [e2e, regression]
          priority: high
      run:
        threshold: 1.0
        repeat:
          count: 2
          strategy: pass_all
          early_exit: true
        timeout_seconds: 120
        budget_usd: 2
  tests:
    - path: ./cases/**/*.cases.yaml
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validates default_test.threshold', async () => {
    const filePath = path.join(tempDir, 'default-test-threshold.yaml');
    await writeFile(
      filePath,
      `default_test:
  threshold: 0.6
tests:
  - id: test-1
    criteria: Goal
    input: Query
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects invalid default_test threshold values and unsupported default fields', async () => {
    const filePath = path.join(tempDir, 'invalid-default-test-threshold.yaml');
    await writeFile(
      filePath,
      `default_test:
  threshold: 1.2
  assertions: []
tests:
  - id: test-1
    criteria: Goal
    input: Query
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) => error.severity === 'error' && error.location === 'default_test.threshold',
      ),
    ).toBe(true);
    expect(
      result.errors.some(
        (error) => error.severity === 'error' && error.location === 'default_test.assertions',
      ),
    ).toBe(true);
  });

  it('rejects removed top-level runs and early_exit with migration guidance', async () => {
    const filePath = path.join(tempDir, 'removed-repeat-fields.yaml');
    await writeFile(
      filePath,
      `target: codex
runs: 2
early_exit: true
tests:
  - id: local-case
    input: "Hello"
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.message.includes('Use repeat.count'))).toBe(true);
    expect(result.errors.some((error) => error.message.includes('Use repeat.early_exit'))).toBe(
      true,
    );
  });

  it('rejects unsupported test-level execution.targets', async () => {
    const filePath = path.join(tempDir, 'test-level-targets.yaml');
    await writeFile(
      filePath,
      `tests:
  - id: target-specific
    input: "Hello"
    criteria: "Greet"
    execution:
      targets: [codex]
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) =>
          error.severity === 'error' &&
          error.location === 'tests[0].execution.targets' &&
          error.message === "Unsupported test execution field 'targets'.",
      ),
    ).toBe(true);
  });

  it('rejects unsupported test-level execution.target', async () => {
    const filePath = path.join(tempDir, 'test-level-target.yaml');
    await writeFile(
      filePath,
      `tests:
  - id: target-specific
    input: "Hello"
    criteria: "Greet"
    execution:
      target: codex
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) =>
          error.severity === 'error' &&
          error.location === 'tests[0].execution.target' &&
          error.message === "Unsupported test execution field 'target'.",
      ),
    ).toBe(true);
  });

  it('rejects include entries without type', async () => {
    const filePath = path.join(tempDir, 'include-missing-type.yaml');
    await writeFile(
      filePath,
      `tests:
  - include: ./cases/**/*.cases.yaml
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.message.includes("Missing 'type'"))).toBe(true);
  });

  it('rejects parent workspace when importing suites', async () => {
    const childPath = path.join(tempDir, 'composition-child-workspace.eval.yaml');
    await writeFile(
      childPath,
      `workspace:
  path: ./child-workspace
tests:
  - id: child-case
    criteria: Goal
    input: Query
`,
    );
    const filePath = path.join(tempDir, 'composition-parent-workspace.eval.yaml');
    await writeFile(
      filePath,
      `workspace:
  path: ./parent-workspace
tests:
  - include: composition-child-workspace.eval.yaml
    type: suite
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) =>
          error.severity === 'error' &&
          error.location === 'workspace' &&
          error.message.includes('Parent workspace is not allowed') &&
          error.message.includes('type: suite'),
      ),
    ).toBe(true);
  });

  it('rejects object-shaped parent experiment blocks when importing suites', async () => {
    await writeFile(
      path.join(tempDir, 'composition-child-experiment-workspace.eval.yaml'),
      `tests:
  - id: child-case
    criteria: Goal
    input: Query
`,
    );
    const filePath = path.join(tempDir, 'composition-parent-experiment-workspace.eval.yaml');
    await writeFile(
      filePath,
      `experiment:
  workspace:
    path: ./parent-workspace
tests:
  - include: composition-child-experiment-workspace.eval.yaml
    type: suite
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) =>
          error.severity === 'error' &&
          error.location === 'experiment' &&
          error.message.includes("Top-level 'experiment' must be a string"),
      ),
    ).toBe(true);
  });

  it('rejects legacy execution workspace when importing suites', async () => {
    await writeFile(
      path.join(tempDir, 'composition-child-execution-workspace.eval.yaml'),
      `tests:
  - id: child-case
    criteria: Goal
    input: Query
`,
    );
    const filePath = path.join(tempDir, 'composition-parent-execution-workspace.eval.yaml');
    await writeFile(
      filePath,
      `execution:
  workspace:
    path: ./parent-workspace
tests:
  - include: composition-child-execution-workspace.eval.yaml
    type: suite
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) =>
          error.severity === 'error' &&
          error.location === 'execution.workspace' &&
          error.message.includes('Parent workspace is not allowed') &&
          error.message.includes('type: suite'),
      ),
    ).toBe(true);
  });

  it('rejects object-shaped experiment workspace blocks', async () => {
    const filePath = path.join(tempDir, 'experiment-workspace-legacy-isolation.eval.yaml');
    await writeFile(
      filePath,
      `experiment:
  workspace:
    isolation: per_test
tests:
  - id: test-1
    criteria: Goal
    input: Query
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) =>
          error.severity === 'error' &&
          error.location === 'experiment' &&
          error.message.includes("Top-level 'experiment' must be a string"),
      ),
    ).toBe(true);
  });

  it('rejects task workspace fields in object-shaped experiment', async () => {
    const filePath = path.join(tempDir, 'experiment-workspace-repos.eval.yaml');
    await writeFile(
      filePath,
      `experiment:
  workspace:
    repos:
      - repo: acme/support-app
        path: support-app
tests:
  - id: test-1
    criteria: Goal
    input: Query
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) =>
          error.severity === 'error' &&
          error.location === 'experiment' &&
          error.message.includes("Top-level 'experiment' must be a string"),
      ),
    ).toBe(true);
  });

  it('rejects runtime workspace overrides in object-shaped experiment', async () => {
    const filePath = path.join(tempDir, 'experiment-workspace-runtime.eval.yaml');
    await writeFile(
      filePath,
      `experiment:
  workspace:
    mode: static
    path: ./prepared-workspace
tests:
  - id: test-1
    criteria: Goal
    input: Query
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) =>
          error.severity === 'error' &&
          error.location === 'experiment' &&
          error.message.includes("Top-level 'experiment' must be a string"),
      ),
    ).toBe(true);
  });

  it('rejects test execution workspace blocks', async () => {
    const filePath = path.join(tempDir, 'test-execution-workspace.eval.yaml');
    await writeFile(
      filePath,
      `tests:
  - id: test-1
    criteria: Goal
    input: Query
    execution:
      workspace:
        mode: static
        path: /tmp/my-workspace
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) =>
          error.severity === 'error' &&
          error.location === 'tests[0].execution.workspace' &&
          error.message.includes('has been removed from eval YAML'),
      ),
    ).toBe(true);
  });

  it('rejects authored workers in eval YAML', async () => {
    const filePath = path.join(tempDir, 'authored-workers.eval.yaml');
    await writeFile(
      filePath,
      `workers: 2
execution:
  workers: 3
  targets:
    - name: codex
      workers: 4
tests:
  - id: test-1
    criteria: Goal
    input: Query
    execution:
      workers: 5
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(false);
    expect(
      [
        'workers',
        'execution.workers',
        'execution.targets[0].workers',
        'tests[0].execution.workers',
      ].every((location) =>
        result.errors.some(
          (error) =>
            error.severity === 'error' &&
            error.location === location &&
            error.message.includes('has been removed from eval YAML'),
        ),
      ),
    ).toBe(true);
  });

  it('warns that imported child target and run controls are ignored by wrapper composition', async () => {
    await writeFile(
      path.join(tempDir, 'composition-child-experiment.eval.yaml'),
      `target: child-target
threshold: 0.9
tests:
  - id: child-case
    criteria: Goal
    input: Query
`,
    );
    const filePath = path.join(tempDir, 'composition-parent-no-experiment.eval.yaml');
    await writeFile(
      filePath,
      `tests:
  - include: composition-child-experiment.eval.yaml
    type: suite
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(true);
    expect(
      result.errors.some(
        (error) =>
          error.severity === 'warning' &&
          error.location === 'tests[0].include' &&
          error.message.includes('child target and run controls are ignored') &&
          error.message.includes('parent eval owns wrapper target and run controls'),
      ),
    ).toBe(true);
  });

  it('warns when imports.tests-style raw imports drop eval suite context', async () => {
    await writeFile(
      path.join(tempDir, 'composition-child-tests-import.eval.yaml'),
      `workspace:
  template: ./child-workspace
input: child suite input
assertions:
  - type: contains
    value: child
tests:
  - id: raw-case
    criteria: Goal
    input: Query
`,
    );
    const filePath = path.join(tempDir, 'composition-parent-tests-import.eval.yaml');
    await writeFile(
      filePath,
      `workspace:
  template: ./parent-workspace
tests:
  - include: composition-child-tests-import.eval.yaml
    type: tests
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(true);
    expect(
      result.errors.some(
        (error) =>
          error.severity === 'warning' &&
          error.location === 'tests[0].include' &&
          error.message.includes('imports.tests imports raw cases') &&
          error.message.includes('drops suite context'),
      ),
    ).toBe(true);
  });

  it('rejects missing raw case files under imports.tests', async () => {
    const filePath = path.join(tempDir, 'missing-imports-tests-path.eval.yaml');
    await writeFile(
      filePath,
      `imports:
  tests:
    - path: ./missing-cases.yaml
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) =>
          error.severity === 'error' &&
          error.location === 'imports.tests[0].path' &&
          error.message.includes('Cannot read external test file'),
      ),
    ).toBe(true);
  });

  it('rejects removed execution blocks when experiment label is present', async () => {
    const filePath = path.join(tempDir, 'runtime-conflict.yaml');
    await writeFile(
      filePath,
      `experiment: codex-run
execution:
  target: claude
tests:
  - id: test-1
    criteria: Goal
    input: Query
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) =>
          error.location === 'execution' &&
          error.message.includes("Top-level 'execution' is not part of eval YAML"),
      ),
    ).toBe(true);
  });

  it('rejects scoped run overrides that include target-changing fields', async () => {
    const filePath = path.join(tempDir, 'invalid-run-override.yaml');
    await writeFile(
      filePath,
      `tests:
  - id: test-1
    criteria: Goal
    input: Query
    run:
      threshold: 1.0
      target: other-agent
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.location === 'tests[0].run.target')).toBe(true);
  });

  it('rejects direct circular suite imports', async () => {
    const filePath = path.join(tempDir, 'validator-self-cycle.eval.yaml');
    await writeFile(
      filePath,
      `tests:
  - include: validator-self-cycle.eval.yaml
    type: suite
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some((error) => error.message.includes('Circular eval suite import')),
    ).toBe(true);
    expect(
      result.errors.some((error) => /validator-self-cycle\.eval\.yaml/.test(error.message)),
    ).toBe(true);
  });

  it('rejects indirect circular suite imports', async () => {
    const aPath = path.join(tempDir, 'validator-a.eval.yaml');
    const bPath = path.join(tempDir, 'validator-b.eval.yaml');
    await writeFile(
      aPath,
      `tests:
  - include: validator-b.eval.yaml
    type: suite
`,
    );
    await writeFile(
      bPath,
      `tests:
  - include: validator-a.eval.yaml
    type: suite
`,
    );

    const result = await validateEvalFile(aPath);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some((error) =>
        /validator-a\.eval\.yaml.*validator-b\.eval\.yaml.*validator-a\.eval\.yaml/.test(
          error.message,
        ),
      ),
    ).toBe(true);
  });

  it('validates eval file that omits input when sibling PROMPT.md exists', async () => {
    const evalDir = path.join(tempDir, 'prompt-md-fallback');
    await mkdir(evalDir, { recursive: true });
    await writeFile(path.join(evalDir, 'PROMPT.md'), 'Use the prompt fallback.');
    const filePath = path.join(evalDir, 'EVAL.yaml');
    await writeFile(
      filePath,
      `tests:
  - id: test-1
    criteria: Goal
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validates eval file that omits input when input_files references PROMPT.md', async () => {
    const evalDir = path.join(tempDir, 'prompt-md-input-files');
    await mkdir(path.join(evalDir, 'task'), { recursive: true });
    await writeFile(path.join(evalDir, 'task', 'PROMPT.md'), 'Use the referenced prompt.');
    const filePath = path.join(evalDir, 'EVAL.yaml');
    await writeFile(
      filePath,
      `tests:
  - id: test-1
    criteria: Goal
    input_files:
      - ./task/PROMPT.md
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validates eval file with suite-level input block shorthand', async () => {
    const filePath = path.join(tempDir, 'suite-input-block.yaml');
    await writeFile(
      filePath,
      `input: |
  Read AGENTS.md before answering.
tests:
  - id: test-1
    criteria: Goal
    input: "What is 2+2?"
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validates eval file with suite-level structured object input shorthand', async () => {
    const filePath = path.join(tempDir, 'suite-input-object.yaml');
    await writeFile(
      filePath,
      `input:
  instruction: Classify the request
  labels: [bug, feature]
tests:
  - id: test-1
    criteria: Goal
    input: "The login button is broken."
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validates eval file with suite-level single-message input object', async () => {
    const filePath = path.join(tempDir, 'suite-input-message-object.yaml');
    await writeFile(
      filePath,
      `input:
  role: user
  content:
    task: classify
tests:
  - id: test-1
    criteria: Goal
    input: "The login button is broken."
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects suite-level object input with invalid reserved role', async () => {
    const filePath = path.join(tempDir, 'suite-input-invalid-role-object.yaml');
    await writeFile(
      filePath,
      `input:
  role: admin
  task: classify
tests:
  - id: test-1
    criteria: Goal
    input: "The login button is broken."
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.location === 'input[0].role')).toBe(true);
  });

  it('validates eval file with test-level structured object input shorthand', async () => {
    const filePath = path.join(tempDir, 'test-input-object.yaml');
    await writeFile(
      filePath,
      `tests:
  - id: test-1
    criteria: Goal
    input:
      question: "What is 2+2?"
      format: terse
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects test-level object input with invalid reserved role', async () => {
    const filePath = path.join(tempDir, 'test-input-invalid-role-object.yaml');
    await writeFile(
      filePath,
      `tests:
  - id: test-1
    criteria: Goal
    input:
      role: admin
      task: classify
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.location === 'tests[0].input[0].role')).toBe(true);
  });

  it('validates eval file with input alias message array', async () => {
    const filePath = path.join(tempDir, 'input-array.yaml');
    await writeFile(
      filePath,
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

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validates eval file with expected_output alias string shorthand', async () => {
    const filePath = path.join(tempDir, 'output-string.yaml');
    await writeFile(
      filePath,
      `tests:
  - id: test-1
    criteria: Goal
    input: Query
    expected_output: "The answer is 4"
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validates eval file with expected_output alias object shorthand', async () => {
    const filePath = path.join(tempDir, 'output-object.yaml');
    await writeFile(
      filePath,
      `tests:
  - id: test-1
    criteria: Goal
    input: Query
    expected_output:
      riskLevel: High
      confidence: 0.95
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validates rubric criteria with optional operators', async () => {
    const filePath = path.join(tempDir, 'rubric-operators.yaml');
    await writeFile(
      filePath,
      `tests:
  - id: finance-summary
    criteria: Keep supported facts and avoid contradictions
    input: Summarize the finance note
    assertions:
      - type: rubrics
        criteria:
          - id: supported-revenue
            operator: correctness
            outcome: States revenue increased to $10M
          - id: no-revenue-conflict
            operator: contradiction
            outcome: Revenue increased to $10M
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects eval file without input field', async () => {
    const filePath = path.join(tempDir, 'missing-input.yaml');
    await writeFile(
      filePath,
      `tests:
  - id: test-1
    criteria: Goal
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("'input'"))).toBe(true);
  });

  it('rejects eval file with invalid input alias type', async () => {
    const filePath = path.join(tempDir, 'invalid-input.yaml');
    await writeFile(
      filePath,
      `tests:
  - id: test-1
    criteria: Goal
    input: 123
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("'input'"))).toBe(true);
  });

  it('validates input message array', async () => {
    const filePath = path.join(tempDir, 'input-messages.yaml');
    await writeFile(
      filePath,
      `tests:
  - id: test-1
    criteria: Goal
    input:
      - role: user
        content: Hello
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts vars without unknown-field warnings', async () => {
    const filePath = path.join(tempDir, 'test-vars.yaml');
    await writeFile(
      filePath,
      `tests:
  - id: test-1
    vars:
      question: "What is 2+2?"
      expected:
        answer: "4"
    criteria: "Answers {{question}} correctly"
    input: "Question: {{question}}"
    expected_output: "{{expected.answer}}"
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(true);
    const warnings = result.errors.filter((e) => e.severity === 'warning');
    expect(warnings).toHaveLength(0);
  });

  describe('assertions field validation', () => {
    it('validates assertions array items have type field', async () => {
      const filePath = path.join(tempDir, 'assert-missing-type.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "What is 2+2?"
    assertions:
      - value: test
`,
      );

      const result = await validateEvalFile(filePath);

      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings.some((e) => e.message.includes("'type'"))).toBe(true);
    });

    it('warns on invalid assertion type', async () => {
      const filePath = path.join(tempDir, 'assert-invalid-type.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "What is 2+2?"
    assertions:
      - type: invalid_evaluator
        value: test
`,
      );

      const result = await validateEvalFile(filePath);

      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings.some((e) => e.message.includes('invalid_evaluator'))).toBe(true);
    });

    it('validates contains assertion has value field', async () => {
      const filePath = path.join(tempDir, 'assert-contains-no-value.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "What is 2+2?"
    assertions:
      - type: contains
`,
      );

      const result = await validateEvalFile(filePath);

      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings.some((e) => e.message.includes("'value'"))).toBe(true);
    });

    it('validates equals assertion has value field', async () => {
      const filePath = path.join(tempDir, 'assert-equals-no-value.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "What is 2+2?"
    assertions:
      - type: equals
`,
      );

      const result = await validateEvalFile(filePath);

      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings.some((e) => e.message.includes("'value'"))).toBe(true);
    });

    it('validates regex assertion has valid pattern', async () => {
      const filePath = path.join(tempDir, 'assert-regex-invalid.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "What is 2+2?"
    assertions:
      - type: regex
        value: "[invalid"
`,
      );

      const result = await validateEvalFile(filePath);

      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings.some((e) => e.message.includes('regex'))).toBe(true);
    });

    it('validates regex assertion has value field', async () => {
      const filePath = path.join(tempDir, 'assert-regex-no-value.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "What is 2+2?"
    assertions:
      - type: regex
`,
      );

      const result = await validateEvalFile(filePath);

      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings.some((e) => e.message.includes("'value'"))).toBe(true);
    });

    it('validates is-json needs no additional fields', async () => {
      const filePath = path.join(tempDir, 'assert-is-json.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "Return JSON"
    assertions:
      - type: is_json
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(true);
      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings).toHaveLength(0);
    });

    it('validates required field accepts boolean', async () => {
      const filePath = path.join(tempDir, 'assert-required-bool.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "What is 2+2?"
    assertions:
      - type: contains
        value: "4"
        required: true
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(true);
      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings).toHaveLength(0);
    });

    it('validates required field accepts number between 0 and 1', async () => {
      const filePath = path.join(tempDir, 'assert-required-number.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "What is 2+2?"
    assertions:
      - type: contains
        value: "4"
        required: 0.8
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(true);
      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings).toHaveLength(0);
    });

    it('warns on invalid required field type', async () => {
      const filePath = path.join(tempDir, 'assert-required-invalid.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "What is 2+2?"
    assertions:
      - type: contains
        value: "4"
        required: "yes"
`,
      );

      const result = await validateEvalFile(filePath);

      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings.some((e) => e.message.includes('required'))).toBe(true);
    });

    it('warns on required number out of range (0)', async () => {
      const filePath = path.join(tempDir, 'assert-required-zero.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "What is 2+2?"
    assertions:
      - type: contains
        value: "4"
        required: 0
`,
      );

      const result = await validateEvalFile(filePath);

      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings.some((e) => e.message.includes('required'))).toBe(true);
    });

    it('warns on required number out of range (> 1)', async () => {
      const filePath = path.join(tempDir, 'assert-required-over-one.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "What is 2+2?"
    assertions:
      - type: contains
        value: "4"
        required: 1.5
`,
      );

      const result = await validateEvalFile(filePath);

      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings.some((e) => e.message.includes('required'))).toBe(true);
    });

    it('warns when assertions is not an array', async () => {
      const filePath = path.join(tempDir, 'assert-not-array.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "What is 2+2?"
    assertions: "contains"
`,
      );

      const result = await validateEvalFile(filePath);

      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings.some((e) => e.message.includes('assertions'))).toBe(true);
    });

    it('accepts string shorthand in assertions array', async () => {
      const filePath = path.join(tempDir, 'assert-string-shorthand.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "Explain quicksort"
    assertions:
      - Mentions divide-and-conquer approach
      - Explains partition step
      - States time complexity correctly
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('warns on non-string non-object assertion items', async () => {
      const filePath = path.join(tempDir, 'assert-item-not-object.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "What is 2+2?"
    assertions:
      - 42
`,
      );

      const result = await validateEvalFile(filePath);

      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings.some((e) => e.message.includes('string or an object'))).toBe(true);
    });

    it('passes valid assertions array', async () => {
      const filePath = path.join(tempDir, 'assert-valid.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "Is this entity sanctioned?"
    assertions:
      - type: contains
        value: DENIED
      - type: is_json
      - type: regex
        value: "\\\\d+"
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(true);
      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings).toHaveLength(0);
    });
  });

  describe('metadata validation', () => {
    it('warns when name has invalid format', async () => {
      const filePath = path.join(tempDir, 'meta-invalid-name.yaml');
      await writeFile(
        filePath,
        `name: "Invalid Name!"
description: Some description
tests:
  - id: test-1
    input: "Query"
`,
      );

      const result = await validateEvalFile(filePath);

      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings.some((e) => e.message.includes('name'))).toBe(true);
    });

    it('passes valid metadata', async () => {
      const filePath = path.join(tempDir, 'meta-valid.yaml');
      await writeFile(
        filePath,
        `name: my-eval
description: A valid eval
tests:
  - id: test-1
    input: "Query"
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(true);
      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings).toHaveLength(0);
    });
  });

  describe('tests as string path', () => {
    it('validates tests string has valid extension', async () => {
      const filePath = path.join(tempDir, 'tests-bad-ext.yaml');
      await writeFile(
        filePath,
        `tests: "./cases.txt"
`,
      );

      const result = await validateEvalFile(filePath);

      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings.some((e) => e.message.includes('extension'))).toBe(true);
    });

    it('passes valid tests string path with .yaml extension', async () => {
      await writeFile(
        path.join(tempDir, 'cases.yaml'),
        `- id: test-1
  criteria: Goal
  input: "Query"
`,
      );

      const filePath = path.join(tempDir, 'tests-yaml-ext.yaml');
      await writeFile(
        filePath,
        `tests: "./cases.yaml"
`,
      );

      const result = await validateEvalFile(filePath);

      // Should be valid (no errors), possibly no warnings about extension
      expect(result.valid).toBe(true);
      const extWarnings = result.errors.filter(
        (e) => e.severity === 'warning' && e.message.includes('extension'),
      );
      expect(extWarnings).toHaveLength(0);
    });

    it('validates experiment workspace with tests string shorthand', async () => {
      await writeFile(
        path.join(tempDir, 'cases-shorthand-workspace.yaml'),
        `- id: test-1
  criteria: Goal
  input: "Query"
`,
      );

      const filePath = path.join(tempDir, 'tests-yaml-ext-experiment-workspace.yaml');
      await writeFile(
        filePath,
        `experiment:
  workspace:
    isolation: per_test
tests: "./cases-shorthand-workspace.yaml"
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (error) =>
            error.severity === 'error' &&
            error.location === 'experiment' &&
            error.message.includes("Top-level 'experiment' must be a string"),
        ),
      ).toBe(true);
    });

    it('passes valid tests string path with .yml extension', async () => {
      await writeFile(
        path.join(tempDir, 'cases.yml'),
        `- id: test-1
  criteria: Goal
  input: "Query"
`,
      );

      const filePath = path.join(tempDir, 'tests-yml-ext.yaml');
      await writeFile(
        filePath,
        `tests: "./cases.yml"
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(true);
      const extWarnings = result.errors.filter(
        (e) => e.severity === 'warning' && e.message.includes('extension'),
      );
      expect(extWarnings).toHaveLength(0);
    });

    it('passes valid tests string path with .jsonl extension', async () => {
      await writeFile(
        path.join(tempDir, 'cases.jsonl'),
        `{"id":"test-1","criteria":"Goal","input":"Query"}\n`,
      );

      const filePath = path.join(tempDir, 'tests-jsonl-ext.yaml');
      await writeFile(
        filePath,
        `tests: "./cases.jsonl"
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(true);
      const extWarnings = result.errors.filter(
        (e) => e.severity === 'warning' && e.message.includes('extension'),
      );
      expect(extWarnings).toHaveLength(0);
    });
  });

  describe('suite-level input validation', () => {
    it('validates suite-level input as string', async () => {
      const filePath = path.join(tempDir, 'suite-input-string.yaml');
      await writeFile(
        filePath,
        `input: "Shared context"
tests:
  - id: test-1
    criteria: Goal
    input: "Query"
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('validates suite-level input as message array', async () => {
      const filePath = path.join(tempDir, 'suite-input-array.yaml');
      await writeFile(
        filePath,
        `input:
  - role: system
    content: "You are a helpful assistant."
  - role: user
    content: "Context message"
tests:
  - id: test-1
    criteria: Goal
    input: "Query"
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects suite-level input with invalid type', async () => {
      const filePath = path.join(tempDir, 'suite-input-invalid.yaml');
      await writeFile(
        filePath,
        `input: 123
tests:
  - id: test-1
    criteria: Goal
    input: "Query"
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("suite-level 'input'"))).toBe(true);
    });
  });

  describe('workspace repo validation', () => {
    it('errors when legacy source is set', async () => {
      const filePath = path.join(tempDir, 'workspace-legacy-source-error.yaml');
      await writeFile(
        filePath,
        `workspace:
  repos:
    - path: ./repo
      source:
        type: git
        url: https://github.com/org/repo.git
tests:
  - id: test-1
    criteria: Goal
    input: "Query"
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.severity === 'error' &&
            e.message.includes('workspace.repos[].source has been removed'),
        ),
      ).toBe(true);
    });

    it('errors when legacy checkout is set in a per-case workspace', async () => {
      const filePath = path.join(tempDir, 'workspace-legacy-checkout-error.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    criteria: Goal
    input: "Query"
    workspace:
      repos:
        - path: ./repo
          repo: https://github.com/org/repo.git
          checkout:
            ref: main
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.severity === 'error' &&
            e.message.includes('workspace.repos[].checkout has been removed'),
        ),
      ).toBe(true);
    });

    it('errors when legacy clone is set', async () => {
      const filePath = path.join(tempDir, 'workspace-legacy-clone-error.yaml');
      await writeFile(
        filePath,
        `workspace:
  repos:
    - path: ./repo
      repo: https://github.com/org/repo.git
      clone:
        depth: 1
tests:
  - id: test-1
    criteria: Goal
    input: "Query"
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.severity === 'error' &&
            e.message.includes('workspace.repos[].clone has been removed'),
        ),
      ).toBe(true);
    });

    it('errors when non-Docker repo omits repo identity', async () => {
      const filePath = path.join(tempDir, 'workspace-missing-repo-error.yaml');
      await writeFile(
        filePath,
        `workspace:
  repos:
    - path: ./repo
      commit: main
tests:
  - id: test-1
    criteria: Goal
    input: "Query"
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.severity === 'error' && e.message.includes('repos[].repo is required for non-Docker'),
        ),
      ).toBe(true);
    });

    it('allows Docker repo hints without repo identity', async () => {
      const filePath = path.join(tempDir, 'workspace-docker-repo-hint.yaml');
      await writeFile(
        filePath,
        `workspace:
  docker:
    image: swebench/sweb.eval.django__django:latest
  repos:
    - path: /testbed
      base_commit: abc123
tests:
  - id: test-1
    criteria: Goal
    input: "Query"
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(true);
      expect(result.errors.filter((e) => e.severity === 'error')).toHaveLength(0);
    });

    it('errors when commit aliases conflict', async () => {
      const filePath = path.join(tempDir, 'workspace-conflicting-commits.yaml');
      await writeFile(
        filePath,
        `workspace:
  repos:
    - path: ./repo
      repo: https://github.com/org/repo.git
      commit: abc
      base_commit: def
tests:
  - id: test-1
    criteria: Goal
    input: "Query"
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) => e.severity === 'error' && e.message.includes('commit and repos[].base_commit'),
        ),
      ).toBe(true);
    });

    it('errors when an external workspace file uses legacy source', async () => {
      const workspaceFile = path.join(tempDir, 'external-workspace.yaml');
      await writeFile(
        workspaceFile,
        `repos:
  - path: ./repo
    source:
      type: git
      url: https://github.com/org/repo.git
`,
      );

      const filePath = path.join(tempDir, 'workspace-legacy-source-external-error.yaml');
      await writeFile(
        filePath,
        `workspace: ./external-workspace.yaml
tests:
  - id: test-1
    criteria: Goal
    input: "Query"
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.filePath === workspaceFile &&
            e.severity === 'error' &&
            e.message.includes('workspace.repos[].source has been removed'),
        ),
      ).toBe(true);
    });

    it('rejects a missing external workspace file', async () => {
      const filePath = path.join(tempDir, 'workspace-missing-external.yaml');
      await writeFile(
        filePath,
        `workspace: ./does-not-exist.yaml
tests:
  - id: test-1
    criteria: Goal
    input: "Query"
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.severity === 'error' && e.message.includes('Failed to load external workspace file'),
        ),
      ).toBe(true);
    });
  });

  describe('unknown field detection', () => {
    it('warns on unknown test-level fields', async () => {
      const filePath = path.join(tempDir, 'unknown-test-field.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "Hello"
    criteria: Some criteria
    asserts:
      - type: contains
        value: "hello"
`,
      );

      const result = await validateEvalFile(filePath);

      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings.some((e) => e.message.includes("Unknown field 'asserts'"))).toBe(true);
    });

    it('warns on unknown top-level fields', async () => {
      const filePath = path.join(tempDir, 'unknown-top-field.yaml');
      await writeFile(
        filePath,
        `description: Test eval
provider: openai
tests:
  - id: test-1
    input: "Hello"
`,
      );

      const result = await validateEvalFile(filePath);

      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings.some((e) => e.message.includes("Unknown field 'provider'"))).toBe(true);
    });

    it('does not warn on known test-level fields', async () => {
      const filePath = path.join(tempDir, 'known-test-fields.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "Hello"
    criteria: Some criteria
    expected_output: "World"
    assertions:
      - type: contains
        value: "world"
    metadata:
      tag: test
`,
      );

      const result = await validateEvalFile(filePath);

      const unknownWarnings = result.errors.filter(
        (e) => e.severity === 'warning' && e.message.includes('Unknown field'),
      );
      expect(unknownWarnings).toHaveLength(0);
    });

    it('does not warn on known top-level fields', async () => {
      const filePath = path.join(tempDir, 'known-top-fields.yaml');
      await writeFile(
        filePath,
        `name: my-eval
description: A test
version: "1.0"
target: my-target
tests:
  - id: test-1
    input: "Hello"
`,
      );

      const result = await validateEvalFile(filePath);

      const unknownWarnings = result.errors.filter(
        (e) => e.severity === 'warning' && e.message.includes('Unknown field'),
      );
      expect(unknownWarnings).toHaveLength(0);
    });

    it('warns on multiple unknown fields in one test', async () => {
      const filePath = path.join(tempDir, 'multiple-unknown-fields.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "Hello"
    foo: bar
    baz: qux
`,
      );

      const result = await validateEvalFile(filePath);

      const unknownWarnings = result.errors.filter(
        (e) => e.severity === 'warning' && e.message.includes('Unknown field'),
      );
      expect(unknownWarnings).toHaveLength(2);
      expect(unknownWarnings.some((e) => e.message.includes("'foo'"))).toBe(true);
      expect(unknownWarnings.some((e) => e.message.includes("'baz'"))).toBe(true);
    });
  });

  describe('removed legacy fields', () => {
    it('warns on expected_outcome as deprecated field', async () => {
      const filePath = path.join(tempDir, 'expected-outcome-deprecated.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    expected_outcome: Goal
    input:
      - role: user
        content: Query
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(true);
      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(
        warnings.some(
          (e) =>
            e.message.includes("'expected_outcome' is deprecated") &&
            e.message.includes("'criteria'"),
        ),
      ).toBe(true);
    });

    it('errors on removed assertion field at test level', async () => {
      const removedKey = ['ass', 'ert'].join('');
      const filePath = path.join(tempDir, 'removed-test-field.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "Hello"
    ${removedKey}:
      - type: contains
        value: "hello"
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(false);
      const errors = result.errors.filter((e) => e.severity === 'error');
      expect(
        errors.some(
          (e) =>
            e.message.includes("'assert' has been removed") && e.message.includes("'assertions'"),
        ),
      ).toBe(true);
    });

    it('errors on removed assertion field at top level', async () => {
      const removedKey = ['ass', 'ert'].join('');
      const filePath = path.join(tempDir, 'removed-top-field.yaml');
      await writeFile(
        filePath,
        `${removedKey}:
  - type: contains
    value: "hello"
tests:
  - id: test-1
    input: "Hello"
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(false);
      const errors = result.errors.filter((e) => e.severity === 'error');
      expect(
        errors.some(
          (e) =>
            e.message.includes("'assert' has been removed") && e.message.includes("'assertions'"),
        ),
      ).toBe(true);
    });
  });
});
