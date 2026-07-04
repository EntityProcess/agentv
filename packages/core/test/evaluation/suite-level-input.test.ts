import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadTests } from '../../src/evaluation/yaml-parser.js';

describe('suite-level input', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = path.join(os.tmpdir(), `agentv-suite-input-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('prepends suite-level input string to each test input', async () => {
    await writeFile(
      path.join(tempDir, 'string-input.eval.yaml'),
      `prompts:
  - "{{ input }}"
tests:
  - id: test-1
    criteria: Responds helpfully
    vars:
      input:
        - role: user
          content: You are a helpful assistant.
        - role: user
          content: What is 2+2?
  - id: test-2
    criteria: Responds accurately
    vars:
      input:
        - role: user
          content: You are a helpful assistant.
        - role: user
          content: What is the capital of France?
`,
    );

    const tests = await loadTests(path.join(tempDir, 'string-input.eval.yaml'), tempDir);

    expect(tests).toHaveLength(2);

    // Suite string input wrapped as { role: "user", content: "..." } and prepended
    expect(tests[0].input).toHaveLength(2);
    expect(tests[0].input[0]).toEqual({ role: 'user', content: 'You are a helpful assistant.' });
    expect(tests[0].input[1]).toEqual({ role: 'user', content: 'What is 2+2?' });

    expect(tests[1].input).toHaveLength(2);
    expect(tests[1].input[0]).toEqual({ role: 'user', content: 'You are a helpful assistant.' });
    expect(tests[1].input[1]).toEqual({
      role: 'user',
      content: 'What is the capital of France?',
    });
  });

  it('prepends suite-level input block scalar to each test input', async () => {
    await writeFile(
      path.join(tempDir, 'block-input.eval.yaml'),
      `prompts:
  - "{{ input }}"
tests:
  - id: block-test
    criteria: Uses shared instructions
    vars:
      input:
        - role: user
          content: |
            Read AGENTS.md before answering.
            Mention tradeoffs.
        - role: user
          content: Summarize the repo.
`,
    );

    const tests = await loadTests(path.join(tempDir, 'block-input.eval.yaml'), tempDir);

    expect(tests).toHaveLength(1);
    expect(tests[0].input).toHaveLength(2);
    expect(tests[0].input[0]).toEqual({
      role: 'user',
      content: 'Read AGENTS.md before answering.\nMention tradeoffs.\n',
    });
    expect(tests[0].input[1]).toEqual({ role: 'user', content: 'Summarize the repo.' });
  });

  it('prepends suite-level structured input object to each test input', async () => {
    await writeFile(
      path.join(tempDir, 'object-input.eval.yaml'),
      `prompts:
  - "{{ input }}"
tests:
  - id: object-test
    criteria: Uses shared structured context
    vars:
      input:
        - role: user
          content:
            instruction: Classify the request
            labels:
              - bug
              - feature
        - role: user
          content: The login button is broken.
`,
    );

    const tests = await loadTests(path.join(tempDir, 'object-input.eval.yaml'), tempDir);

    expect(tests).toHaveLength(1);
    expect(tests[0].input).toHaveLength(2);
    expect(tests[0].input[0]).toEqual({
      role: 'user',
      content: {
        instruction: 'Classify the request',
        labels: ['bug', 'feature'],
      },
    });
    expect(tests[0].input[1]).toEqual({
      role: 'user',
      content: 'The login button is broken.',
    });
  });

  it('prepends suite-level input message array to each test input', async () => {
    await writeFile(
      path.join(tempDir, 'array-input.eval.yaml'),
      `prompts:
  - "{{ input }}"
tests:
  - id: review-1
    criteria: Provides code review
    vars:
      input:
        - role: system
          content: You are a code reviewer.
        - role: user
          content: Review the following code.
        - role: user
          content: function add(a, b) { return a + b; }
`,
    );

    const tests = await loadTests(path.join(tempDir, 'array-input.eval.yaml'), tempDir);

    expect(tests).toHaveLength(1);
    expect(tests[0].input).toHaveLength(3);
    expect(tests[0].input[0]).toEqual({ role: 'system', content: 'You are a code reviewer.' });
    expect(tests[0].input[1]).toEqual({ role: 'user', content: 'Review the following code.' });
    expect(tests[0].input[2]).toEqual({
      role: 'user',
      content: 'function add(a, b) { return a + b; }',
    });
  });

  it('does not change test input when no suite-level input is present', async () => {
    await writeFile(
      path.join(tempDir, 'no-suite-input.eval.yaml'),
      `prompts:
  - "{{ input }}"
tests:
  - id: test-1
    criteria: Works normally
    vars:
      input: Hello world
`,
    );

    const tests = await loadTests(path.join(tempDir, 'no-suite-input.eval.yaml'), tempDir);

    expect(tests).toHaveLength(1);
    expect(tests[0].input).toHaveLength(1);
    expect(tests[0].input[0]).toEqual({ role: 'user', content: 'Hello world' });
  });

  it('skips suite-level input when test has execution.skip_defaults: true', async () => {
    await writeFile(
      path.join(tempDir, 'skip-defaults.eval.yaml'),
      `prompts:
  - "{{ input }}"
tests:
  - id: with-defaults
    criteria: Uses suite input
    vars:
      input:
        - role: user
          content: System prompt context
        - role: user
          content: Query A
  - id: without-defaults
    criteria: Skips suite input
    execution:
      skip_defaults: true
    vars:
      input: Query B
`,
    );

    const tests = await loadTests(path.join(tempDir, 'skip-defaults.eval.yaml'), tempDir);

    expect(tests).toHaveLength(2);

    // First test should have suite input prepended
    expect(tests[0].input).toHaveLength(2);
    expect(tests[0].input[0]).toEqual({ role: 'user', content: 'System prompt context' });
    expect(tests[0].input[1]).toEqual({ role: 'user', content: 'Query A' });

    // Second test with skip_defaults should only have its own input
    expect(tests[1].input).toHaveLength(1);
    expect(tests[1].input[0]).toEqual({ role: 'user', content: 'Query B' });
  });

  it('applies suite-level input to external cases file (string path)', async () => {
    await writeFile(
      path.join(tempDir, 'ext-cases.yaml'),
      `- id: ext-1
  criteria: External test
  vars:
    input: External query
`,
    );

    await writeFile(
      path.join(tempDir, 'suite-external.eval.yaml'),
      `prompts:
  - - role: user
      content: Shared context
    - role: user
      content: "{{ input }}"
tests: ./ext-cases.yaml
`,
    );

    const tests = await loadTests(path.join(tempDir, 'suite-external.eval.yaml'), tempDir);

    expect(tests).toHaveLength(1);
    expect(tests[0].input).toHaveLength(2);
    expect(tests[0].input[0]).toEqual({ role: 'user', content: 'Shared context' });
    expect(tests[0].input[1]).toEqual({ role: 'user', content: 'External query' });
  });

  it('includes suite-level input text in the question field', async () => {
    await writeFile(
      path.join(tempDir, 'question-field.eval.yaml'),
      `prompts:
  - "{{ input }}"
tests:
  - id: question-test
    criteria: Has combined question
    vars:
      input:
        - role: user
          content: "Context: You are helpful."
        - role: user
          content: What is 2+2?
`,
    );

    const tests = await loadTests(path.join(tempDir, 'question-field.eval.yaml'), tempDir);

    expect(tests).toHaveLength(1);
    // question field should include text from both suite and test input
    expect(tests[0].question).toContain('Context: You are helpful.');
    expect(tests[0].question).toContain('What is 2+2?');
  });

  it('handles suite-level input with test-level message array input', async () => {
    await writeFile(
      path.join(tempDir, 'mixed-formats.eval.yaml'),
      `prompts:
  - "{{ input }}"
tests:
  - id: mixed-test
    criteria: Handles mixed formats
    vars:
      input:
        - role: user
          content: Shared system context
        - role: user
          content: First user message
        - role: assistant
          content: I understand.
        - role: user
          content: Follow-up question
`,
    );

    const tests = await loadTests(path.join(tempDir, 'mixed-formats.eval.yaml'), tempDir);

    expect(tests).toHaveLength(1);
    expect(tests[0].input).toHaveLength(4);
    expect(tests[0].input[0]).toEqual({ role: 'user', content: 'Shared system context' });
    expect(tests[0].input[1]).toEqual({ role: 'user', content: 'First user message' });
    expect(tests[0].input[2]).toEqual({ role: 'assistant', content: 'I understand.' });
    expect(tests[0].input[3]).toEqual({ role: 'user', content: 'Follow-up question' });
  });

  it('applies per-test vars to suite and test input templates', async () => {
    await writeFile(
      path.join(tempDir, 'templated-input.eval.yaml'),
      `prompts:
  - "{{ input }}"
tests:
  - id: templated
    vars:
      question: What is the capital of France?
      expected_answer: Paris
      input:
        - role: user
          content: "Answer clearly: {{question}}"
        - role: user
          content: "Question: {{question}}"
        - role: assistant
          content: Thinking about {{question}}
        - role: user
          content: Final answer only.
    criteria: Answers {{question}} correctly
    expected_output: "{{expected_answer}}"
    metadata:
      untouched: "{{question}}"
`,
    );

    const tests = await loadTests(path.join(tempDir, 'templated-input.eval.yaml'), tempDir);

    expect(tests).toHaveLength(1);
    expect(tests[0].criteria).toBe('Answers What is the capital of France? correctly');
    expect(tests[0].question).toContain('Answer clearly: What is the capital of France?');
    expect(tests[0].input[0]).toEqual({
      role: 'user',
      content: 'Answer clearly: What is the capital of France?',
    });
    expect(tests[0].input[1]).toEqual({
      role: 'user',
      content: 'Question: What is the capital of France?',
    });
    expect(tests[0].input[2]).toEqual({
      role: 'assistant',
      content: 'Thinking about What is the capital of France?',
    });
    expect(tests[0].expected_output).toEqual([{ role: 'assistant', content: 'Paris' }]);
    expect(tests[0].metadata).toEqual({ untouched: '{{question}}' });
  });

  it('applies namespaced vars with loops in suite and test input templates', async () => {
    await writeFile(
      path.join(tempDir, 'templated-namespaced-input.eval.yaml'),
      `prompts:
  - "{{ input }}"
tests:
  - id: templated-namespaced
    vars:
      group:
        items:
          - alpha
          - beta
      input:
        - role: user
          content: |
            Items:
            {% for item in vars.group.items %}- {{ item | upper }}
            {% endfor %}
        - role: user
          content: "Question: {{ vars.group.items[0] }}"
    criteria: Mentions {{ vars.group.items | length }} items
`,
    );

    const tests = await loadTests(
      path.join(tempDir, 'templated-namespaced-input.eval.yaml'),
      tempDir,
    );

    expect(tests).toHaveLength(1);
    expect(tests[0].criteria).toBe('Mentions 2 items');
    expect(tests[0].input[0]).toEqual({
      role: 'user',
      content: 'Items:\n- ALPHA\n- BETA\n\n',
    });
    expect(tests[0].input[1]).toEqual({
      role: 'user',
      content: 'Question: alpha',
    });
  });

  it('loads custom nunjucks_filters for eval-time rendering', async () => {
    const filterPath = path.join(tempDir, 'slug-filter.ts');
    await writeFile(
      filterPath,
      'export default function slug(value: unknown) { return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }\n',
    );
    await writeFile(
      path.join(tempDir, 'templated-custom-filter.eval.yaml'),
      `nunjucks_filters:
  slug: ./slug-filter.ts
prompts:
  - "{{ input }}"
tests:
  - id: filter-test
    vars:
      title: Hello AgentV
      input: Write {{ vars.title | slug }}
    criteria: Slug is {{ vars.title | slug }}
`,
    );

    const tests = await loadTests(path.join(tempDir, 'templated-custom-filter.eval.yaml'), tempDir);

    expect(tests).toHaveLength(1);
    expect(tests[0].criteria).toBe('Slug is hello-agentv');
    expect(tests[0].input[0]).toEqual({ role: 'user', content: 'Write hello-agentv' });
  });

  it('expands string array vars into multiple rendered rows', async () => {
    await writeFile(
      path.join(tempDir, 'templated-array-vars.eval.yaml'),
      `prompts:
  - "{{ input }}"
tests:
  - id: fruit-{{ vars.fruit }}
    vars:
      fruit:
        - apple
        - pear
      color:
        - red
        - green
      tags:
        - stable
      input: Describe {{ vars.color }} {{ vars.fruit }}
    criteria: "{{ vars.color }} {{ vars.fruit }}"
`,
    );

    const tests = await loadTests(path.join(tempDir, 'templated-array-vars.eval.yaml'), tempDir);

    expect(tests.map((test) => test.id)).toEqual([
      'fruit-apple',
      'fruit-apple',
      'fruit-pear',
      'fruit-pear',
    ]);
    expect(tests.map((test) => test.criteria)).toEqual([
      'red apple',
      'green apple',
      'red pear',
      'green pear',
    ]);
    expect(tests.map((test) => test.input[0]?.content)).toEqual([
      'Describe red apple',
      'Describe green apple',
      'Describe red pear',
      'Describe green pear',
    ]);
  });

  it('renders then parses chat-array prompt strings', async () => {
    await writeFile(
      path.join(tempDir, 'templated-chat-array.eval.yaml'),
      `prompts:
  - "{{ input }}"
tests:
  - id: chat-array
    vars:
      topic: templating
      input:
        - role: system
          content: "You review {{ vars.topic }}"
        - role: user
          content: "Explain {{ vars.topic }}"
    criteria: Uses chat array
`,
    );

    const tests = await loadTests(path.join(tempDir, 'templated-chat-array.eval.yaml'), tempDir);

    expect(tests).toHaveLength(1);
    expect(tests[0].input).toEqual([
      { role: 'system', content: 'You review templating' },
      { role: 'user', content: 'Explain templating' },
    ]);
  });

  it('renders assertion values and metrics with per-test vars', async () => {
    await writeFile(
      path.join(tempDir, 'templated-assertions.eval.yaml'),
      `prompts:
  - "{{ input }}"
tests:
  - id: assertions
    vars:
      expected: DENIED
      metric_name: policy
      input: Check access
    assert:
      - type: contains
        metric: "{{ vars.metric_name }}_decision"
        value: "{{ vars.expected }}"
`,
    );

    const tests = await loadTests(path.join(tempDir, 'templated-assertions.eval.yaml'), tempDir);

    expect(tests).toHaveLength(1);
    expect(tests[0].assertions?.[0]).toMatchObject({
      type: 'contains',
      value: 'DENIED',
      name: 'policy_decision',
    });
  });

  it('applies per-test vars inside conversation turns', async () => {
    await writeFile(
      path.join(tempDir, 'templated-turns.eval.yaml'),
      `prompts:
  - "{{ input }}"
tests:
  - id: conversation
    vars:
      bug: parser null check
      input: Fix {{bug}}
    mode: conversation
    turns:
      - input: Fix {{bug}}
        expected_output: Fixed {{bug}}
        assert:
          - Mentions {{bug}}
`,
    );

    const tests = await loadTests(path.join(tempDir, 'templated-turns.eval.yaml'), tempDir);

    expect(tests).toHaveLength(1);
    expect(tests[0].turns).toEqual([
      {
        input: 'Fix parser null check',
        expected_output: 'Fixed parser null check',
        assertions: ['Mentions parser null check'],
      },
    ]);
  });
});
