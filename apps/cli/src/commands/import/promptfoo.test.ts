import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { convertPromptfooToAgentvSuite, convertPromptfooToAgentvYaml } from './promptfoo.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('promptfoo import', () => {
  it('converts inline promptfoo configs into AgentV suite defaults and tests', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'agentv-promptfoo-'));
    tempDirs.push(dir);

    const configPath = path.join(dir, 'promptfooconfig.yaml');
    await writeFile(
      configPath,
      `
description: Sample promptfoo suite
prompts:
  - "Answer clearly: {{question}}"
providers:
  - openai:gpt-5-mini
defaultTest:
  assert:
    - type: contains
      value: Answer
tests:
  - id: capital
    description: Capital answer stays deterministic
    vars:
      question: What is the capital of France?
    assert:
      - type: equals
        value: Paris
`,
      'utf8',
    );

    const suite = await convertPromptfooToAgentvSuite({ inputPath: configPath });

    expect(suite.name).toBe('promptfooconfig');
    expect(suite.description).toBe('Sample promptfoo suite');
    expect(suite.execution).toEqual({ targets: ['openai-gpt-5-mini'] });
    expect(suite.assertions).toEqual([{ type: 'contains', value: 'Answer' }]);
    expect(suite.tests).toHaveLength(1);
    expect(suite.tests[0]).toMatchObject({
      id: 'capital',
      criteria: 'Capital answer stays deterministic',
      input: 'Answer clearly: {{question}}',
      vars: { question: 'What is the capital of France?' },
      assertions: [{ type: 'equals', value: 'Paris' }],
      metadata: {
        promptfoo: {
          vars: { question: 'What is the capital of France?' },
          prompt_label: 'prompt-1',
        },
      },
    });
  });

  it('loads prompt files and external JSONL tests', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'agentv-promptfoo-'));
    tempDirs.push(dir);

    const promptPath = path.join(dir, 'prompt.txt');
    const testsPath = path.join(dir, 'tests.jsonl');
    const configPath = path.join(dir, 'promptfooconfig.yaml');

    await writeFile(promptPath, 'Please answer: {{question}}', 'utf8');
    await writeFile(
      testsPath,
      [
        JSON.stringify({
          id: 'math',
          vars: { question: 'What is 2 + 2?' },
          assert: [{ type: 'equals', value: '4' }],
        }),
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      configPath,
      `
prompts:
  - file://./prompt.txt
tests: file://./tests.jsonl
`,
      'utf8',
    );

    const yaml = await convertPromptfooToAgentvYaml(configPath);
    expect(yaml).toContain('# Converted from promptfoo config:');
    expect(yaml).toContain('id: math');
    expect(yaml).toContain('input: "Please answer: {{question}}"');
    expect(yaml).toContain('vars:');
    expect(yaml).toContain('type: equals');
  });

  it('imports promptfoo CSV datasets with __expected columns', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'agentv-promptfoo-'));
    tempDirs.push(dir);

    const testsPath = path.join(dir, 'tests.csv');
    const configPath = path.join(dir, 'promptfooconfig.yaml');

    await writeFile(
      testsPath,
      [
        '__description,question,__expected,__expected2,__threshold,__metadata:category',
        '"Capital question","What is the capital of France?","equals: Paris","contains: Paris",0.8,geography',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      configPath,
      `
prompts:
  - "Question: {{question}}"
tests: file://./tests.csv
`,
      'utf8',
    );

    const suite = await convertPromptfooToAgentvSuite({ inputPath: configPath });
    expect(suite.tests).toHaveLength(1);
    expect(suite.tests[0]).toMatchObject({
      id: 'capital-question',
      criteria: 'Capital question',
      input: 'Question: {{question}}',
      vars: {
        question: 'What is the capital of France?',
      },
      assertions: [
        { type: 'equals', value: 'Paris' },
        { type: 'contains', value: 'Paris' },
      ],
      execution: {
        threshold: 0.8,
      },
      metadata: {
        category: 'geography',
        promptfoo: {
          vars: {
            question: 'What is the capital of France?',
          },
        },
      },
    });
  });

  it('fails clearly on unsupported promptfoo javascript assertions', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'agentv-promptfoo-'));
    tempDirs.push(dir);

    const configPath = path.join(dir, 'promptfooconfig.yaml');
    await writeFile(
      configPath,
      `
prompts:
  - "Hello {{name}}"
tests:
  - vars:
      name: Chris
    assert:
      - type: javascript
        value: output.includes("Chris")
`,
      'utf8',
    );

    await expect(convertPromptfooToAgentvSuite({ inputPath: configPath })).rejects.toThrow(
      "Unsupported promptfoo assertion 'javascript'",
    );
  });

  it('preserves explicit promptfoo test ids verbatim', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'agentv-promptfoo-'));
    tempDirs.push(dir);

    const configPath = path.join(dir, 'promptfooconfig.yaml');
    await writeFile(
      configPath,
      `
prompts:
  - "Hello {{name}}"
tests:
  - id: "---special/id---"
    vars:
      name: Chris
    assert:
      - type: contains
        value: Chris
`,
      'utf8',
    );

    const suite = await convertPromptfooToAgentvSuite({ inputPath: configPath });
    expect(suite.tests[0]?.id).toBe('---special/id---');
  });
});
