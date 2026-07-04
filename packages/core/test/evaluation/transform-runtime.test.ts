import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runEvalCase, runEvaluation } from '../../src/evaluation/orchestrator.js';
import type { ResolvedTarget } from '../../src/evaluation/providers/targets.js';
import type {
  Provider,
  ProviderRequest,
  ProviderResponse,
} from '../../src/evaluation/providers/types.js';
import type { EvalTest } from '../../src/evaluation/types.js';
import { loadTests } from '../../src/evaluation/yaml-parser.js';

class StaticProvider implements Provider {
  readonly id: string;
  readonly kind = 'mock' as const;
  readonly targetName: string;
  lastRequest?: ProviderRequest;

  constructor(
    targetName: string,
    private readonly response: ProviderResponse,
  ) {
    this.id = `mock:${targetName}`;
    this.targetName = targetName;
  }

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    this.lastRequest = request;
    return this.response;
  }
}

const target: ResolvedTarget = {
  name: 'mock',
  kind: 'mock',
  config: { response: 'raw' },
};

const evaluatorRegistry = {
  'llm-grader': {
    kind: 'llm-grader',
    async evaluate() {
      return {
        score: 1,
        verdict: 'pass' as const,
        assertions: [{ text: 'default grader', passed: true }],
        expectedAspectCount: 1,
      };
    },
  },
};

