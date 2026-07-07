import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runEvaluation } from '../../src/evaluation/orchestrator.js';
import {
  type ResolvedProviderBackend,
  normalizeProviderDefinition,
} from '../../src/evaluation/providers/targets.js';
import type {
  Provider,
  ProviderRequest,
  ProviderResponse,
} from '../../src/evaluation/providers/types.js';
import type { EvalTest } from '../../src/evaluation/types.js';
import { loadTests } from '../../src/evaluation/yaml-parser.js';

class SequenceProvider implements Provider {
  readonly id: string;
  readonly kind = 'mock' as const;
  readonly targetName: string;
  lastRequest?: ProviderRequest;

  private readonly responses: ProviderResponse[];

  constructor(targetName: string, responses: readonly ProviderResponse[]) {
    this.id = `mock:${targetName}`;
    this.targetName = targetName;
    this.responses = [...responses];
  }

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    this.lastRequest = request;
    const response = this.responses.shift();
    if (!response) {
      throw new Error(`No response configured for ${this.targetName}`);
    }
    return response;
  }
}

class AgentLikeProvider implements Provider {
  readonly id: string;
  readonly kind = 'codex-cli' as const;
  readonly targetName: string;
  lastRequest?: ProviderRequest;

  constructor(
    targetName: string,
    private readonly response: ProviderResponse,
  ) {
    this.id = `agent:${targetName}`;
    this.targetName = targetName;
  }

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    this.lastRequest = request;
    return this.response;
  }
}

const answerTarget: ResolvedProviderBackend = {
  name: 'answer',
  kind: 'mock',
  config: { response: 'answer' },
};

const agentTarget = {
  name: 'agent-answer',
  kind: 'codex-cli',
  config: {},
} as ResolvedProviderBackend;

