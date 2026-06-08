import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadTests } from '../../src/evaluation/yaml-parser.js';

describe('eval source traceability metadata', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentv-source-trace-'));
    await mkdir(path.join(tempDir, '.agentv', 'templates'), { recursive: true });
    await mkdir(path.join(tempDir, 'graders'), { recursive: true });
    await mkdir(path.join(tempDir, 'snippets'), { recursive: true });

    await writeFile(
      path.join(tempDir, '.agentv', 'templates', 'shared.yaml'),
      `assertions:
  - name: shared-contains
    type: contains
    value: ok
`,
    );
    await writeFile(path.join(tempDir, 'snippets', 'input.txt'), 'fixture input\n');
    await writeFile(path.join(tempDir, 'graders', 'prompt.md'), 'Grade {{ output }} with care.\n');
    await writeFile(path.join(tempDir, 'graders', 'prompt.ts'), 'console.log("prompt");\n');
    await writeFile(path.join(tempDir, 'graders', 'code.ts'), 'console.log("{}");\n');
    await writeFile(path.join(tempDir, 'graders', 'pre.ts'), 'console.log("pre");\n');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('attaches eval source snapshots, grader definitions, and resolved source references', async () => {
    const evalFile = path.join(tempDir, 'trace.eval.yaml');
    await writeFile(
      evalFile,
      `assertions:
  - include: shared
tests:
  - id: trace-case
    criteria: ok
    input:
      - role: user
        content:
          - type: file
            value: snippets/input.txt
          - type: text
            value: Review the fixture.
    assertions:
      - name: prompt-file
        type: llm-grader
        prompt: file://graders/prompt.md
      - name: prompt-script
        type: llm-grader
        prompt:
          command: ["bun", "graders/prompt.ts"]
          config:
            secret_token: should-not-persist
            apiKey: should-not-persist
            secret-token: should-not-persist
      - name: code-check
        type: code-grader
        command: ["bun", "graders/code.ts"]
        cwd: graders
      - name: preprocessed
        type: llm-grader
        prompt: Inline prompt
        preprocessors:
          - type: text
            command: ["bun", "graders/pre.ts"]
`,
    );

    const tests = await loadTests(evalFile, tempDir);

    expect(tests).toHaveLength(1);
    const source = tests[0]?.source;
    expect(source).toBeDefined();
    expect(source?.evalFileRepoPath).toBe('trace.eval.yaml');
    expect(source?.testSnapshotYaml).toContain('id: trace-case');

    const kinds = source?.references.map((reference) => reference.kind).sort();
    expect(kinds).toEqual([
      'assertion_template',
      'code_grader_command',
      'code_grader_cwd',
      'input_file',
      'llm_grader_prompt',
      'preprocessor_command',
      'prompt_script',
    ]);

    const promptFile = source?.references.find(
      (reference) => reference.kind === 'llm_grader_prompt',
    );
    expect(promptFile?.displayPath).toBe('graders/prompt.md');
    expect(promptFile?.resolvedPath).toBe(path.join(tempDir, 'graders', 'prompt.md'));

    const codeCommand = source?.references.find(
      (reference) => reference.kind === 'code_grader_command',
    );
    expect(codeCommand?.command).toEqual(['bun', 'graders/code.ts']);
    expect(codeCommand?.resolvedPath).toBe(path.join(tempDir, 'graders', 'code.ts'));

    const promptScriptDefinition = source?.graderDefinitions.find(
      (definition) => definition.name === 'prompt-script',
    );
    expect(promptScriptDefinition?.definition).toMatchObject({
      name: 'prompt-script',
      type: 'llm-grader',
      config: {
        secret_token: '[redacted]',
        apiKey: '[redacted]',
        'secret-token': '[redacted]',
      },
    });
    expect(promptScriptDefinition?.definition).not.toHaveProperty('resolvedPromptScript');
  });
});