function tempDir(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

function baseEvalCase(overrides: Partial<EvalTest> = {}): EvalTest {
  return {
    id: 'case-1',
    suite: 'transform-suite',
    question: 'Grade the answer',
    input: [{ role: 'user', content: 'Grade the answer' }],
    expected_output: [],
    reference_answer: '',
    file_paths: [],
    criteria: 'Output should satisfy assertions',
    ...overrides,
  };
}

describe('Promptfoo-compatible transform runtime', () => {
  it('loads default_test options.transform and lets test options.transform override it', async () => {
    const dir = tempDir('agentv-transform-loader-');
    try {
      const transformPath = path.join(dir, 'default-transform.js');
      writeFileSync(transformPath, 'export default (output) => `${output}|default`;\n', 'utf8');
      const evalPath = path.join(dir, 'suite.eval.yaml');
      writeFileSync(
        evalPath,
        `
default_test:
  options:
    transform: file://default-transform.js
tests:
  - id: inherited
    input: say hi
    assert:
      - type: contains
        value: default
  - id: override
    input: say hi
    options:
      transform: output + "|override"
    assert:
      - type: contains
        value: override
`,
        'utf8',
      );

      const tests = await loadTests(evalPath, dir);

      expect(tests[0]?.outputTransform).toBe(`file://${transformPath}`);
      expect(tests[1]?.outputTransform).toBe('output + "|override"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects deprecated postprocess with transform guidance', async () => {
    const dir = tempDir('agentv-transform-postprocess-');
    try {
      const evalPath = path.join(dir, 'suite.eval.yaml');
      writeFileSync(
        evalPath,
        `
default_test:
  options:
    postprocess: output.trim()
tests:
  - id: postprocess
    input: say hi
    assert:
      - type: contains
        value: hi
`,
        'utf8',
      );

      await expect(loadTests(evalPath, dir)).rejects.toThrow(
        'default_test.options.postprocess has been removed. Use default_test.options.transform instead.',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects test and assertion postprocess with transform guidance', async () => {
    const dir = tempDir('agentv-transform-test-postprocess-');
    try {
      const evalPath = path.join(dir, 'suite.eval.yaml');
      writeFileSync(
        evalPath,
        `
tests:
  - id: test-postprocess
    input: say hi
    options:
      postprocess: output.trim()
    assert:
      - type: contains
        value: hi
`,
        'utf8',
      );

      await expect(loadTests(evalPath, dir)).rejects.toThrow(
        'tests[0].options.postprocess has been removed. Use tests[0].options.transform instead.',
      );

      writeFileSync(
        evalPath,
        `
tests:
  - id: assertion-postprocess
    input: say hi
    assert:
      - type: contains
        value: hi
        postprocess: output.trim()
`,
        'utf8',
      );

      await expect(loadTests(evalPath, dir)).rejects.toThrow(
        'tests[0].assert[0].postprocess has been removed. Use tests[0].assert[0].transform instead.',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('applies test transform once before all assertions and isolates assertion transforms', async () => {
    const provider = new StaticProvider('mock', {
      output: [{ role: 'assistant', content: 'raw' }],
    });

    const result = await runEvalCase({
      evalCase: baseEvalCase({
        outputTransform: 'output + "|case"',
        assertions: [
          { name: 'case-visible', type: 'contains', value: 'raw|case' },
          {
            name: 'assert-only',
            type: 'contains',
            value: 'raw|case|assert',
            transform: 'output + "|assert"',
          },
          { name: 'assert-isolated', type: 'contains', value: 'raw|case|assert' },
        ],
      }),
      provider,
      target,
      evaluators: evaluatorRegistry,
    });

    expect(result.output).toBe('raw|case');
    expect(result.scores?.map((score) => score.score)).toEqual([1, 1, 0]);
    expect(result.scores?.[1]?.input).toEqual({
      transform: { input: 'raw|case', output: 'raw|case|assert' },
    });
  });

  it('runs file transforms over file-style assistant output before llm-rubric grading', async () => {
    const dir = tempDir('agentv-transform-xlsx-');
    try {
      const reportPath = path.join(dir, 'report.xlsx');
      const transformPath = path.join(dir, 'xlsx-to-markdown.js');
      writeFileSync(reportPath, Buffer.from([0, 159, 146, 150]));
      writeFileSync(
        transformPath,
        `
export default function transform(output, context) {
  if (!Array.isArray(output)) throw new Error('expected content array');
  const file = output.find((block) => block.type === 'file');
  if (!file || !file.path.endsWith('report.xlsx')) throw new Error('missing xlsx file');
  if (context.vars.sheet !== 'revenue') throw new Error('missing vars');
  return '| quarter | revenue |\\n| --- | ---: |\\n| Q1 | 42 |';
}
`,
        'utf8',
      );

      const answerProvider = new StaticProvider('file-output', {
        output: [
          {
            role: 'assistant',
            content: [
              {
                type: 'file',
                media_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                path: reportPath,
              },
            ],
          },
        ],
      });
      const graderProvider = new StaticProvider('grader', {
        output: [
          {
            role: 'assistant',
            content: JSON.stringify({
              score: 1,
              assertions: [{ text: 'spreadsheet rows visible', passed: true }],
            }),
          },
        ],
      });

      const [result] = await runEvaluation({
        testFilePath: path.join(dir, 'suite.eval.yaml'),
        repoRoot: dir,
        target: { ...target, name: 'file-output', graderTarget: 'grader' },
        targets: [
          { name: 'grader', provider: 'mock' },
          { name: 'file-output', provider: 'mock', grader_target: 'grader' },
        ],
        providerFactory: (resolved) =>
          resolved.name === 'grader' ? graderProvider : answerProvider,
        evalCases: [
          baseEvalCase({
            id: 'xlsx-transform',
            vars: { sheet: 'revenue' },
            outputTransform: `file://${transformPath}`,
            assertions: [
              {
                name: 'judge-spreadsheet',
                type: 'llm-rubric',
                value: 'The markdown table includes Q1 revenue.',
              },
            ],
          }),
        ],
      });

      expect(result?.score).toBe(1);
      expect(result?.output).toContain('| Q1 | 42 |');
      expect(graderProvider.lastRequest?.question).toContain('| Q1 | 42 |');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('surfaces test transform errors as evaluation failures', async () => {
    const provider = new StaticProvider('mock', {
      output: [{ role: 'assistant', content: 'raw' }],
    });

    const result = await runEvalCase({
      evalCase: baseEvalCase({
        outputTransform: '(() => { throw new Error("boom") })()',
        assertions: [{ name: 'never', type: 'contains', value: 'raw' }],
      }),
      provider,
      target,
      evaluators: evaluatorRegistry,
    });

    expect(result.executionStatus).toBe('execution_error');
    expect(result.error).toContain('Transform failed');
    expect(result.error).toContain('boom');
  });

  it('surfaces assertion transform errors on that assertion only', async () => {
    const provider = new StaticProvider('mock', {
      output: [{ role: 'assistant', content: 'raw' }],
    });

    const result = await runEvalCase({
      evalCase: baseEvalCase({
        assertions: [
          { name: 'ok', type: 'contains', value: 'raw' },
          {
            name: 'bad-transform',
            type: 'contains',
            value: 'raw',
            transform: 'throw new Error("assert boom")',
          },
        ],
      }),
      provider,
      target,
      evaluators: evaluatorRegistry,
    });

    expect(result.scores?.map((score) => score.score)).toEqual([1, 0]);
    expect(result.scores?.[1]?.assertions[0]?.text).toContain('Transform failed');
    expect(result.output).toBe('raw');
  });
});
