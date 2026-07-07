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
        'providers:',
        '  - id: agentv:codex-cli',
        '    label: codex',
        '    config:',
        '      model: gpt-5.1',
        '      reasoning_effort: high',
        'threshold: 0.7',
        'evaluate_options:',
        '  repeat:',
        '    count: 2',
        '    strategy: pass_any',
        '    early_exit: true',
        '  budget_usd: 1.5',
        'timeout_seconds: 30',
        'prompts:',
        '  - "{{ input }}"',
        'tests:',
        '  - id: one',
        '    criteria: ok',
        '    vars:',
        '      input: hello',
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
    expect(suite.targetSpec).toBeUndefined();
    expect(suite.targets).toEqual(['codex']);
  });

  it('parses evaluate_options.repeat number shorthand', async () => {
    const evalPath = path.join(tempDir, 'runtime-repeat-shorthand.eval.yaml');
    await writeFile(
      evalPath,
      [
        'name: runtime-repeat-shorthand',
        'providers:',
        '  - codex',
        'evaluate_options:',
        '  repeat: 3',
        'prompts:',
        '  - "{{ input }}"',
        'tests:',
        '  - id: one',
        '    criteria: ok',
        '    vars:',
        '      input: hello',
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
        'providers:',
        '  - codex',
        'threshold: 0.9',
        'prompts:',
        '  - "{{ input }}"',
        'default_test:',
        '  threshold: 0.6',
        'tests:',
        '  - id: one',
        '    criteria: ok',
        '    vars:',
        '      input: hello',
      ].join('\n'),
    );

    const suite = await loadTestSuite(evalPath, tempDir);

    expect(suite.defaultTest).toEqual({ threshold: 0.6 });
    expect(suite.threshold).toBe(0.9);
    expect(suite.experimentConfig?.threshold).toBe(0.9);
  });

  it('parses top-level provider and grader defaults', async () => {
    const evalPath = path.join(tempDir, 'suite-defaults.eval.yaml');
    await writeFile(
      evalPath,
      [
        'name: suite-defaults',
        'providers:',
        '  - openai-candidate',
        'defaults:',
        '  provider: openai-candidate',
        '  grader: openai-grader',
        'prompts:',
        '  - "{{ input }}"',
        'tests:',
        '  - id: one',
        '    criteria: ok',
        '    vars:',
        '      input: hello',
      ].join('\n'),
    );

    const suite = await loadTestSuite(evalPath, tempDir);

    expect(suite.defaults).toEqual({
      provider: 'openai-candidate',
      grader: 'openai-grader',
    });
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
        'prompts:',
        '  - "{{ input }}"',
        'default_test: file://{{ env.AGENTV_REPO_ROOT }}/.agentv/default-test.yaml',
        'tests:',
        '  - id: one',
        '    criteria: ok',
        '    vars:',
        '      input: hello',
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
        'prompts:',
        '  - "{{ input }}"',
        'default_test: ref://global-default',
        'tests:',
        '  - id: one',
        '    vars:',
        '      input: hello',
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
        'prompts:',
        '  - "{{ input }}"',
        'default_test: file://{{ env.AGENTV_REPO_ROOT }}/.agentv/default-test.yaml',
        'tests:',
        '  - id: one',
        '    vars:',
        '      input: hello',
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
        'providers:',
        '  - mini',
        '  - local-codex',
        'tests:',
        '  - id: docs',
        '    vars:',
        '      topic: release notes',
        '    criteria: Writes a concise release-note summary',
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
    expect(suite.targetRefs).toEqual([{ name: 'mini' }, { name: 'local-codex' }]);
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
        '    criteria: Writes a concise release-note summary',
        '  - id: overrides-default',
        '    vars:',
        '      audience: executives',
        '      topic: migration plan',
        '    criteria: Writes an executive migration summary',
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
        'prompts:',
        '  - "{{ input }}"',
        'default_test:',
        '  vars:',
        '    tone: concise',
        '    category: support',
        'tests:',
        '  - id: direct-default',
        '    vars:',
        '      question: How do I reset my password?',
        '      input: "Answer in a {{ tone }} {{ category }} style: {{ question }}"',
        '    criteria: Gives password reset guidance',
        '  - id: direct-override',
        '    vars:',
        '      category: onboarding',
        '      question: Where is the getting started guide?',
        '      input: "Answer in a {{ tone }} {{ category }} style: {{ question }}"',
        '    criteria: Gives getting started guidance',
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
        '    criteria: Gives a concrete release-note explanation',
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

    await expect(loadTestSuite(evalPath, tempDir)).rejects.toThrow(/tests\[0\]\.input/);
  });

  it('parses evaluate_options.budget_usd', async () => {
    const evalPath = path.join(tempDir, 'evaluate-options-budget.eval.yaml');
    await writeFile(
      evalPath,
      [
        'name: evaluate-options-budget-suite',
        'providers:',
        '  - codex',
        'evaluate_options:',
        '  budget_usd: 2.5',
        'prompts:',
        '  - "{{ input }}"',
        'tests:',
        '  - id: one',
        '    criteria: ok',
        '    vars:',
        '      input: hello',
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
        'providers:',
        '  - codex',
        'evaluate_options:',
        '  max_concurrency: 2',
        'prompts:',
        '  - "{{ input }}"',
        'tests:',
        '  - id: one',
        '    criteria: ok',
        '    vars:',
        '      input: hello',
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
        'prompts:',
        '  - "{{ input }}"',
        'tests:',
        '  - id: one',
        '    criteria: ok',
        '    vars:',
        '      input: hello',
      ].join('\n'),
    );

    await expect(loadTestSuite(evalPath, tempDir)).rejects.toThrow(/top-level 'policy'/);
  });

  it('rejects legacy target-shaped provider objects during runtime suite loading', async () => {
    const evalPath = path.join(tempDir, 'top-level-providers.eval.yaml');
    await writeFile(
      evalPath,
      [
        'providers:',
        '  - label: legacy',
        '    provider: mock',
        'prompts:',
        '  - "{{ input }}"',
        'tests:',
        '  - id: one',
        '    criteria: ok',
        '    vars:',
        '      input: hello',
      ].join('\n'),
    );

    await expect(loadTestSuite(evalPath, tempDir)).rejects.toThrow(/providers\[0\]\.id/);
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
        'prompts:',
        '  - "{{ input }}"',
        'tests:',
        '  - id: one',
        '    criteria: ok',
        '    vars:',
        '      input: hello',
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
        'prompts:',
        '  - "{{ input }}"',
        'tests:',
        '  - id: one',
        '    criteria: ok',
        '    vars:',
        '      input: hello',
      ].join('\n'),
    );

    await expect(loadTestSuite(legacyPath, tempDir)).rejects.toThrow(/execution\.target/);

    const removedPath = path.join(tempDir, 'removed.eval.yaml');
    await writeFile(
      removedPath,
      [
        'experiment:',
        '  target: codex',
        'prompts:',
        '  - "{{ input }}"',
        'tests:',
        '  - id: one',
        '    criteria: ok',
        '    vars:',
        '      input: hello',
      ].join('\n'),
    );

    await expect(loadTestSuite(removedPath, tempDir)).rejects.toThrow(
      /top-level 'experiment' must be a string/,
    );
  });

  it('rejects top-level model because provider config owns model overrides', async () => {
    const evalPath = path.join(tempDir, 'camel-policy.eval.yaml');
    await writeFile(
      evalPath,
      [
        'target: codex',
        'model: gpt-5.1',
        'prompts:',
        '  - "{{ input }}"',
        'tests:',
        '  - id: one',
        '    criteria: ok',
        '    vars:',
        '      input: hello',
      ].join('\n'),
    );

    await expect(loadTestSuite(evalPath, tempDir)).rejects.toThrow(/top-level 'model'/);
  });

  it('rejects per-test execution workspace blocks', async () => {
    const evalPath = path.join(tempDir, 'test-execution-workspace.eval.yaml');
    await writeFile(
      evalPath,
      [
        'prompts:',
        '  - "{{ input }}"',
        'tests:',
        '  - id: one',
        '    criteria: ok',
        '    execution:',
        '      workspace:',
        '        mode: static',
        '        path: /tmp/ws',
        '    vars:',
        '      input: hello',
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
        'prompts:',
        '  - "{{ input }}"',
        'tests:',
        '  - id: one',
        '    criteria: ok',
        '    execution:',
        '      target: codex',
        '    vars:',
        '      input: hello',
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
      '- id: b-2\n  input: b2\n  criteria: ok\n- id: b-1\n  input: b1\n  criteria: ok\n',
    );
    await writeFile(
      path.join(casesDir, 'a.cases.yaml'),
      '- id: a-1\n  input: a1\n  criteria: ok\n',
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
        'prompts:',
        '  - "{{ input }}"',
        'tests:',
        '  - id: suite-1',
        '    criteria: ok',
        '    vars:',
        '      input: suite',
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
        'prompts:',
        '  - "{{ input }}"',
        'tests:',
        '  - id: child-case',
        '    criteria: ok',
        '    vars:',
        '      input: child',
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
        'prompts:',
        '  - "{{ input }}"',
        'tests:',
        '  - id: c-case',
        '    criteria: ok',
        '    vars:',
        '      input: deepest',
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
      '- id: selected\n  input: selected\n  criteria: ok\n  metadata:\n    tags: [sql-migration, review]\n    type: e2e\n    priority: high\n- id: wrong-priority\n  input: wrong\n  criteria: ok\n  metadata:\n    tags: [sql-migration]\n    type: e2e\n    priority: low\n',
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
      '- id: inherited-tag\n  input: inherited\n  criteria: ok\n- id: case-tag\n  input: case\n  criteria: ok\n  metadata:\n    tags: [review]\n',
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
        'providers:',
        '  - child-target',
        'threshold: 0.2',
        'timeout_seconds: 10',
        'evaluate_options:',
        '  budget_usd: 0.5',
        'environment:',
        '  type: host',
        '  workdir: ./child-workspace',
        'assert:',
        '  - type: contains',
        '    value: child',
        'prompts:',
        '  - "{{ input }}"',
        'tests:',
        '  - id: child-case',
        '    criteria: ok',
        '    vars:',
        '      input:',
        '        - role: user',
        '          content: child shared input',
        '        - role: user',
        '          content: child case input',
      ].join('\n'),
    );
    const parentPath = path.join(tempDir, 'parent.eval.yaml');
    await writeFile(
      parentPath,
      [
        'name: parent-suite',
        'providers:',
        '  - parent-target',
        'threshold: 0.8',
        'evaluate_options:',
        '  repeat:',
        '    count: 3',
        '    strategy: pass_any',
        '  budget_usd: 1.5',
        'timeout_seconds: 30',
        'assert:',
        '  - type: contains',
        '    value: parent',
        'prompts:',
        '  - "{{ input }}"',
        'tests:',
        '  - include: child.eval.yaml',
        '    type: suite',
      ].join('\n'),
    );

    const suite = await loadTestSuite(parentPath, tempDir);
    const test = suite.tests[0];

    expect(suite.experimentConfig?.target).toBe('parent-target');
    expect(suite.experimentConfig?.threshold).toBe(0.8);
    expect(suite.experimentConfig?.repeat).toMatchObject({ count: 3, strategy: 'pass_any' });
    expect(test.run).toBeUndefined();
    expect(test.suite).toBe('child-suite');
    expect(test.environment?.workdir).toBe(path.join(tempDir, 'child-workspace'));
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
        'providers:',
        '  - codex',
        'evaluate_options:',
        '  repeat:',
        '    count: 4',
        '    strategy: pass_all',
        'prompts:',
        '  - "{{ input }}"',
        'tests:',
        '  - id: global-repeat',
        '    criteria: ok',
        '    vars:',
        '      input: hello',
        '  - id: case-repeat-count',
        '    criteria: ok',
        '    options:',
        '      repeat: 2',
        '    vars:',
        '      input: hello',
        '  - id: case-repeat-object',
        '    criteria: ok',
        '    run:',
        '      threshold: 0.9',
        '    options:',
        '      repeat:',
        '        count: 3',
        '        strategy: mean',
        '        early_exit: false',
        '    vars:',
        '      input: hello',
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

  it('rejects parent environment when importing eval suites with type: suite', async () => {
    await writeFile(
      path.join(tempDir, 'child.eval.yaml'),
      [
        'name: child-suite',
        'environment:',
        '  type: host',
        '  workdir: ./child-workspace',
        'prompts:',
        '  - "{{ input }}"',
        'tests:',
        '  - id: child-case',
        '    criteria: ok',
        '    vars:',
        '      input: child case input',
      ].join('\n'),
    );
    const parentPath = path.join(tempDir, 'parent.eval.yaml');
    await writeFile(
      parentPath,
      [
        'name: parent-suite',
        'environment:',
        '  type: host',
        '  workdir: ./parent-workspace',
        'tests:',
        '  - include: child.eval.yaml',
        '    type: suite',
        '',
      ].join('\n'),
    );

    await expect(loadTestSuite(parentPath, tempDir)).rejects.toThrow(
      /Parent environment is not allowed/,
    );
  });

  it('rejects removed parent experiment blocks when importing eval suites with type: suite', async () => {
    await writeFile(
      path.join(tempDir, 'child.eval.yaml'),
      [
        'name: child-suite',
        'prompts:',
        '  - "{{ input }}"',
        'tests:',
        '  - id: child-case',
        '    criteria: ok',
        '    vars:',
        '      input: child case input',
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
        'prompts:',
        '  - "{{ input }}"',
        'tests:',
        '  - id: child-case',
        '    criteria: ok',
        '    vars:',
        '      input: child case input',
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
        'prompts:',
        '  - "{{ input }}"',
        'tests:',
        '  - id: child-default',
        '    criteria: ok',
        '    vars:',
        '      input: default',
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
        'prompts:',
        '  - "{{ input }}"',
        'tests:',
        '  - id: child-default',
        '    criteria: ok',
        '    vars:',
        '      input: default',
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
        'prompts:',
        '  - "{{ input }}"',
        'tests:',
        '  - id: child-default',
        '    criteria: ok',
        '    vars:',
        '      input: default',
        '  - id: child-critical',
        '    criteria: ok',
        '    run:',
        '      threshold: 1',
        '      repeat:',
        '        count: 1',
        '    vars:',
        '      input: critical',
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
      [
        'name: child-a',
        'prompts:',
        '  - "{{ input }}"',
        'tests:',
        '  - id: a',
        '    criteria: ok',
        '    vars:',
        '      input: a',
      ].join('\n'),
    );
    await writeFile(
      path.join(tempDir, 'child-b.eval.yaml'),
      [
        'name: child-b',
        'prompts:',
        '  - "{{ input }}"',
        'tests:',
        '  - id: b',
        '    criteria: ok',
        '    vars:',
        '      input: b',
      ].join('\n'),
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

  it('rejects top-level imports during suite loading', async () => {
    const parentPath = path.join(tempDir, 'parent.eval.yaml');
    await writeFile(
      parentPath,
      ['name: parent-suite', 'imports:', '  tests:', '    - path: cases.yaml', 'tests: []'].join(
        '\n',
      ),
    );

    await expect(loadTestSuite(parentPath, tempDir)).rejects.toThrow(
      /Top-level 'imports' is not supported.*Run eval files directly.*tests: file:\/\/\.\.\..*prompts: file:\/\/\.\.\..*default_test: file:\/\/\.\.\..*environment: file:\/\/\.\.\./,
    );
  });

  it('loads raw rows through tests file refs in parent context', async () => {
    await writeFile(
      path.join(tempDir, 'smoke.jsonl'),
      '{"id":"jsonl-case","input":"jsonl input","criteria":"ok"}\n',
    );
    await writeFile(
      path.join(tempDir, 'regressions.yaml'),
      '- id: yaml-case\n  input: yaml input\n  criteria: ok\n',
    );
    const parentPath = path.join(tempDir, 'parent.eval.yaml');
    await writeFile(
      parentPath,
      [
        'name: parent-suite',
        'environment:',
        '  type: host',
        '  workdir: ./parent-workspace',
        'assert:',
        '  - type: contains',
        '    value: parent',
        'prompts:',
        '  - - role: user',
        '      content: parent shared input',
        '    - role: user',
        '      content: "{{ input }}"',
        'tests:',
        '  - file://smoke.jsonl',
        '  - file://regressions.yaml',
        '  - id: inline-case',
        '    criteria: ok',
        '    vars:',
        '      input: inline input',
        '',
      ].join('\n'),
    );

    const suite = await loadTestSuite(parentPath, tempDir);
    const byId = new Map(suite.tests.map((test) => [test.id, test]));

    expect(suite.tests.map((test) => test.id)).toEqual(['jsonl-case', 'yaml-case', 'inline-case']);
    for (const id of ['jsonl-case', 'yaml-case', 'inline-case']) {
      expect(byId.get(id)?.suite).toBe('parent-suite');
      expect(byId.get(id)?.environment?.workdir).toBe(path.join(tempDir, 'parent-workspace'));
      expect(byId.get(id)?.assertions?.[0]).toMatchObject({ type: 'contains', value: 'parent' });
    }
    expect(byId.get('jsonl-case')?.input.map((message) => message.content)).toEqual([
      'parent shared input',
      'jsonl input',
    ]);
  });

  it('warns but supports legacy tests include entries during migration', async () => {
    await writeFile(
      path.join(tempDir, 'child.eval.yaml'),
      [
        'name: child-suite',
        'prompts:',
        '  - "{{ input }}"',
        'tests:',
        '  - id: child-case',
        '    criteria: ok',
        '    vars:',
        '      input: child',
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

    expect(
      warnings.some(
        (message) =>
          message.includes('tests[].include with type: suite is deprecated') &&
          message.includes('Run eval files directly'),
      ),
    ).toBe(true);
  });

  it('warns for legacy/confusing tests include entries', async () => {
    await writeFile(
      path.join(tempDir, 'child.eval.yaml'),
      [
        'name: child-suite',
        'providers:',
        '  - child-target',
        'prompts:',
        '  - "{{ input }}"',
        'tests:',
        '  - id: child-case',
        '    vars:',
        '      input: child',
      ].join('\n'),
    );
    const parentPath = path.join(tempDir, 'parent.eval.yaml');
    await writeFile(
      parentPath,
      [
        'name: parent-suite',
        'providers:',
        '  - parent-target',
        'tests:',
        '  - include: child.eval.yaml',
        '    type: suite',
        '',
      ].join('\n'),
    );

    const result = await validateEvalFile(parentPath);

    expect(result.valid).toBe(true);
    const warnings = result.errors.filter((error) => error.severity === 'warning');
    expect(
      warnings.some(
        (error) =>
          error.message.includes('tests[].include with type: suite is deprecated') &&
          error.message.includes('CLI multi-file selection') &&
          error.message.includes('tags'),
      ),
    ).toBe(true);
    expect(
      warnings.some((error) =>
        error.message.includes('child providers and run controls are ignored'),
      ),
    ).toBe(true);
  });

  it('type: tests imports only raw cases and applies parent suite context', async () => {
    await writeFile(
      path.join(tempDir, 'child.eval.yaml'),
      [
        'name: child-suite',
        'assert:',
        '  - type: contains',
        '    value: child',
        'tests:',
        '  - id: raw-case',
        '    input: raw case input',
        '    criteria: ok',
      ].join('\n'),
    );
    const parentPath = path.join(tempDir, 'parent.eval.yaml');
    await writeFile(
      parentPath,
      [
        'name: parent-suite',
        'environment:',
        '  type: host',
        '  workdir: ./parent-workspace',
        'assert:',
        '  - type: contains',
        '    value: parent',
        'prompts:',
        '  - - role: user',
        '      content: parent shared input',
        '    - role: user',
        '      content: "{{ input }}"',
        'tests:',
        '  - include: child.eval.yaml',
        '    type: tests',
      ].join('\n'),
    );

    const suite = await loadTestSuite(parentPath, tempDir);
    const test = suite.tests[0];

    expect(test.suite).toBe('parent-suite');
    expect(test.input.map((message) => message.content)).toEqual([
      'parent shared input',
      'raw case input',
    ]);
    expect(test.environment?.workdir).toBe(path.join(tempDir, 'parent-workspace'));
    expect(test.assertions?.[0]).toMatchObject({ type: 'contains', value: 'parent' });
  });
});
