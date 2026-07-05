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

  it('rejects eval file with authored test input', async () => {
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

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        location: 'tests[0].input',
        message: expect.stringContaining('tests[].input has been removed'),
      }),
    );
  });

  it('rejects test-level criteria combined with explicit assert entries', async () => {
    const filePath = path.join(tempDir, 'criteria-with-assert.yaml');
    await writeFile(
      filePath,
      `prompts:
  - "{{ prompt }}"
tests:
  - id: mixed
    vars:
      prompt: "Hello"
    criteria: Response echoes the input
    assert:
      - type: contains
        value: hello
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        location: 'tests[0].criteria',
        message: expect.stringContaining("Do not combine test-level 'criteria' with 'assert'"),
      }),
    );
    expect(result.errors[0].message).toContain('tests[].description');
    expect(result.errors[0].message).toContain('type:');
    expect(result.errors[0].message).toContain('llm-rubric');
  });

  it('accepts test-level description combined with explicit assert entries', async () => {
    const filePath = path.join(tempDir, 'description-with-assert.yaml');
    await writeFile(
      filePath,
      `prompts:
  - "{{ prompt }}"
tests:
  - id: described
    description: Human-facing case label
    vars:
      prompt: "Hello"
    assert:
      - type: contains
        value: hello
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validates top-level target and run controls with field-local tests', async () => {
    const filePath = path.join(tempDir, 'run-controls-field-local-tests.yaml');
    await writeFile(
      filePath,
      `name: direct-suite
prompts:
  - "{{ prompt }}"
target: codex
threshold: 0.8
evaluate_options:
  budget_usd: 2
  max_concurrency: 3
  repeat:
    count: 2
    strategy: pass_any
    early_exit: true
tests:
  - id: local-case
    vars:
      prompt: "Hello"
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects invalid evaluate_options.max_concurrency', async () => {
    const filePath = path.join(tempDir, 'invalid-max-concurrency.yaml');
    await writeFile(
      filePath,
      `target: codex
evaluate_options:
  max_concurrency: 0
tests:
  - id: local-case
    input: "Hello"
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) =>
          error.location === 'evaluate_options.max_concurrency' &&
          error.message.includes('integer between 1 and 50'),
      ),
    ).toBe(true);
  });

  it('rejects authored execution.max_concurrency in eval YAML', async () => {
    const filePath = path.join(tempDir, 'composable-eval-graph.yaml');
    await writeFile(
      filePath,
      `targets:
  - id: codex-local
    provider: codex-app-server
    runtime: host
    config:
      command: ["codex", "app-server"]
graders:
  - id: openai-grader
    provider: openai
    config:
      model: gpt-5-mini
defaults:
  target: codex-local
  grader: openai-grader
execution:
  max_concurrency: 3
tests:
  - id: local-case
    input: "Hello"
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        location: 'execution.max_concurrency',
        message: expect.stringContaining('evaluate_options.max_concurrency'),
      }),
    );
  });

  it('rejects removed top-level execution fields in eval YAML', async () => {
    const filePath = path.join(tempDir, 'invalid-composable-execution.yaml');
    await writeFile(
      filePath,
      `execution:
  target: claude
  workers: 4
  max_concurrency: 3
tests:
  - id: local-case
    input: "Hello"
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        location: 'execution.target',
      }),
    );
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        location: 'execution.workers',
        message: expect.stringContaining('evaluate_options.max_concurrency'),
      }),
    );
  });

  it('rejects removed preprocessor and postprocess authored fields', async () => {
    const filePath = path.join(tempDir, 'removed-transform-fields.yaml');
    await writeFile(
      filePath,
      `preprocessors:
  - type: xlsx
    command: ["node", "xlsx.js"]
prompts:
  - "{{ input }}"
default_test:
  options:
    postprocess: output.trim()
tests:
  - id: local-case
    vars:
      input: "Hello"
    options:
      postprocess: output.trim()
    assert:
      - type: llm-rubric
        value: "Good"
        postprocess: output.trim()
      - type: llm-rubric
        value: "Also good"
        preprocessors:
          - type: xlsx
            command: ["node", "xlsx.js"]
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        location: 'preprocessors',
        message: expect.stringContaining('default_test.options.transform'),
      }),
    );
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        location: 'default_test.options.postprocess',
        message: expect.stringContaining('default_test.options.transform'),
      }),
    );
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        location: 'tests[0].options.postprocess',
        message: expect.stringContaining('tests[0].options.transform'),
      }),
    );
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        location: 'tests[0].assert[0].postprocess',
        message: expect.stringContaining('tests[0].assert[0].transform'),
      }),
    );
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        location: 'tests[0].assert[1].preprocessors',
        message: expect.stringContaining('tests[0].assert[1].transform'),
      }),
    );
  });

  it('validates default_test.threshold', async () => {
    const filePath = path.join(tempDir, 'default-test-threshold.yaml');
    await writeFile(
      filePath,
      `prompts:
  - "{{ prompt }}"
default_test:
  threshold: 0.6
tests:
  - id: test-1
    criteria: Goal
    vars:
      prompt: Query
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects default_test.assertions in favor of default_test.assert', async () => {
    const filePath = path.join(tempDir, 'default-test-assertions.yaml');
    await writeFile(
      filePath,
      `default_test:
  assertions:
    - type: contains
      value: ok
tests:
  - id: test-1
    criteria: Goal
    input: Query
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ severity: 'error', location: 'default_test.assertions' }),
    );
  });

  it('validates string default_test references', async () => {
    const filePath = path.join(tempDir, 'default-test-reference.yaml');
    await writeFile(
      filePath,
      `prompts:
  - "{{ prompt }}"
default_test: file://.agentv/default-test.yaml
tests:
  - id: test-1
    criteria: Goal
    vars:
      prompt: Query
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validates ref default_test references', async () => {
    const filePath = path.join(tempDir, 'default-test-ref-reference.yaml');
    await writeFile(
      filePath,
      `prompts:
  - "{{ prompt }}"
default_test: ref://global-default
tests:
  - id: test-1
    criteria: Goal
    vars:
      prompt: Query
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects bare default_test reference names', async () => {
    const filePath = path.join(tempDir, 'default-test-bare-reference.yaml');
    await writeFile(
      filePath,
      `default_test: global-default
tests:
  - id: test-1
    criteria: Goal
    input: Query
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ severity: 'error', location: 'default_test' }),
    );
  });

  it('rejects invalid default_test threshold values and unsupported default fields', async () => {
    const filePath = path.join(tempDir, 'invalid-default-test-threshold.yaml');
    await writeFile(
      filePath,
      `default_test:
  threshold: 1.2
  unsupported: true
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
        (error) => error.severity === 'error' && error.location === 'default_test.unsupported',
      ),
    ).toBe(true);
  });

  it('validates promptfoo-shaped assert, default_test, and evaluate_options fields', async () => {
    const filePath = path.join(tempDir, 'promptfoo-shaped.yaml');
    await writeFile(
      filePath,
      `description: Promptfoo-compatible shape
tags:
  suite: smoke
prompts:
  - raw: "Review {{ vars.diff }}"
targets:
  - id: local-agent
    provider: codex-cli
    command: ["codex"]
default_test:
  vars:
    tone: concise
  assert:
    - Mentions the main risk
  options:
    disable_default_asserts: true
  threshold: 0.7
evaluate_options:
  cache: true
  delay: 100
  generate_suggestions: false
  repeat: 2
  timeout_ms: 30000
  max_eval_time_ms: 120000
  filter_range: [0, 10]
tests:
  - description: fixed output row
    vars:
      diff: change
    options:
      repeat:
        count: 3
        strategy: mean
    provider_output: "Looks safe."
    assert:
      - type: contains
        value: safe
        metric: safety_text
      - type: llm-rubric
        value:
          - Identifies user impact
          - Avoids unsupported claims
scenarios:
  - description: severity variants
    config:
      - vars:
          severity: high
    tests:
      - vars:
          diff: critical fix
        assert:
          - type: llm-rubric
            value: Flags the risk clearly
derived_metrics:
  - name: weighted_quality
    value: safety_text * 0.5
output_path: results.json
env:
  EVAL_MODE: local
nunjucks_filters:
  slug: ./filters/slug.ts
extensions:
  - agentv:agent-rules
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects top-level providers as a live alias for targets', async () => {
    const filePath = path.join(tempDir, 'top-level-providers.yaml');
    await writeFile(
      filePath,
      `prompts:
  - raw: Hello {{ vars.name }}
providers:
  - openai:gpt-5.4-mini
tests:
  - vars:
      name: Ada
    assert:
      - type: contains
        value: Hello
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) =>
          error.severity === 'error' &&
          error.location === 'providers' &&
          error.message.includes("Top-level 'providers' is not a runtime alias"),
      ),
    ).toBe(true);
  });

  it('rejects removed top-level repeat controls with migration guidance', async () => {
    const filePath = path.join(tempDir, 'removed-repeat-fields.yaml');
    await writeFile(
      filePath,
      `target: codex
repeat:
  count: 2
runs: 2
early_exit: true
tests:
  - id: local-case
    input: "Hello"
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some((error) => error.message.includes('Use evaluate_options.repeat')),
    ).toBe(true);
    expect(
      result.errors.some((error) => error.message.includes('Use evaluate_options.repeat.count')),
    ).toBe(true);
    expect(
      result.errors.some((error) =>
        error.message.includes('Use evaluate_options.repeat.early_exit'),
      ),
    ).toBe(true);
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
          error.message.includes('legacy tests[].include suite entries') &&
          error.message.includes('Run eval files directly') &&
          error.message.includes('tests: file://...'),
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
          error.message.includes('legacy tests[].include suite entries') &&
          error.message.includes('Run eval files directly') &&
          error.message.includes('tests: file://...'),
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
          error.message.includes('legacy tests[].include suite imports') &&
          error.message.includes('CLI multi-file selection') &&
          error.message.includes('tags'),
      ),
    ).toBe(true);
  });

  it('warns when legacy raw suite includes drop eval suite context', async () => {
    await writeFile(
      path.join(tempDir, 'composition-child-tests-import.eval.yaml'),
      `environment:
  type: host
  workdir: ./child-workspace
input: child suite input
assert:
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
      `environment:
  type: host
  workdir: ./parent-workspace
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
          error.message.includes('Legacy tests[].include with type: tests') &&
          error.message.includes('drops suite context'),
      ),
    ).toBe(true);
  });

  it('rejects top-level imports', async () => {
    const filePath = path.join(tempDir, 'top-level-imports.eval.yaml');
    await writeFile(
      filePath,
      `imports:
  tests:
    - path: ./missing-cases.yaml
tests: []
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(false);
    const importsError = result.errors.find(
      (error) => error.severity === 'error' && error.location === 'imports',
    );
    expect(importsError?.message).toContain("Top-level 'imports' is not supported");
    expect(importsError?.message).toContain('Run eval files directly');
    expect(importsError?.message).toContain('tests: file://...');
    expect(importsError?.message).toContain('prompts: file://...');
    expect(importsError?.message).toContain('default_test: file://...');
    expect(importsError?.message).toContain('environment: file://...');
    expect(importsError?.message).toContain('tags');
    expect(importsError?.message).toContain('CLI multi-file selection');
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
          error.location === 'execution.target' &&
          error.message.includes("Unsupported execution field 'target'"),
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

  it('rejects suite-level input block shorthand', async () => {
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

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        location: 'input',
        message: expect.stringContaining("Top-level 'input' has been removed"),
      }),
    );
  });

  it('rejects suite-level structured object input shorthand', async () => {
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

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        location: 'input',
        message: expect.stringContaining("Top-level 'input' has been removed"),
      }),
    );
  });

  it('rejects suite-level single-message input object', async () => {
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

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        location: 'input',
        message: expect.stringContaining("Top-level 'input' has been removed"),
      }),
    );
  });

  it('rejects suite-level object input before validating direct-input shape', async () => {
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
    expect(result.errors.some((error) => error.location === 'input')).toBe(true);
  });

  it('rejects test-level structured object input shorthand', async () => {
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

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        location: 'tests[0].input',
        message: expect.stringContaining('tests[].input has been removed'),
      }),
    );
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
    expect(result.errors.some((error) => error.location === 'tests[0].input')).toBe(true);
  });

  it('rejects eval file with test-level message-array input', async () => {
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

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        location: 'tests[0].input',
        message: expect.stringContaining('tests[].input has been removed'),
      }),
    );
  });

  it('rejects eval file with test-level expected_output', async () => {
    const filePath = path.join(tempDir, 'output-string.yaml');
    await writeFile(
      filePath,
      `prompts:
  - "{{ prompt }}"
tests:
  - id: test-1
    criteria: Goal
    vars:
      prompt: Query
    expected_output: "The answer is 4"
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        location: 'tests[0].expected_output',
        message: expect.stringContaining('tests[].expected_output has been removed'),
      }),
    );
  });

  it('rejects eval file with default_test expected_output', async () => {
    const filePath = path.join(tempDir, 'output-object.yaml');
    await writeFile(
      filePath,
      `default_test:
  expected_output: Shared reference
prompts:
  - "{{ prompt }}"
tests:
  - id: test-1
    vars:
      prompt: Query
    assert:
      - type: llm-rubric
        value: "Matches the reference answer: {{ expected_output }}"
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        location: 'default_test.expected_output',
        message: expect.stringContaining('default_test.expected_output has been removed'),
      }),
    );
  });

  it('validates vars.expected_output when an explicit assertion consumes it', async () => {
    const filePath = path.join(tempDir, 'vars-expected-output.yaml');
    await writeFile(
      filePath,
      `default_test:
  assert:
    - type: llm-rubric
      value: "Matches the reference answer: {{ expected_output }}"
prompts:
  - "{{ prompt }}"
tests:
  - id: test-1
    vars:
      prompt: Query
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
      `prompts:
  - "{{ prompt }}"
tests:
  - id: finance-summary
    vars:
      prompt: Summarize the finance note
    assert:
      - type: llm-rubric
        value:
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
    expect(result.errors.some((e) => e.message.includes('Missing prompt input'))).toBe(true);
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
    expect(result.errors.some((e) => e.message.includes('tests[].input has been removed'))).toBe(
      true,
    );
  });

  it('validates chat message prompt array with vars', async () => {
    const filePath = path.join(tempDir, 'input-messages.yaml');
    await writeFile(
      filePath,
      `prompts:
  - - role: system
      content: Be helpful
    - role: user
      content: "{{ prompt }}"
tests:
  - id: test-1
    criteria: Goal
    vars:
      prompt: Hello
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
      `prompts:
  - "Question: {{ question }}"
tests:
  - id: test-1
    vars:
      question: "What is 2+2?"
      expected:
        answer: "4"
    criteria: "Answers {{question}} correctly"
`,
    );

    const result = await validateEvalFile(filePath);

    expect(result.valid).toBe(true);
    const warnings = result.errors.filter((e) => e.severity === 'warning');
    expect(warnings).toHaveLength(0);
  });

  describe('assert field validation', () => {
    it('validates assert array items have type field', async () => {
      const filePath = path.join(tempDir, 'assert-missing-type.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "What is 2+2?"
    assert:
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
    assert:
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
    assert:
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
    assert:
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
    assert:
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
    assert:
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
        `prompts:
  - "{{ prompt }}"
tests:
  - id: test-1
    vars:
      prompt: "Return JSON"
    assert:
      - type: is-json
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(true);
      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings).toHaveLength(0);
    });

    it('rejects composite with assert-set migration guidance', async () => {
      const filePath = path.join(tempDir, 'assert-composite-removed.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "Return JSON"
    assert:
      - type: composite
        assert:
          - type: contains
            value: ok
        aggregator:
          type: weighted_average
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.severity === 'error' &&
            e.message === "Unsupported assertion type 'composite'. Use 'assert-set' instead.",
        ),
      ).toBe(true);
    });

    it('rejects known unsupported promptfoo trajectory assertions', async () => {
      const filePath = path.join(tempDir, 'assert-trajectory-unsupported.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "Use tools"
    assert:
      - type: trajectory:tool-sequence
        value:
          - search
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.severity === 'error' &&
            e.message.includes("Unsupported promptfoo assertion type 'trajectory:tool-sequence'"),
        ),
      ).toBe(true);
    });

    it('validates required field accepts boolean', async () => {
      const filePath = path.join(tempDir, 'assert-required-bool.yaml');
      await writeFile(
        filePath,
        `prompts:
  - "{{ prompt }}"
tests:
  - id: test-1
    vars:
      prompt: "What is 2+2?"
    assert:
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

    it('warns when required field is numeric', async () => {
      const filePath = path.join(tempDir, 'assert-required-number.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "What is 2+2?"
    assert:
      - type: contains
        value: "4"
        required: 0.8
`,
      );

      const result = await validateEvalFile(filePath);

      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings.some((e) => e.message.includes("Numeric 'required: 0.8'"))).toBe(true);
    });

    it('warns on invalid required field type', async () => {
      const filePath = path.join(tempDir, 'assert-required-invalid.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "What is 2+2?"
    assert:
      - type: contains
        value: "4"
        required: "yes"
`,
      );

      const result = await validateEvalFile(filePath);

      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings.some((e) => e.message.includes('required'))).toBe(true);
    });

    it('warns on removed required number 0', async () => {
      const filePath = path.join(tempDir, 'assert-required-zero.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "What is 2+2?"
    assert:
      - type: contains
        value: "4"
        required: 0
`,
      );

      const result = await validateEvalFile(filePath);

      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings.some((e) => e.message.includes("Numeric 'required: 0'"))).toBe(true);
    });

    it('warns on removed required number greater than 1', async () => {
      const filePath = path.join(tempDir, 'assert-required-over-one.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "What is 2+2?"
    assert:
      - type: contains
        value: "4"
        required: 1.5
`,
      );

      const result = await validateEvalFile(filePath);

      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings.some((e) => e.message.includes("Numeric 'required: 1.5'"))).toBe(true);
    });

    it('warns when assert is not an array', async () => {
      const filePath = path.join(tempDir, 'assert-not-array.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "What is 2+2?"
    assert: "contains"
`,
      );

      const result = await validateEvalFile(filePath);

      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings.some((e) => e.message.includes('assert'))).toBe(true);
    });

    it('accepts string shorthand in assert array', async () => {
      const filePath = path.join(tempDir, 'assert-string-shorthand.yaml');
      await writeFile(
        filePath,
        `prompts:
  - "{{ prompt }}"
tests:
  - id: test-1
    vars:
      prompt: "Explain quicksort"
    assert:
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
    assert:
      - 42
`,
      );

      const result = await validateEvalFile(filePath);

      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(warnings.some((e) => e.message.includes('string or an object'))).toBe(true);
    });

    it('passes valid assert array', async () => {
      const filePath = path.join(tempDir, 'assert-valid.yaml');
      await writeFile(
        filePath,
        `prompts:
  - "{{ prompt }}"
tests:
  - id: test-1
    vars:
      prompt: "Is this entity sanctioned?"
    assert:
      - type: contains
        value: DENIED
      - type: is-json
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
prompts:
  - "{{ prompt }}"
tests:
  - id: test-1
    vars:
      prompt: "Query"
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

    it('passes dataset loader extensions without unsupported-extension warnings', async () => {
      const files = {
        'cases.csv': 'id,input,__expected\ncsv-1,Hello,contains:Hi\n',
        'cases.json': '[{"id":"json-1","criteria":"Goal","input":"Query"}]\n',
        'cases.mjs': 'export function createTests() { return []; }\n',
        'cases.py': 'def create_tests():\n    return []\n',
      };
      for (const [filename, content] of Object.entries(files)) {
        await writeFile(path.join(tempDir, filename), content);
      }

      const filePath = path.join(tempDir, 'tests-dataset-extensions.yaml');
      await writeFile(
        filePath,
        `prompts:
  - "{{ prompt }}"
tests:
  - file://cases.csv
  - cases.json
  - cases.mjs:createTests
  - cases.py:create_tests
  - id: inline
    criteria: Goal
    vars:
      prompt: Query
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(true);
      const extWarnings = result.errors.filter(
        (error) => error.severity === 'warning' && error.message.includes('extension'),
      );
      expect(extWarnings).toHaveLength(0);
    });

    it('passes promptfoo CSV rows rendered through top-level prompts and vars', async () => {
      await writeFile(
        path.join(tempDir, 'suite-input-cases.csv'),
        'id,topic,__expected\ncase,refund,contains:refund\n',
      );

      const filePath = path.join(tempDir, 'suite-input-csv.yaml');
      await writeFile(
        filePath,
        `prompts:
  - Answer about {{ topic }}
tests: file://suite-input-cases.csv
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects unsupported promptfoo CSV expected DSL forms during validation', async () => {
      await writeFile(
        path.join(tempDir, 'unsupported-expected-cases.csv'),
        'id,input,__expected\ncase,Hello,similar:hello\n',
      );

      const filePath = path.join(tempDir, 'unsupported-expected-csv.yaml');
      await writeFile(
        filePath,
        `tests: file://unsupported-expected-cases.csv
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          location: 'tests',
          message: expect.stringContaining('Unsupported promptfoo __expected assertion "similar"'),
        }),
      );
    });
  });

  describe('suite-level input validation', () => {
    it('rejects suite-level input as string', async () => {
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

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          location: 'input',
          message: expect.stringContaining("Top-level 'input' has been removed"),
        }),
      );
    });

    it('rejects suite-level input as message array', async () => {
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

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          location: 'input',
          message: expect.stringContaining("Top-level 'input' has been removed"),
        }),
      );
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
      expect(
        result.errors.some((e) => e.message.includes("Top-level 'input' has been removed")),
      ).toBe(true);
    });
  });

  describe('environment recipe validation and workspace hard-deprecation', () => {
    it('errors when public suite workspace repos are authored', async () => {
      const filePath = path.join(tempDir, 'workspace-repos-error.yaml');
      await writeFile(
        filePath,
        `workspace:
  repos:
    - path: ./repo
      repo: https://github.com/org/repo.git
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
            e.message.includes('workspace.repos has been removed from public eval YAML'),
        ),
      ).toBe(true);
    });

    it('errors when public per-case workspace repos are authored', async () => {
      const filePath = path.join(tempDir, 'case-workspace-repos-error.yaml');
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
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.severity === 'error' &&
            e.message.includes('workspace.repos has been removed from public eval YAML'),
        ),
      ).toBe(true);
    });

    it('accepts host environment setup argv with cwd and timeout', async () => {
      const filePath = path.join(tempDir, 'environment-host.yaml');
      await writeFile(
        filePath,
        `prompts:
  - "{{ prompt }}"
environment:
  type: host
  workdir: ./repo
  setup:
    command: ["bash", "-lc", "bun install && bun run build"]
    cwd: "."
    timeout_ms: 120000
tests:
  - id: test-1
    criteria: Goal
    vars:
      prompt: "Query"
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(true);
      expect(result.errors.filter((e) => e.severity === 'error')).toHaveLength(0);
    });

    it('errors when environment setup args are authored', async () => {
      const filePath = path.join(tempDir, 'environment-docker.yaml');
      await writeFile(
        filePath,
        `prompts:
  - "{{ prompt }}"
environment:
  type: docker
  image: swebench/sweb.eval.django__django:latest
  workdir: /testbed
  setup:
    command: ["bash", "./setup.sh"]
    args:
      commit: abc123
tests:
  - id: test-1
    criteria: Goal
    vars:
      prompt: "Query"
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes('environment.setup.args is not supported')),
      ).toBe(true);
    });

    it('errors when environment setup command is a string', async () => {
      const filePath = path.join(tempDir, 'environment-string-command.yaml');
      await writeFile(
        filePath,
        `prompts:
  - "{{ prompt }}"
environment:
  type: host
  workdir: ./repo
  setup:
    command: ./setup.sh
tests:
  - id: test-1
    criteria: Goal
    vars:
      prompt: "Query"
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) =>
          e.message.includes('environment.setup.command must be a non-empty string array'),
        ),
      ).toBe(true);
    });

    it('errors when Docker environment omits both image and context', async () => {
      const filePath = path.join(tempDir, 'environment-docker-missing-source.yaml');
      await writeFile(
        filePath,
        `environment:
  type: docker
  workdir: /testbed
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
            e.location === 'environment' &&
            e.message.includes("docker recipes must define either 'image' or 'context'"),
        ),
      ).toBe(true);
    });

    it('errors when an external environment file wraps the recipe', async () => {
      const environmentFile = path.join(tempDir, 'external-environment.yaml');
      await writeFile(
        environmentFile,
        `environment:
  type: host
  workdir: ./repo
`,
      );

      const filePath = path.join(tempDir, 'environment-wrapped-external-error.yaml');
      await writeFile(
        filePath,
        `environment: file://external-environment.yaml
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
            e.message.includes('must contain the environment recipe directly'),
        ),
      ).toBe(true);
    });

    it('rejects a missing external environment file', async () => {
      const filePath = path.join(tempDir, 'environment-missing-external.yaml');
      await writeFile(
        filePath,
        `environment: file://does-not-exist.yaml
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
            e.message.includes('environment recipe file not found or unreadable'),
        ),
      ).toBe(true);
    });
  });

  describe('unknown field detection', () => {
    it('errors on unknown test-level fields', async () => {
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

      const errors = result.errors.filter((e) => e.severity === 'error');
      expect(errors.some((e) => e.message.includes("Unknown test field 'asserts'"))).toBe(true);
    });

    it('errors on unknown top-level fields', async () => {
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

      const errors = result.errors.filter((e) => e.severity === 'error');
      expect(errors.some((e) => e.message.includes("Unknown top-level field 'provider'"))).toBe(
        true,
      );
    });

    it('does not warn on known test-level fields', async () => {
      const filePath = path.join(tempDir, 'known-test-fields.yaml');
      await writeFile(
        filePath,
        `tests:
  - id: test-1
    input: "Hello"
    criteria: Some criteria
    vars:
      expected_output: "World"
    assert:
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

    it('errors on multiple unknown fields in one test', async () => {
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

      const unknownErrors = result.errors.filter(
        (e) => e.severity === 'error' && e.message.includes('Unknown test field'),
      );
      expect(unknownErrors).toHaveLength(2);
      expect(unknownErrors.some((e) => e.message.includes("'foo'"))).toBe(true);
      expect(unknownErrors.some((e) => e.message.includes("'baz'"))).toBe(true);
    });
  });

  describe('removed legacy fields', () => {
    it('warns on expected_outcome as deprecated field', async () => {
      const filePath = path.join(tempDir, 'expected-outcome-deprecated.yaml');
      await writeFile(
        filePath,
        `prompts:
  - - role: user
      content: "{{ prompt }}"
tests:
  - id: test-1
    expected_outcome: Goal
    vars:
      prompt: Query
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(true);
      const warnings = result.errors.filter((e) => e.severity === 'warning');
      expect(
        warnings.some(
          (e) =>
            e.message.includes("'expected_outcome' is deprecated") &&
            e.message.includes("'assert'"),
        ),
      ).toBe(true);
    });

    it('accepts canonical assert field at test level', async () => {
      const filePath = path.join(tempDir, 'test-level-assert.yaml');
      await writeFile(
        filePath,
        `prompts:
  - "{{ prompt }}"
tests:
  - id: test-1
    vars:
      prompt: "Hello"
    assert:
      - type: contains
        value: "hello"
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('accepts canonical assert field at top level', async () => {
      const filePath = path.join(tempDir, 'top-level-assert.yaml');
      await writeFile(
        filePath,
        `prompts:
  - "{{ prompt }}"
assert:
  - type: contains
    value: "hello"
tests:
  - id: test-1
    vars:
      prompt: "Hello"
`,
      );

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});
