import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { validateEvalFile } from '../../src/evaluation/validation/eval-validator.js';
import { loadTestSuite } from '../../src/evaluation/yaml-parser.js';

describe('eval.yaml flat runtime controls and tests imports', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentv-inline-experiment-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('parses evaluate_options.repeat object as the canonical runtime block', async () => {
    const evalPath = path.join(tempDir, 'runtime.eval.yaml');
    await writeFile(
      evalPath,
      [
        'name: runtime-suite',
        'experiment: release-gate',
        'target:',
        '  extends: codex',
        '  model: gpt-5.1',
        '  reasoning_effort: high',
        'threshold: 0.7',
        'evaluate_options:',
        '  repeat:',
        '    count: 2',
        '    strategy: pass_any',
        '    early_exit: true',
        '  budget_usd: 1.5',
        'timeout_seconds: 30',
        'tests:',
        '  - id: one',
        '    input: hello',
        '    criteria: ok',
        '',
      ].join('\n'),
    );

    const suite = await loadTestSuite(evalPath, tempDir);

    expect(suite.experimentConfig).toMatchObject({
      target: 'codex',
      name: 'release-gate',
      threshold: 0.7,
      repeat: { count: 2, strategy: 'pass_any', earlyExit: true },
      timeoutSeconds: 30,
      budgetUsd: 1.5,
    });
    expect(suite.targetSpec).toMatchObject({
      name: 'codex',
      extends: 'codex',
      definition: {
        name: 'codex',
        model: 'gpt-5.1',
        reasoning_effort: 'high',
      },
    });
    expect(suite.targets).toBeUndefined();
  });

  it('parses evaluate_options.repeat number shorthand', async () => {
    const evalPath = path.join(tempDir, 'runtime-repeat-shorthand.eval.yaml');
    await writeFile(
      evalPath,
      [
        'name: runtime-repeat-shorthand',
        'target: codex',
        'evaluate_options:',
        '  repeat: 3',
        'tests:',
        '  - id: one',
        '    input: hello',
        '    criteria: ok',
        '',
      ].join('\n'),
    );

    const suite = await loadTestSuite(evalPath, tempDir);

    expect(suite.experimentConfig?.repeat).toEqual({ count: 3, strategy: 'pass_any' });
  });

  it('parses default_test.threshold separately from legacy top-level threshold', async () => {
    const evalPath = path.join(tempDir, 'default-test-threshold.eval.yaml');
    await writeFile(
      evalPath,
      [
        'name: threshold-suite',
        'target: codex',
        'threshold: 0.9',
        'default_test:',
        '  threshold: 0.6',
        'tests:',
        '  - id: one',
        '    input: hello',
        '    criteria: ok',
        '',
      ].join('\n'),
    );

    const suite = await loadTestSuite(evalPath, tempDir);

    expect(suite.defaultTest).toEqual({ threshold: 0.6 });
    expect(suite.threshold).toBe(0.9);
    expect(suite.experimentConfig?.threshold).toBe(0.9);
  });

  it('loads default_test from a repo-root env file reference', async () => {
    const agentvDir = path.join(tempDir, '.agentv');
    await mkdir(agentvDir, { recursive: true });
    await writeFile(
      path.join(agentvDir, 'default-test.yaml'),
      ['threshold: 0.6', 'options:', '  rubric_prompt: Shared judge prompt', ''].join('\n'),
    );
    const evalPath = path.join(tempDir, 'default-test-file.eval.yaml');
    await writeFile(
      evalPath,
      [
        'name: default-test-file-suite',
        'default_test: file://{{ env.AGENTV_REPO_ROOT }}/.agentv/default-test.yaml',
        'tests:',
        '  - id: one',
        '    input: hello',
        '    criteria: ok',
        '',
      ].join('\n'),
    );

    const suite = await loadTestSuite(evalPath, tempDir);

    expect(suite.defaultTest).toEqual({ threshold: 0.6, rubricPrompt: 'Shared judge prompt' });
    expect(suite.tests[0]?.source?.references).toContainEqual(
      expect.objectContaining({
        kind: 'default_test',
        displayPath: 'file://{{ env.AGENTV_REPO_ROOT }}/.agentv/default-test.yaml',
        resolvedPath: path.join(agentvDir, 'default-test.yaml'),
      }),
    );
  });

  it('loads default_test through a project ref and inherits its assertions', async () => {
    const evalDir = path.join(tempDir, 'evals');
    const agentvDir = path.join(tempDir, '.agentv');
    await mkdir(evalDir, { recursive: true });
    await mkdir(agentvDir, { recursive: true });
    await writeFile(
      path.join(agentvDir, 'config.yaml'),
      [
        'refs:',
        '  global-default: file://{{ env.AGENTV_REPO_ROOT }}/.agentv/default-test.yaml',
        '',
      ].join('\n'),
    );
    await writeFile(
      path.join(agentvDir, 'default-test.yaml'),
      [
        'assert:',
        '  - type: contains',
        '    value: hello',
        'options:',
        '  rubric_prompt: Alias judge prompt',
        '',
      ].join('\n'),
    );
    const evalPath = path.join(evalDir, 'default-test-alias.eval.yaml');
    await writeFile(
      evalPath,
      [
        'name: default-test-alias-suite',
        'default_test: ref://global-default',
        'tests:',
        '  - id: one',
        '    input: hello',
        '',
      ].join('\n'),
    );

    const suite = await loadTestSuite(evalPath, tempDir);

    expect(suite.defaultTest).toEqual({ rubricPrompt: 'Alias judge prompt' });
    expect(suite.tests).toHaveLength(1);
    expect(suite.tests[0]?.assertions?.[0]).toMatchObject({
      type: 'contains',
      value: 'hello',
    });
    expect(suite.tests[0]?.source?.references).toContainEqual(
      expect.objectContaining({
        kind: 'default_test',
        displayPath: 'ref://global-default',
        resolvedPath: path.join(agentvDir, 'default-test.yaml'),
      }),
    );
  });

  it('rejects assertions in file-backed default_test', async () => {
    const agentvDir = path.join(tempDir, '.agentv');
    await mkdir(agentvDir, { recursive: true });
    await writeFile(
      path.join(agentvDir, 'default-test.yaml'),
      ['assertions:', '  - type: contains', '    value: hello', ''].join('\n'),
    );
    const evalPath = path.join(tempDir, 'default-test-assertions.eval.yaml');
    await writeFile(
      evalPath,
      [
        'name: default-test-assertions-suite',
        'default_test: file://{{ env.AGENTV_REPO_ROOT }}/.agentv/default-test.yaml',
        'tests:',
        '  - id: one',
        '    input: hello',
        '',
      ].join('\n'),
    );

    await expect(loadTestSuite(evalPath, tempDir)).rejects.toThrow(
      /default_test file must use assert, not assertions/,
    );
  });

  it('expands top-level prompts across tests with per-test vars', async () => {
    const evalPath = path.join(tempDir, 'prompt-matrix.eval.yaml');
    await writeFile(
      evalPath,
      [
        'name: prompt-matrix-suite',
        'prompts:',
        '  - id: direct',
        '    label: Direct',
        '    prompt: "Summarize {{ topic }}."',
        '  - id: terse',
        '    label: Terse',
        '    prompt: "In one sentence, summarize {{ topic }}."',
        'targets:',
        '  - id: mini',
        '  - id: local-codex',
        'tests:',
        '  - id: docs',
        '    vars:',
        '      topic: release notes',
        '    expected_output: concise release-note summary',
        '',
      ].join('\n'),
    );

    const suite = await loadTestSuite(evalPath, tempDir);

    expect(suite.tests.map((test) => test.id)).toEqual([
      'docs__prompt_direct',
      'docs__prompt_terse',
    ]);
    expect(suite.tests.map((test) => test.testId)).toEqual(['docs', 'docs']);
    expect(suite.tests.map((test) => test.prompt)).toEqual([
      { id: 'direct', label: 'Direct', kind: 'string' },
      { id: 'terse', label: 'Terse', kind: 'string' },
    ]);
    expect(suite.tests.map((test) => test.question)).toEqual([
      'Summarize release notes.',
      'In one sentence, summarize release notes.',
    ]);
    expect(suite.targets).toEqual(['mini', 'local-codex']);
    expect(suite.targetRefs).toEqual([
      { name: 'mini', id: 'mini' },
      { name: 'local-codex', id: 'local-codex' },
    ]);
  });

  it('merges default_test vars before top-level prompt expansion', async () => {
    const evalPath = path.join(tempDir, 'prompt-matrix-default-vars.eval.yaml');
    await writeFile(
      evalPath,
      [
        'name: prompt-matrix-default-vars-suite',
        'default_test:',
        '  vars:',
        '    audience: engineers',
        '    tone: concise',
        'prompts:',
        '  - id: chat',
        '    prompt:',
        '      - role: system',
        '        content: "Use a {{ tone }} tone for {{ audience }}."',
        '      - role: user',
        '        content: "Summarize {{ topic }}."',
        'tests:',
        '  - id: inherited-defaults',
        '    vars:',
        '      topic: release notes',
        '    expected_output: concise release-note summary',
        '  - id: overrides-default',
        '    vars:',
        '      audience: executives',
        '      topic: migration plan',
        '    expected_output: executive migration summary',
        '',
      ].join('\n'),
    );

    const suite = await loadTestSuite(evalPath, tempDir);

    expect(suite.tests.map((test) => test.id)).toEqual(['inherited-defaults', 'overrides-default']);
    expect(suite.tests.map((test) => test.input)).toEqual([
      [
        { role: 'system', content: 'Use a concise tone for engineers.' },
        { role: 'user', content: 'Summarize release notes.' },
      ],
      [
        { role: 'system', content: 'Use a concise tone for executives.' },
        { role: 'user', content: 'Summarize migration plan.' },
      ],
    ]);
  });

  it('merges default_test vars before direct test interpolation', async () => {
    const evalPath = path.join(tempDir, 'direct-default-vars.eval.yaml');
    await writeFile(
      evalPath,
      [
        'name: direct-default-vars-suite',
        'default_test:',
        '  vars:',
        '    tone: concise',
        '    category: support',
        'tests:',
        '  - id: direct-default',
        '    input: "Answer in a {{ tone }} {{ category }} style: {{ question }}"',
        '    vars:',
        '      question: How do I reset my password?',
        '    expected_output: password reset guidance',
        '  - id: direct-override',
        '    input: "Answer in a {{ tone }} {{ category }} style: {{ question }}"',
        '    vars:',
        '      category: onboarding',
        '      question: Where is the getting started guide?',
        '    expected_output: getting started guidance',
        '',
      ].join('\n'),
    );

    const suite = await loadTestSuite(evalPath, tempDir);

    expect(suite.tests.map((test) => test.question)).toEqual([
      'Answer in a concise support style: How do I reset my password?',
      'Answer in a concise onboarding style: Where is the getting started guide?',
    ]);
  });

  it('loads function prompt sources from top-level prompts', async () => {
    const promptScriptPath = path.join(tempDir, 'prompt-source.js');
    const evalPath = path.join(tempDir, 'function-prompts.eval.yaml');
    await writeFile(
      promptScriptPath,
      "console.log(JSON.stringify({ prompt: 'Explain {{ topic }} with one concrete example.' }));\n",
    );
    await writeFile(
      evalPath,
      [
        'name: function-prompt-suite',
        'prompts:',
        '  - id: generated',
        '    label: Generated',
        '    function_file: prompt-source.js',
        'tests:',
        '  - id: docs',
        '    vars:',
        '      topic: release notes',
        '    expected_output: concrete release-note explanation',
        '',
      ].join('\n'),
    );

    const suite = await loadTestSuite(evalPath, tempDir);

    expect(suite.tests).toHaveLength(1);
    expect(suite.tests[0]?.id).toBe('docs');
    expect(suite.tests[0]?.testId).toBe('docs');
    expect(suite.tests[0]?.prompt).toEqual({
      id: 'generated',
      label: 'Generated',
      kind: 'function',
    });
    expect(suite.tests[0]?.question).toBe('Explain release notes with one concrete example.');
  });

  it('loads chat and file prompts from the top-level prompt matrix', async () => {
    const promptPath = path.join(tempDir, 'prompt.md');
    const evalPath = path.join(tempDir, 'prompt-sources.eval.yaml');
    await writeFile(promptPath, 'Review {{ file_name }}.\n');
    await writeFile(
      evalPath,
      [
        'name: prompt-sources-suite',
        'prompts:',
        '  - id: chat',
        '    messages:',
        '      - role: system',
        '        content: Be precise.',
        '      - role: user',
        '        content: "Inspect {{ file_name }}."',
        '  - id: file',
        '    file: prompt.md',
        'tests:',
        '  - id: inspect',
        '    vars:',
        '      file_name: README.md',
        '    criteria: useful',
        '',
      ].join('\n'),
    );

    const suite = await loadTestSuite(evalPath, tempDir);

    expect(suite.tests).toHaveLength(2);
    expect(suite.tests[0]?.input).toEqual([
      { role: 'system', content: 'Be precise.' },
      { role: 'user', content: 'Inspect README.md.' },
    ]);
    expect(suite.tests[1]?.question).toBe('Review README.md.');
    expect(suite.tests[1]?.prompt).toEqual({
      id: 'file',
      label: 'prompt.md',
      kind: 'file',
    });
  });

  it('rejects tests input when top-level prompts are authored', async () => {
    const evalPath = path.join(tempDir, 'mixed-prompt-contract.eval.yaml');
    await writeFile(
      evalPath,
      [
        'prompts:',
        '  - hello',
        'tests:',
        '  - id: one',
        '    input: legacy',
        '    criteria: ok',
        '',
      ].join('\n'),
    );

    await expect(loadTestSuite(evalPath, tempDir)).rejects.toThrow(/tests\[\]\.input/);
  });

  it('parses evaluate_options.budget_usd', async () => {
    const evalPath = path.join(tempDir, 'evaluate-options-budget.eval.yaml');
    await writeFile(
      evalPath,
      [
        'name: evaluate-options-budget-suite',
        'target: codex',
        'evaluate_options:',
        '  budget_usd: 2.5',
        'tests:',
        '  - id: one',
        '    input: hello',
        '    criteria: ok',
        '',
      ].join('\n'),
    );

    const suite = await loadTestSuite(evalPath, tempDir);

    expect(suite.budgetUsd).toBe(2.5);
    expect(suite.experimentConfig).toMatchObject({
      target: 'codex',
      budgetUsd: 2.5,
    });
  });

  it('parses evaluate_options.max_concurrency as suite workers', async () => {
    const evalPath = path.join(tempDir, 'evaluate-options-concurrency.eval.yaml');
    await writeFile(
      evalPath,
      [
        'name: evaluate-options-concurrency-suite',
        'target: codex',
        'evaluate_options:',
        '  max_concurrency: 2',
        'tests:',
        '  - id: one',
        '    input: hello',
        '    criteria: ok',
        '',
      ].join('\n'),
    );

    const suite = await loadTestSuite(evalPath, tempDir);

    expect(suite.workers).toBe(2);
  });

  it('rejects authored workers in eval YAML runtime blocks', async () => {
    const cases = [
      {
        file: 'top-level.eval.yaml',
        body: ['workers: 2', 'tests:', '  - id: one', '    input: hello', '    criteria: ok'],
        message: /workers has been removed from eval YAML/,
      },
      {
        file: 'execution.eval.yaml',
        body: [
          'execution:',
          '  workers: 2',
          'tests:',
          '  - id: one',
          '    input: hello',
          '    criteria: ok',
        ],
        message: /execution\.workers has been removed from eval YAML/,
      },
      {
        file: 'experiment.eval.yaml',
        body: [
          'experiment:',
          '  workers: 2',
          'tests:',
          '  - id: one',
          '    input: hello',
          '    criteria: ok',
        ],
        message: /experiment\.workers has been removed from eval YAML/,
      },
      {
        file: 'target-ref.eval.yaml',
        body: [
          'execution:',
          '  targets:',
          '    - name: codex',
          '      workers: 2',
          'tests:',
          '  - id: one',
          '    input: hello',
          '    criteria: ok',
        ],
        message: /execution\.targets\[0\]\.workers has been removed from eval YAML/,
      },
      {
        file: 'test-execution.eval.yaml',
        body: [
          'tests:',
          '  - id: one',
          '    input: hello',
          '    criteria: ok',
          '    execution:',
          '      workers: 2',
        ],
        message: /tests\[0\]\.execution\.workers has been removed from eval YAML/,
      },
    ];

    for (const testCase of cases) {
      const evalPath = path.join(tempDir, testCase.file);
      await writeFile(evalPath, `${testCase.body.join('\n')}\n`);
      await expect(loadTestSuite(evalPath, tempDir)).rejects.toThrow(testCase.message);
    }
  });

  it('rejects top-level policy blocks', async () => {
    const evalPath = path.join(tempDir, 'repeat-policy.eval.yaml');
    await writeFile(
      evalPath,
      [
        'target: codex',
        'policy:',
        '  repeat:',
        '    count: 2',
        '    strategy: pass_any',
        'tests:',
        '  - id: one',
        '    input: hello',
        '    criteria: ok',
        '',
      ].join('\n'),
    );

    await expect(loadTestSuite(evalPath, tempDir)).rejects.toThrow(/top-level 'policy'/);
  });

  it('rejects top-level providers during runtime suite loading', async () => {
    const evalPath = path.join(tempDir, 'top-level-providers.eval.yaml');
    await writeFile(
      evalPath,
      [
        'providers:',
        '  - label: legacy',
        '    provider: mock',
        'tests:',
        '  - id: one',
        '    input: hello',
        '    criteria: ok',
        '',
      ].join('\n'),
    );

    await expect(loadTestSuite(evalPath, tempDir)).rejects.toThrow(
      /top-level 'providers' is not a runtime alias/,
    );
  });

  it('rejects removed top-level repeat controls', async () => {
    const evalPath = path.join(tempDir, 'removed-repeat-controls.eval.yaml');
    await writeFile(
      evalPath,
      [
        'target: codex',
        'repeat:',
        '  count: 2',
        'runs: 2',
        'early_exit: true',
        'tests:',
        '  - id: one',
        '    input: hello',
        '    criteria: ok',
        '',
      ].join('\n'),
    );

    await expect(loadTestSuite(evalPath, tempDir)).rejects.toThrow(/evaluate_options\.repeat/);
  });

  it('rejects top-level execution blocks and non-string experiment values', async () => {
    const legacyPath = path.join(tempDir, 'legacy.eval.yaml');
    await writeFile(
      legacyPath,
      [
        'execution:',
        '  target: mock',
        'tests:',
        '  - id: one',
        '    input: hello',
        '    criteria: ok',
        '',
      ].join('\n'),
    );

    await expect(loadTestSuite(legacyPath, tempDir)).rejects.toThrow(/execution\.target/);

    const removedPath = path.join(tempDir, 'removed.eval.yaml');
    await writeFile(
      removedPath,
      [
        'experiment:',
        '  target: codex',
        'tests:',
        '  - id: one',
        '    input: hello',
        '    criteria: ok',
        '',
      ].join('\n'),
    );

    await expect(loadTestSuite(removedPath, tempDir)).rejects.toThrow(
      /top-level 'experiment' must be a string/,
    );
  });

  it('rejects top-level model because target object owns model overrides', async () => {
    const evalPath = path.join(tempDir, 'camel-policy.eval.yaml');
    await writeFile(
      evalPath,
      [
        'target: codex',
        'model: gpt-5.1',
        'tests:',
        '  - id: one',
        '    input: hello',
        '    criteria: ok',
        '',
      ].join('\n'),
    );

    await expect(loadTestSuite(evalPath, tempDir)).rejects.toThrow(/top-level 'model'/);
  });

  it('rejects per-test execution workspace blocks', async () => {
    const evalPath = path.join(tempDir, 'test-execution-workspace.eval.yaml');
    await writeFile(
      evalPath,
      [
        'tests:',
        '  - id: one',
        '    input: hello',
        '    criteria: ok',
        '    execution:',
        '      workspace:',
        '        mode: static',
        '        path: /tmp/ws',
        '',
      ].join('\n'),
    );

    await expect(loadTestSuite(evalPath, tempDir)).rejects.toThrow(
      /execution\.workspace has been removed from eval YAML/,
    );
  });

  it('rejects unsupported per-test execution target blocks', async () => {
    const evalPath = path.join(tempDir, 'test-execution-target.eval.yaml');
    await writeFile(
      evalPath,
      [
        'tests:',
        '  - id: one',
        '    input: hello',
        '    criteria: ok',
        '    execution:',
        '      target: codex',
        '',
      ].join('\n'),
    );

    await expect(loadTestSuite(evalPath, tempDir)).rejects.toThrow(
      "test 'one'.execution.target is not supported.",
    );
  });

  it('globs raw case files through tests[].include with deterministic ordering and select filters', async () => {
    const casesDir = path.join(tempDir, 'cases');
    await mkdir(casesDir, { recursive: true });
    await writeFile(
      path.join(casesDir, 'b.cases.yaml'),
      [
        '- id: b-2',
        '  input: b2',
        '  criteria: ok',
        '- id: b-1',
        '  input: b1',
        '  criteria: ok',
      ].join('\n'),
    );
    await writeFile(
      path.join(casesDir, 'a.cases.yaml'),
      ['- id: a-1', '  input: a1', '  criteria: ok'].join('\n'),
    );
    await writeFile(path.join(casesDir, 'c.jsonl'), '{"id":"c-1","input":"c1","criteria":"ok"}\n');
    const evalPath = path.join(tempDir, 'parent.eval.yaml');
    await writeFile(
      evalPath,
      [
        'tests:',
        '  - include: cases/*.cases.yaml',
        '    type: tests',
        '    select:',
        '      test_ids: ["a-*", "b-1"]',
        '  - include: cases/*.jsonl',
        '    type: tests',
        '',
      ].join('\n'),
    );

    const suite = await loadTestSuite(evalPath, tempDir);

    expect(suite.tests.map((test) => test.id)).toEqual(['a-1', 'b-1', 'c-1']);
  });

  it('keeps raw-case shorthand imports for tests strings and list entries', async () => {
    const casesDir = path.join(tempDir, 'cases');
    const suitesDir = path.join(tempDir, 'suites');
    await mkdir(casesDir, { recursive: true });
    await mkdir(suitesDir, { recursive: true });
    await writeFile(
      path.join(casesDir, 'a.cases.yaml'),
      '- id: a-1\n  input: a1\n  criteria: ok\n',
    );
    await writeFile(
      path.join(casesDir, 'b.cases.yaml'),
      '- id: b-1\n  input: b1\n  criteria: ok\n',
    );
    await writeFile(path.join(casesDir, 'c.jsonl'), '{"id":"c-1","input":"c1","criteria":"ok"}\n');
    await writeFile(
      path.join(suitesDir, 'child.eval.yaml'),
      [
        'name: child-suite',
        'tests:',
        '  - id: suite-1',
        '    input: suite',
        '    criteria: ok',
        '',
      ].join('\n'),
    );

    const topLevelPath = path.join(tempDir, 'top-level.eval.yaml');
    await writeFile(topLevelPath, 'tests: cases/*.cases.yaml\n');
    const topLevelSuite = await loadTestSuite(topLevelPath, tempDir);
    expect(topLevelSuite.tests.map((test) => test.id)).toEqual(['a-1', 'b-1']);

    const mixedPath = path.join(tempDir, 'mixed.eval.yaml');
    await writeFile(
      mixedPath,
      [
        'tests:',
        '  - cases/*.jsonl',
        '  - include: suites/*.eval.yaml',
        '    type: suite',
        '',
      ].join('\n'),
    );
    const mixedSuite = await loadTestSuite(mixedPath, tempDir);
    expect(mixedSuite.tests.map((test) => test.id)).toEqual(['suite-1', 'c-1']);
    expect(mixedSuite.tests[0]?.suite).toBe('child-suite');
    expect(mixedSuite.tests[0]?.source?.importedSuiteName).toBe('child-suite');

    const invalidPath = path.join(tempDir, 'invalid.eval.yaml');
    await writeFile(invalidPath, 'tests: suites/*.eval.yaml\n');
    await expect(loadTestSuite(invalidPath, tempDir)).rejects.toThrow(
      /shorthand imports raw case files only/,
    );
  });

  it('rejects direct circular suite imports', async () => {
    const evalPath = path.join(tempDir, 'self.eval.yaml');
    await writeFile(
      evalPath,
      ['name: self', 'tests:', '  - include: self.eval.yaml', '    type: suite', ''].join('\n'),
    );

    await expect(loadTestSuite(evalPath, tempDir)).rejects.toThrow(
      /Circular eval suite import: .*self\.eval\.yaml -> .*self\.eval\.yaml/,
    );
  });

  it('rejects indirect circular suite imports with the import chain', async () => {
    const aPath = path.join(tempDir, 'a.eval.yaml');
    const bPath = path.join(tempDir, 'b.eval.yaml');
    await writeFile(
      aPath,
      ['name: a', 'tests:', '  - include: b.eval.yaml', '    type: suite', ''].join('\n'),
    );
    await writeFile(
      bPath,
      ['name: b', 'tests:', '  - include: a.eval.yaml', '    type: suite', ''].join('\n'),
    );

    await expect(loadTestSuite(aPath, tempDir)).rejects.toThrow(
      /Circular eval suite import: .*a\.eval\.yaml -> .*b\.eval\.yaml -> .*a\.eval\.yaml/,
    );
  });

  it('allows sibling re-imports of the same suite', async () => {
    const childPath = path.join(tempDir, 'child.eval.yaml');
    await writeFile(
      childPath,
      [
        'name: child',
        'tests:',
        '  - id: child-case',
        '    input: child',
        '    criteria: ok',
        '',
      ].join('\n'),
    );
    const parentPath = path.join(tempDir, 'parent.eval.yaml');
    await writeFile(
      parentPath,
      [
        'name: parent',
        'tests:',
        '  - include: child.eval.yaml',
        '    type: suite',
        '  - include: child.eval.yaml',
        '    type: suite',
        '',
      ].join('\n'),
    );

    const suite = await loadTestSuite(parentPath, tempDir);

    expect(suite.tests.map((test) => test.id)).toEqual(['child-case', 'child-case']);
  });

  it('loads deep non-cyclic suite import chains', async () => {
    const aPath = path.join(tempDir, 'chain-a.eval.yaml');
    const bPath = path.join(tempDir, 'chain-b.eval.yaml');
    const cPath = path.join(tempDir, 'chain-c.eval.yaml');
    await writeFile(
      aPath,
      ['name: chain-a', 'tests:', '  - include: chain-b.eval.yaml', '    type: suite', ''].join(
        '\n',
      ),
    );
    await writeFile(
      bPath,
      ['name: chain-b', 'tests:', '  - include: chain-c.eval.yaml', '    type: suite', ''].join(
        '\n',
      ),
    );
    await writeFile(
      cPath,
      [
        'name: chain-c',
        'tests:',
        '  - id: c-case',
        '    input: deepest',
        '    criteria: ok',
        '',
      ].join('\n'),
    );

    const suite = await loadTestSuite(aPath, tempDir);

    expect(suite.tests.map((test) => test.id)).toEqual(['c-case']);
    expect(suite.tests[0]?.suite).toBe('chain-c');
    expect(suite.tests[0]?.source?.importedSuiteName).toBe('chain-c');
    expect(suite.tests[0]?.source?.evalFileAbsolutePath).toBe(cPath);
  });

  it('filters include entries by tags and metadata selectors', async () => {
    const casesDir = path.join(tempDir, 'cases');
    await mkdir(casesDir, { recursive: true });
    await writeFile(
      path.join(casesDir, 'selected.cases.yaml'),
      [
        '- id: selected',
        '  input: selected',
        '  criteria: ok',
        '  metadata:',
        '    tags: [sql-migration, review]',
        '    type: e2e',
        '    priority: high',
        '- id: wrong-priority',
        '  input: wrong',
        '  criteria: ok',
        '  metadata:',
        '    tags: [sql-migration]',
        '    type: e2e',
        '    priority: low',
      ].join('\n'),
    );
    const evalPath = path.join(tempDir, 'parent.eval.yaml');
    await writeFile(
      evalPath,
      [
        'tests:',
        '  - include: cases/*.cases.yaml',
        '    type: tests',
        '    select:',
        '      tags: sql-*',
        '      metadata:',
        '        type: [e2e, regression]',
        '        priority: high',
        '',
      ].join('\n'),
    );

    const suite = await loadTestSuite(evalPath, tempDir);

    expect(suite.tests.map((test) => test.id)).toEqual(['selected']);
  });

  it('select.tags filters effective case metadata tags including suite identity tags', async () => {
    const casesDir = path.join(tempDir, 'cases');
    await mkdir(casesDir, { recursive: true });
    await writeFile(
      path.join(casesDir, 'cases.cases.yaml'),
      [
        '- id: inherited-tag',
        '  input: inherited',
        '  criteria: ok',
        '- id: case-tag',
        '  input: case',
        '  criteria: ok',
        '  metadata:',
        '    tags: [review]',
      ].join('\n'),
    );
    const inheritedPath = path.join(tempDir, 'inherited.eval.yaml');
    await writeFile(
      inheritedPath,
      [
        'tags: [suite-identity]',
        'metadata:',
        '  tags: [sql-migration]',
        'tests:',
        '  - include: cases/*.cases.yaml',
        '    type: tests',
        '    select:',
        '      tags: sql-*',
        '',
      ].join('\n'),
    );

    const inheritedSuite = await loadTestSuite(inheritedPath, tempDir);
    expect(inheritedSuite.tests.map((test) => test.id)).toEqual(['inherited-tag', 'case-tag']);
    expect(inheritedSuite.tests[1]?.metadata?.tags).toEqual([
      'suite-identity',
      'sql-migration',
      'review',
    ]);

    const identityPath = path.join(tempDir, 'identity.eval.yaml');
    await writeFile(
      identityPath,
      [
        'tags: [suite-identity]',
        'tests:',
        '  - include: cases/*.cases.yaml',
        '    type: tests',
        '    select:',
        '      tags: suite-identity',
        '',
      ].join('\n'),
    );

    const identitySuite = await loadTestSuite(identityPath, tempDir);
    expect(identitySuite.tests.map((test) => test.id)).toEqual(['inherited-tag', 'case-tag']);
    expect(identitySuite.tests[0]?.metadata?.tags).toEqual(['suite-identity']);
  });

  it('type: suite preserves child suite context while parent target and run controls own runtime', async () => {
    await writeFile(
      path.join(tempDir, 'child.eval.yaml'),
      [
        'name: child-suite',
        'target: child-target',
        'threshold: 0.2',
        'timeout_seconds: 10',
        'evaluate_options:',
        '  budget_usd: 0.5',
        'workspace:',
        '  template: ./child-workspace',
        'input: child shared input',
        'assert:',
        '  - type: contains',
        '    value: child',
        'tests:',
        '  - id: child-case',
        '    input: child case input',
        '    criteria: ok',
        '',
      ].join('\n'),
    );
    const parentPath = path.join(tempDir, 'parent.eval.yaml');
    await writeFile(
      parentPath,
      [
        'name: parent-suite',
        'target: parent-target',
        'threshold: 0.8',
        'evaluate_options:',
        '  repeat:',
        '    count: 3',
        '    strategy: pass_any',
        '  budget_usd: 1.5',
        'timeout_seconds: 30',
        'input: parent shared input',
        'assert:',
        '  - type: contains',
        '    value: parent',
        'tests:',
        '  - include: child.eval.yaml',
        '    type: suite',
        '',
      ].join('\n'),
    );

    const suite = await loadTestSuite(parentPath, tempDir);
    const test = suite.tests[0];

    expect(suite.experimentConfig?.target).toBe('parent-target');
    expect(suite.experimentConfig?.threshold).toBe(0.8);
    expect(suite.experimentConfig?.repeat).toMatchObject({ count: 3, strategy: 'pass_any' });
    expect(test.run).toBeUndefined();
    expect(test.suite).toBe('child-suite');
    expect(test.workspace?.template).toBe(path.join(tempDir, 'child-workspace'));
    expect(test.input.map((message) => message.content)).toEqual([
      'child shared input',
      'child case input',
    ]);
    expect(test.assertions?.[0]?.type).toBe('contains');
    expect(test.assertions?.[0]).toMatchObject({ value: 'child' });
  });

  it('applies tests[].options.repeat over the global repeat object', async () => {
    const evalPath = path.join(tempDir, 'test-options-repeat.eval.yaml');
    await writeFile(
      evalPath,
      [
        'name: test-options-repeat',
        'target: codex',
        'evaluate_options:',
        '  repeat:',
        '    count: 4',
        '    strategy: pass_all',
        'tests:',
        '  - id: global-repeat',
        '    input: hello',
        '    criteria: ok',
        '  - id: case-repeat-count',
        '    input: hello',
        '    criteria: ok',
        '    options:',
        '      repeat: 2',
        '  - id: case-repeat-object',
        '    input: hello',
        '    criteria: ok',
        '    run:',
        '      threshold: 0.9',
        '    options:',
        '      repeat:',
        '        count: 3',
        '        strategy: mean',
        '        early_exit: false',
        '',
      ].join('\n'),
    );

    const suite = await loadTestSuite(evalPath, tempDir);
    const byId = new Map(suite.tests.map((test) => [test.id, test]));

    expect(suite.experimentConfig?.repeat).toEqual({ count: 4, strategy: 'pass_all' });
    expect(byId.get('global-repeat')?.run).toBeUndefined();
    expect(byId.get('case-repeat-count')?.run?.repeat).toEqual({
      count: 2,
      strategy: 'pass_any',
    });
    expect(byId.get('case-repeat-object')?.run).toMatchObject({
      threshold: 0.9,
      repeat: { count: 3, strategy: 'mean', earlyExit: false },
    });
  });

  it('rejects parent workspace when importing eval suites with type: suite', async () => {
    await writeFile(
      path.join(tempDir, 'child.eval.yaml'),
      [
        'name: child-suite',
        'workspace:',
        '  path: ./child-workspace',
        'tests:',
        '  - id: child-case',
        '    input: child case input',
        '    criteria: ok',
        '',
      ].join('\n'),
    );
    const parentPath = path.join(tempDir, 'parent.eval.yaml');
    await writeFile(
      parentPath,
      [
        'name: parent-suite',
        'workspace:',
        '  template: ./parent-workspace',
        'tests:',
        '  - include: child.eval.yaml',
        '    type: suite',
        '',
      ].join('\n'),
    );

    await expect(loadTestSuite(parentPath, tempDir)).rejects.toThrow(
      /Parent workspace is not allowed/,
    );
  });

  it('rejects removed parent experiment blocks when importing eval suites with type: suite', async () => {
    await writeFile(
      path.join(tempDir, 'child.eval.yaml'),
      [
        'name: child-suite',
        'tests:',
        '  - id: child-case',
        '    input: child case input',
        '    criteria: ok',
        '',
      ].join('\n'),
    );
    const parentPath = path.join(tempDir, 'parent.eval.yaml');
    await writeFile(
      parentPath,
      [
        'name: parent-suite',
        'experiment:',
        '  workspace:',
        '    path: ./parent-workspace',
        'tests:',
        '  - include: child.eval.yaml',
        '    type: suite',
        '',
      ].join('\n'),
    );

    await expect(loadTestSuite(parentPath, tempDir)).rejects.toThrow(
      /top-level 'experiment' must be a string/,
    );
  });

  it('rejects legacy execution workspace when importing eval suites with type: suite', async () => {
    await writeFile(
      path.join(tempDir, 'child.eval.yaml'),
      [
        'name: child-suite',
        'tests:',
        '  - id: child-case',
        '    input: child case input',
        '    criteria: ok',
        '',
      ].join('\n'),
    );
    const parentPath = path.join(tempDir, 'parent.eval.yaml');
    await writeFile(
      parentPath,
      [
        'name: parent-suite',
        'execution:',
        '  workspace:',
        '    path: ./parent-workspace',
        'tests:',
        '  - include: child.eval.yaml',
        '    type: suite',
        '',
      ].join('\n'),
    );

    await expect(loadTestSuite(parentPath, tempDir)).rejects.toThrow(/execution\.workspace/);
  });

  it('does not apply imported child run controls when parent has no run controls', async () => {
    await writeFile(
      path.join(tempDir, 'child.eval.yaml'),
      [
        'name: child-suite',
        'threshold: 0.2',
        'timeout_seconds: 10',
        'evaluate_options:',
        '  budget_usd: 0.5',
        'tests:',
        '  - id: child-default',
        '    input: default',
        '    criteria: ok',
        '',
      ].join('\n'),
    );
    const parentPath = path.join(tempDir, 'parent.eval.yaml');
    await writeFile(
      parentPath,
      ['name: parent-suite', 'tests:', '  - include: child.eval.yaml', '    type: suite', ''].join(
        '\n',
      ),
    );

    const suite = await loadTestSuite(parentPath, tempDir);

    expect(suite.experimentConfig).toBeUndefined();
    expect(suite.tests[0]?.run).toBeUndefined();
  });

  it('applies include-level run overrides without importing child run controls', async () => {
    await writeFile(
      path.join(tempDir, 'child.eval.yaml'),
      [
        'name: child-suite',
        'threshold: 0.2',
        'timeout_seconds: 10',
        'evaluate_options:',
        '  budget_usd: 0.5',
        'tests:',
        '  - id: child-default',
        '    input: default',
        '    criteria: ok',
        '',
      ].join('\n'),
    );
    const parentPath = path.join(tempDir, 'parent.eval.yaml');
    await writeFile(
      parentPath,
      [
        'name: parent-suite',
        'tests:',
        '  - include: child.eval.yaml',
        '    type: suite',
        '    run:',
        '      threshold: 0.9',
        '      timeout_seconds: 30',
        '',
      ].join('\n'),
    );

    const suite = await loadTestSuite(parentPath, tempDir);

    expect(suite.tests[0]?.run).toEqual({
      threshold: 0.9,
      timeoutSeconds: 30,
    });
  });

  it('applies test.run over include-level run overrides without child run controls', async () => {
    await writeFile(
      path.join(tempDir, 'child.eval.yaml'),
      [
        'name: child-suite',
        'threshold: 0.2',
        'timeout_seconds: 10',
        'evaluate_options:',
        '  budget_usd: 0.5',
        'tests:',
        '  - id: child-default',
        '    input: default',
        '    criteria: ok',
        '  - id: child-critical',
        '    input: critical',
        '    criteria: ok',
        '    run:',
        '      threshold: 1.0',
        '      repeat:',
        '        count: 1',
        '',
      ].join('\n'),
    );
    const parentPath = path.join(tempDir, 'parent.eval.yaml');
    await writeFile(
      parentPath,
      [
        'name: parent-suite',
        'tests:',
        '  - include: child.eval.yaml',
        '    type: suite',
        '    run:',
        '      threshold: 0.9',
        '      repeat:',
        '        count: 2',
        '        strategy: pass_all',
        '      timeout_seconds: 30',
        '      budget_usd: 1.25',
        '',
      ].join('\n'),
    );

    const suite = await loadTestSuite(parentPath, tempDir);
    const byId = new Map(suite.tests.map((test) => [test.id, test]));

    expect(suite.experimentConfig).toBeUndefined();
    expect(byId.get('child-default')?.run).toMatchObject({
      threshold: 0.9,
      repeat: { count: 2, strategy: 'pass_all' },
      timeoutSeconds: 30,
      budgetUsd: 1.25,
    });
    expect(byId.get('child-critical')?.run).toMatchObject({
      threshold: 1.0,
      repeat: { count: 1 },
      timeoutSeconds: 30,
      budgetUsd: 1.25,
    });
    expect(byId.get('child-critical')?.threshold).toBe(1.0);
  });

  it('imports child suites without authored worker controls', async () => {
    await writeFile(
      path.join(tempDir, 'child-a.eval.yaml'),
      ['name: child-a', 'tests:', '  - id: a', '    input: a', '    criteria: ok', ''].join('\n'),
    );
    await writeFile(
      path.join(tempDir, 'child-b.eval.yaml'),
      ['name: child-b', 'tests:', '  - id: b', '    input: b', '    criteria: ok', ''].join('\n'),
    );
    const parentPath = path.join(tempDir, 'parent.eval.yaml');
    await writeFile(
      parentPath,
      [
        'name: parent-suite',
        'tests:',
        '  - include: child-*.eval.yaml',
        '    type: suite',
        '',
      ].join('\n'),
    );

    const suite = await loadTestSuite(parentPath, tempDir);

    expect(suite.experimentConfig).toBeUndefined();
    expect(suite.tests.map((test) => test.id)).toEqual(['a', 'b']);
    expect(suite.tests.every((test) => test.run === undefined)).toBe(true);
  });

  it('imports suites through imports.suites while preserving child task context', async () => {
    await writeFile(
      path.join(tempDir, 'child.eval.yaml'),
      [
        'name: child-suite',
        'workspace:',
        '  template: ./child-workspace',
        'input: child shared input',
        'assert:',
        '  - type: contains',
        '    value: child',
        'threshold: 0.2',
        'tests:',
        '  - id: child-case',
        '    input: child case input',
        '    criteria: ok',
        '',
      ].join('\n'),
    );
    const parentPath = path.join(tempDir, 'parent.eval.yaml');
    await writeFile(
      parentPath,
      [
        'name: parent-suite',
        'target: codex-gpt5',
        'threshold: 0.8',
        'imports:',
        '  suites:',
        '    - path: child.eval.yaml',
        '      run:',
        '        timeout_seconds: 60',
        'tests:',
        '  - id: local-edge',
        '    input: local input',
        '    criteria: local ok',
        '',
      ].join('\n'),
    );

    const suite = await loadTestSuite(parentPath, tempDir);
    const byId = new Map(suite.tests.map((test) => [test.id, test]));

    expect(suite.experimentConfig).toMatchObject({ target: 'codex-gpt5', threshold: 0.8 });
    expect(byId.get('child-case')?.suite).toBe('child-suite');
    expect(byId.get('child-case')?.source?.importedSuiteName).toBe('child-suite');
    expect(byId.get('child-case')?.workspace?.template).toBe(path.join(tempDir, 'child-workspace'));
    expect(byId.get('child-case')?.input.map((message) => message.content)).toEqual([
      'child shared input',
      'child case input',
    ]);
    expect(byId.get('child-case')?.assertions?.[0]).toMatchObject({
      type: 'contains',
      value: 'child',
    });
    expect(byId.get('child-case')?.run).toEqual({ timeoutSeconds: 60 });
    expect(byId.get('local-edge')?.suite).toBe('parent-suite');
  });

  it('imports raw rows through imports.tests and evaluates them in parent context', async () => {
    await writeFile(
      path.join(tempDir, 'smoke.jsonl'),
      '{"id":"jsonl-case","input":"jsonl input","criteria":"ok"}\n',
    );
    await writeFile(
      path.join(tempDir, 'regressions.yaml'),
      ['- id: yaml-case', '  input: yaml input', '  criteria: ok', ''].join('\n'),
    );
    const parentPath = path.join(tempDir, 'parent.eval.yaml');
    await writeFile(
      parentPath,
      [
        'name: parent-suite',
        'workspace:',
        '  template: ./parent-workspace',
        'input: parent shared input',
        'assert:',
        '  - type: contains',
        '    value: parent',
        'imports:',
        '  tests:',
        '    - path: smoke.jsonl',
        '    - path: regressions.yaml',
        'tests:',
        '  - id: inline-case',
        '    input: inline input',
        '    criteria: ok',
        '',
      ].join('\n'),
    );

    const suite = await loadTestSuite(parentPath, tempDir);
    const byId = new Map(suite.tests.map((test) => [test.id, test]));

    expect(suite.tests.map((test) => test.id)).toEqual(['jsonl-case', 'yaml-case', 'inline-case']);
    for (const id of ['jsonl-case', 'yaml-case', 'inline-case']) {
      expect(byId.get(id)?.suite).toBe('parent-suite');
      expect(byId.get(id)?.workspace?.template).toBe(path.join(tempDir, 'parent-workspace'));
      expect(byId.get(id)?.assertions?.[0]).toMatchObject({ type: 'contains', value: 'parent' });
    }
    expect(byId.get('jsonl-case')?.input.map((message) => message.content)).toEqual([
      'parent shared input',
      'jsonl input',
    ]);
  });

  it('combines imports.tests with tests path shorthand in parent context', async () => {
    await writeFile(
      path.join(tempDir, 'imported.jsonl'),
      '{"id":"imported-case","input":"imported input","criteria":"ok"}\n',
    );
    await writeFile(
      path.join(tempDir, 'local.yaml'),
      ['- id: local-case', '  input: local input', '  criteria: ok', ''].join('\n'),
    );
    const parentPath = path.join(tempDir, 'parent.eval.yaml');
    await writeFile(
      parentPath,
      [
        'name: parent-suite',
        'workspace:',
        '  template: ./parent-workspace',
        'imports:',
        '  tests:',
        '    - path: imported.jsonl',
        'tests: local.yaml',
        '',
      ].join('\n'),
    );

    const suite = await loadTestSuite(parentPath, tempDir);
    const byId = new Map(suite.tests.map((test) => [test.id, test]));

    expect(suite.tests.map((test) => test.id)).toEqual(['imported-case', 'local-case']);
    expect(byId.get('imported-case')?.suite).toBe('parent-suite');
    expect(byId.get('local-case')?.suite).toBe('parent-suite');
    expect(byId.get('imported-case')?.workspace?.template).toBe(
      path.join(tempDir, 'parent-workspace'),
    );
  });

  it('rejects parent workspace when imports.suites preserves child workspaces', async () => {
    await writeFile(
      path.join(tempDir, 'child.eval.yaml'),
      [
        'name: child-suite',
        'tests:',
        '  - id: child-case',
        '    input: child',
        '    criteria: ok',
        '',
      ].join('\n'),
    );
    const parentPath = path.join(tempDir, 'parent.eval.yaml');
    await writeFile(
      parentPath,
      [
        'name: parent-suite',
        'workspace:',
        '  template: ./parent-workspace',
        'imports:',
        '  suites:',
        '    - path: child.eval.yaml',
        '',
      ].join('\n'),
    );

    await expect(loadTestSuite(parentPath, tempDir)).rejects.toThrow(
      /Parent workspace is not allowed/,
    );
  });

  it('warns but supports legacy tests include entries during migration', async () => {
    await writeFile(
      path.join(tempDir, 'child.eval.yaml'),
      [
        'name: child-suite',
        'tests:',
        '  - id: child-case',
        '    input: child',
        '    criteria: ok',
        '',
      ].join('\n'),
    );
    const parentPath = path.join(tempDir, 'parent.eval.yaml');
    await writeFile(
      parentPath,
      ['name: parent-suite', 'tests:', '  - include: child.eval.yaml', '    type: suite', ''].join(
        '\n',
      ),
    );

    const warn = console.warn;
    const warnings: string[] = [];
    console.warn = (message?: unknown) => {
      warnings.push(String(message));
    };
    try {
      const suite = await loadTestSuite(parentPath, tempDir);
      expect(suite.tests.map((test) => test.id)).toEqual(['child-case']);
    } finally {
      console.warn = warn;
    }

    expect(warnings.some((message) => message.includes('tests[].include is deprecated'))).toBe(
      true,
    );
  });

  it('validates imports.suites and warns for legacy/confusing imports', async () => {
    await writeFile(
      path.join(tempDir, 'child.eval.yaml'),
      [
        'name: child-suite',
        'target: child-target',
        'tests:',
        '  - id: child-case',
        '    input: child',
        '',
      ].join('\n'),
    );
    const parentPath = path.join(tempDir, 'parent.eval.yaml');
    await writeFile(
      parentPath,
      [
        'name: parent-suite',
        'target: parent-target',
        'imports:',
        '  suites:',
        '    - path: child.eval.yaml',
        '  tests:',
        '    - path: child.eval.yaml',
        'tests:',
        '  - include: child.eval.yaml',
        '    type: suite',
        '',
      ].join('\n'),
    );

    const result = await validateEvalFile(parentPath);

    expect(result.valid).toBe(true);
    const warnings = result.errors.filter((error) => error.severity === 'warning');
    expect(warnings.some((error) => error.message.includes('tests[].include is deprecated'))).toBe(
      true,
    );
    expect(
      warnings.some((error) => error.message.includes('child target and run controls are ignored')),
    ).toBe(true);
    expect(
      warnings.some((error) => error.message.includes('imports.tests imports raw cases')),
    ).toBe(true);
  });

  it('type: tests imports only raw cases and applies parent suite context', async () => {
    await writeFile(
      path.join(tempDir, 'child.eval.yaml'),
      [
        'name: child-suite',
        'input: child shared input',
        'assert:',
        '  - type: contains',
        '    value: child',
        'tests:',
        '  - id: raw-case',
        '    input: raw case input',
        '    criteria: ok',
        '',
      ].join('\n'),
    );
    const parentPath = path.join(tempDir, 'parent.eval.yaml');
    await writeFile(
      parentPath,
      [
        'name: parent-suite',
        'workspace:',
        '  template: ./parent-workspace',
        'input: parent shared input',
        'assert:',
        '  - type: contains',
        '    value: parent',
        'tests:',
        '  - include: child.eval.yaml',
        '    type: tests',
        '',
      ].join('\n'),
    );

    const suite = await loadTestSuite(parentPath, tempDir);
    const test = suite.tests[0];

    expect(test.suite).toBe('parent-suite');
    expect(test.input.map((message) => message.content)).toEqual([
      'parent shared input',
      'raw case input',
    ]);
    expect(test.workspace?.template).toBe(path.join(tempDir, 'parent-workspace'));
    expect(test.assertions?.[0]).toMatchObject({ type: 'contains', value: 'parent' });
  });
});