function tempDir(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

function graderResponse(score: number): ProviderResponse {
  return {
    output: [
      {
        role: 'assistant',
        content: JSON.stringify({ score, assertions: [{ text: 'graded', passed: score >= 0.5 }] }),
      },
    ],
  };
}

function baseCase(overrides: Partial<EvalTest> = {}): EvalTest {
  return {
    id: 'case-1',
    suite: 'provider-grader-selection',
    question: 'Answer the prompt',
    input: [{ role: 'user', content: 'Answer the prompt' }],
    expected_output: [],
    reference_answer: '',
    file_paths: [],
    criteria: '',
    assertions: [{ name: 'quality', type: 'llm-rubric', value: 'The answer is good.' }],
    ...overrides,
  };
}

describe('provider-based grader selection', () => {
  it('loads default_test and test options.provider into LLM-backed assertion providers', async () => {
    const dir = tempDir('agentv-grader-provider-parser-');
    try {
      const evalPath = path.join(dir, 'suite.eval.yaml');
      writeFileSync(
        evalPath,
        `
prompts:
  - "{{ input }}"
default_test:
  vars:
    input: say hi
  options:
    provider: inherited-grader
tests:
  - id: inherited
    assert:
      - type: llm-rubric
        value: good
  - id: test-override
    options:
      provider: test-grader
    assert:
      - type: llm-rubric
        value: good
  - id: assertion-override
    options:
      provider: test-grader
    assert:
      - type: llm-rubric
        provider: assertion-grader
        value: good
`,
        'utf8',
      );

      const tests = await loadTests(evalPath, dir);

      expect(tests[0]?.assertions?.[0]).toMatchObject({ target: 'inherited-grader' });
      expect(tests[1]?.assertions?.[0]).toMatchObject({ target: 'test-grader' });
      expect(tests[2]?.assertions?.[0]).toMatchObject({ target: 'assertion-grader' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uses defaults.grader labels from the shared providers pool without inferring from the candidate', async () => {
    const answerProvider = new SequenceProvider('answer', [
      { output: [{ role: 'assistant', content: 'candidate answer' }] },
    ]);
    const graderProvider = new SequenceProvider('grader-label', [graderResponse(1)]);

    const results = await runEvaluation({
      testFilePath: 'in-memory.yaml',
      repoRoot: 'in-memory',
      target: answerTarget,
      targets: [
        { name: 'answer', provider: 'mock' },
        normalizeProviderDefinition({ id: 'mock', label: 'grader-label' }),
      ],
      defaultGraderTarget: 'grader-label',
      providerFactory: (target) =>
        target.name === 'grader-label' ? graderProvider : answerProvider,
      evalCases: [baseCase()],
    });

    expect(results[0]?.score).toBe(1);
    expect(answerProvider.lastRequest).toBeDefined();
    expect(graderProvider.lastRequest).toBeDefined();
  });

  it('uses defaults.grader ids from the shared providers pool when no label is supplied', async () => {
    const answerProvider = new SequenceProvider('answer', [
      { output: [{ role: 'assistant', content: 'candidate answer' }] },
    ]);
    const graderProvider = new SequenceProvider('mock', [graderResponse(1)]);

    const results = await runEvaluation({
      testFilePath: 'in-memory.yaml',
      repoRoot: 'in-memory',
      target: answerTarget,
      targets: [{ name: 'answer', provider: 'mock' }, normalizeProviderDefinition({ id: 'mock' })],
      defaultGraderTarget: 'mock',
      providerFactory: (target) => (target.name === 'mock' ? graderProvider : answerProvider),
      evalCases: [baseCase()],
    });

    expect(results[0]?.score).toBe(1);
    expect(graderProvider.lastRequest).toBeDefined();
  });

  it('lets test options.provider override defaults.grader for grader-required assertions', async () => {
    const answerProvider = new SequenceProvider('answer', [
      { output: [{ role: 'assistant', content: 'candidate answer' }] },
    ]);
    const defaultGrader = new SequenceProvider('default-grader', [graderResponse(0)]);
    const testGrader = new SequenceProvider('test-grader', [graderResponse(1)]);

    const results = await runEvaluation({
      testFilePath: 'in-memory.yaml',
      repoRoot: 'in-memory',
      target: answerTarget,
      targets: [
        { name: 'answer', provider: 'mock' },
        { name: 'default-grader', provider: 'mock' },
        { name: 'test-grader', provider: 'mock' },
      ],
      defaultGraderTarget: 'default-grader',
      providerFactory: (target) => {
        if (target.name === 'default-grader') return defaultGrader;
        if (target.name === 'test-grader') return testGrader;
        return answerProvider;
      },
      evalCases: [
        baseCase({
          assertions: [
            {
              name: 'quality',
              type: 'llm-rubric',
              target: 'test-grader',
              value: 'The answer is good.',
            },
          ],
        }),
      ],
    });

    expect(results[0]?.score).toBe(1);
    expect(testGrader.lastRequest).toBeDefined();
    expect(defaultGrader.lastRequest).toBeUndefined();
  });

  it('does not fall back to grading with the candidate provider', async () => {
    const answerProvider = new SequenceProvider('answer', [
      { output: [{ role: 'assistant', content: 'candidate answer' }] },
    ]);

    await expect(
      runEvaluation({
        testFilePath: 'in-memory.yaml',
        repoRoot: 'in-memory',
        target: answerTarget,
        targets: [{ name: 'answer', provider: 'mock' }],
        providerFactory: () => answerProvider,
        evalCases: [baseCase()],
      }),
    ).rejects.toThrow(/no grader provider configured/i);
    expect(answerProvider.lastRequest).toBeUndefined();
  });

  it('fails agent providers clearly when no usable grader provider is configured', async () => {
    const agentProvider = new AgentLikeProvider('agent-answer', {
      output: [{ role: 'assistant', content: 'candidate answer' }],
    });

    await expect(
      runEvaluation({
        testFilePath: 'in-memory.yaml',
        repoRoot: 'in-memory',
        target: agentTarget,
        targets: [{ name: 'agent-answer', provider: 'codex-cli' }],
        providerFactory: () => agentProvider,
        evalCases: [baseCase()],
      }),
    ).rejects.toThrow(/agent provider.*no grader provider/i);
    expect(agentProvider.lastRequest).toBeUndefined();
  });

  it('allows assertion-level provider overrides for agent candidates', async () => {
    const agentProvider = new AgentLikeProvider('agent-answer', {
      output: [{ role: 'assistant', content: 'candidate answer' }],
    });
    const graderProvider = new SequenceProvider('grader', [graderResponse(1)]);

    const results = await runEvaluation({
      testFilePath: 'in-memory.yaml',
      repoRoot: 'in-memory',
      target: agentTarget,
      targets: [
        { name: 'agent-answer', provider: 'codex-cli' },
        { name: 'grader', provider: 'mock' },
      ],
      providerFactory: (target) => (target.name === 'grader' ? graderProvider : agentProvider),
      evalCases: [
        baseCase({
          assertions: [
            {
              name: 'quality',
              type: 'llm-rubric',
              target: 'grader',
              value: 'The answer is good.',
            },
          ],
        }),
      ],
    });

    expect(results[0]?.score).toBe(1);
    expect(agentProvider.lastRequest).toBeDefined();
    expect(graderProvider.lastRequest).toBeDefined();
  });

  it('allows the same configured provider to run as candidate and grader', async () => {
    const sharedProvider = new SequenceProvider('shared', [
      { output: [{ role: 'assistant', content: 'candidate answer' }] },
      graderResponse(1),
    ]);

    const results = await runEvaluation({
      testFilePath: 'in-memory.yaml',
      repoRoot: 'in-memory',
      target: { ...answerTarget, name: 'shared' },
      targets: [{ name: 'shared', provider: 'mock' }],
      defaultGraderTarget: 'shared',
      providerFactory: () => sharedProvider,
      evalCases: [baseCase()],
    });

    expect(results[0]?.score).toBe(1);
  });
});
