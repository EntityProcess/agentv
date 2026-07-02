import { afterEach, describe, expect, it } from 'bun:test';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runEvaluation } from '../../src/evaluation/orchestrator.js';
import type { ResolvedTarget } from '../../src/evaluation/providers/targets.js';
import type {
  Provider,
  ProviderRequest,
  ProviderResponse,
} from '../../src/evaluation/providers/types.js';
import { loadTestSuite, loadTests } from '../../src/evaluation/yaml-parser.js';

const target: ResolvedTarget = {
  name: 'mock',
  kind: 'mock',
  config: {},
};

const passEvaluators = {
  'llm-grader': {
    kind: 'llm-grader' as const,
    async evaluate() {
      return {
        score: 1,
        verdict: 'pass' as const,
        assertions: [{ text: 'passed', passed: true }],
        expectedAspectCount: 1,
      };
    },
  },
};

class CapturingProvider implements Provider {
  readonly id = 'mock:capturing';
  readonly kind = 'mock' as const;
  readonly targetName = 'mock';
  lastRequest?: ProviderRequest;

  constructor(private readonly onInvoke?: (request: ProviderRequest) => void | Promise<void>) {}

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    this.lastRequest = request;
    await this.onInvoke?.(request);
    return {
      output: [{ role: 'assistant', content: 'answer' }],
    };
  }
}

function cleanGitEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !(key.startsWith('GIT_') && key !== 'GIT_SSH_COMMAND')) {
      env[key] = value;
    }
  }
  return env;
}

function createTestRepo(dir: string, files: Record<string, string>): string {
  mkdirSync(dir, { recursive: true });
  const execOptions = { cwd: dir, stdio: 'ignore' as const, env: cleanGitEnv() };
  execSync('git init', execOptions);
  execSync('git config user.email "test@test.com"', execOptions);
  execSync('git config user.name "Test"', execOptions);
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(dir, name);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, 'utf8');
  }
  execSync('git add -A && git commit -m "initial"', execOptions);
  return execSync('git rev-parse HEAD', { cwd: dir, env: cleanGitEnv() }).toString().trim();
}

describe('promptfoo-compatible lifecycle extensions', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('parses file hooks and agent-rules extensions from eval YAML', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'agentv-extensions-parse-'));
    tempDirs.push(dir);
    await writeFile(path.join(dir, 'hooks.mjs'), 'export function beforeAll() {}', 'utf8');
    await writeFile(
      path.join(dir, 'suite.eval.yaml'),
      `extensions:
  - file://hooks.mjs:beforeAll
  - id: agentv:agent-rules
    hook: beforeEach
    skills: rules/skills
tests:
  - id: one
    input: hello
    criteria: works
`,
      'utf8',
    );

    const tests = await loadTests(path.join(dir, 'suite.eval.yaml'), dir);

    expect(tests[0].extensions).toEqual([
      {
        id: 'file://hooks.mjs:beforeAll',
        hook: 'beforeAll',
        path: path.join(dir, 'hooks.mjs'),
        functionName: 'beforeAll',
      },
      {
        id: 'agentv:agent-rules',
        hook: 'beforeEach',
        skills: ['rules/skills'],
      },
    ]);
  });

  it('runs lifecycle file hooks and exposes staged agent-rules paths to providers and results', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'agentv-extensions-run-'));
    tempDirs.push(dir);
    await mkdir(path.join(dir, 'template'), { recursive: true });
    await mkdir(path.join(dir, 'rules', 'skills', 'csv'), { recursive: true });
    await writeFile(path.join(dir, 'rules', 'skills', 'csv', 'SKILL.md'), '# CSV\n', 'utf8');
    await writeFile(path.join(dir, 'rules', 'AGENTS.md'), '# Rules\n', 'utf8');
    await writeFile(
      path.join(dir, 'hooks.mjs'),
      `import { appendFileSync } from 'node:fs';
import path from 'node:path';

function log(context, name) {
  appendFileSync(path.join(context.eval_dir, 'lifecycle.log'), name + ':' + Boolean(context.workspace_path) + '\\n');
}

export function beforeAll(context) {
  log(context, 'beforeAll');
  return { provider_context: { custom_flag: 'beforeAll' }, output: 'beforeAll output' };
}

export function beforeEach(context) {
  log(context, 'beforeEach');
  return { provider_context: { case_id: context.test_id }, output: 'beforeEach output' };
}

export function afterEach(context) {
  log(context, 'afterEach');
  return { output: 'afterEach output' };
}

export function afterAll(context) {
  log(context, 'afterAll');
  return { output: 'afterAll output' };
}
`,
      'utf8',
    );
    await writeFile(
      path.join(dir, 'suite.eval.yaml'),
      `extensions:
  - file://hooks.mjs:beforeAll
  - file://hooks.mjs:beforeEach
  - file://hooks.mjs:afterEach
  - file://hooks.mjs:afterAll
  - id: agentv:agent-rules
    hook: beforeAll
    skills: rules/skills
    rules: rules/AGENTS.md
workspace:
  template: template
tests:
  - id: one
    input: hello
    criteria: works
`,
      'utf8',
    );
    const suite = await loadTestSuite(path.join(dir, 'suite.eval.yaml'), dir);
    const provider = new CapturingProvider();

    const results = await runEvaluation({
      testFilePath: path.join(dir, 'suite.eval.yaml'),
      repoRoot: dir,
      target,
      providerFactory: () => provider,
      evaluators: passEvaluators,
      evalCases: suite.tests,
      maxConcurrency: 1,
    });

    const log = await readFile(path.join(dir, 'lifecycle.log'), 'utf8');
    expect(log.trim().split('\n')).toEqual([
      'beforeAll:true',
      'beforeEach:true',
      'afterEach:true',
      'afterAll:true',
    ]);
    expect(provider.lastRequest?.metadata?.custom_flag).toBe('beforeAll');
    expect(provider.lastRequest?.metadata?.case_id).toBe('one');
    const providerRules = provider.lastRequest?.metadata?.agent_rules_paths as {
      skills?: string[];
      rules?: string[];
    };
    expect(providerRules.skills?.[0]).toContain(path.join('.agentv', 'agent-rules', 'skills'));
    expect(providerRules.rules?.[0]).toContain(path.join('.agentv', 'agent-rules', 'rules'));
    expect(results[0].metadata?.agent_rules_paths).toEqual(
      provider.lastRequest?.metadata?.agent_rules_paths,
    );
    expect(results[0].beforeAllOutput).toContain('beforeAll output');
    expect(results[0].beforeEachOutput).toContain('beforeEach output');
    expect(results[0].afterEachOutput).toContain('afterEach output');
    expect(results[0].afterAllOutput).toContain('afterAll output');
  });

  it('runs afterEach extensions and preserves extension metadata for conversation cases', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'agentv-extensions-conversation-'));
    tempDirs.push(dir);
    await mkdir(path.join(dir, 'template'), { recursive: true });
    await mkdir(path.join(dir, 'rules', 'skills', 'chat'), { recursive: true });
    await writeFile(path.join(dir, 'rules', 'skills', 'chat', 'SKILL.md'), '# Chat\n', 'utf8');
    await writeFile(
      path.join(dir, 'hooks.mjs'),
      `import { appendFileSync } from 'node:fs';
import path from 'node:path';

export function afterEach(context) {
  appendFileSync(path.join(context.eval_dir, 'conversation.log'), context.test_id + ':' + Boolean(context.agent_rules_paths?.skills?.length) + '\\n');
  return { output: 'conversation afterEach output' };
}
`,
      'utf8',
    );
    await writeFile(
      path.join(dir, 'suite.eval.yaml'),
      `extensions:
  - id: agentv:agent-rules
    hook: beforeAll
    skills: rules/skills
  - file://hooks.mjs:afterEach
workspace:
  template: template
tests:
  - id: conversation
    mode: conversation
    input: "You are concise"
    turns:
      - input: hello
`,
      'utf8',
    );
    const suite = await loadTestSuite(path.join(dir, 'suite.eval.yaml'), dir);
    const provider = new CapturingProvider();

    const results = await runEvaluation({
      testFilePath: path.join(dir, 'suite.eval.yaml'),
      repoRoot: dir,
      target,
      providerFactory: () => provider,
      evaluators: passEvaluators,
      evalCases: suite.tests,
      maxConcurrency: 1,
    });

    expect((await readFile(path.join(dir, 'conversation.log'), 'utf8')).trim()).toBe(
      'conversation:true',
    );
    expect(results[0].metadata?.agent_rules_paths).toEqual(
      provider.lastRequest?.metadata?.agent_rules_paths,
    );
    expect(results[0].afterEachOutput).toContain('conversation afterEach output');
  });

  it('scopes pooled beforeAll extension state to the selected workspace slot', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'agentv-extensions-pool-'));
    tempDirs.push(dir);
    const previousDataDir = process.env.AGENTV_DATA_DIR;
    process.env.AGENTV_DATA_DIR = path.join(dir, 'agentv-data');
    try {
      const sourceRepo = path.join(dir, 'source-repo');
      const commit = createTestRepo(sourceRepo, { 'README.md': 'base\n' });
      await mkdir(path.join(dir, 'rules', 'skills', 'slot'), { recursive: true });
      await writeFile(path.join(dir, 'rules', 'skills', 'slot', 'SKILL.md'), '# Slot\n', 'utf8');
      await writeFile(
        path.join(dir, 'suite.eval.yaml'),
        `extensions:
  - id: agentv:agent-rules
    hook: beforeAll
    skills: rules/skills
workspace:
  repos:
    - path: ./repo-a
      repo: file://${sourceRepo}
      commit: ${commit}
tests:
  - id: one
    input: one
    criteria: works
  - id: two
    input: two
    criteria: works
`,
        'utf8',
      );
      const suite = await loadTestSuite(path.join(dir, 'suite.eval.yaml'), dir);
      const requests: ProviderRequest[] = [];
      const provider = new CapturingProvider((request) => {
        requests.push(request);
      });

      await runEvaluation({
        testFilePath: path.join(dir, 'suite.eval.yaml'),
        repoRoot: dir,
        target,
        providerFactory: () => provider,
        evaluators: passEvaluators,
        evalCases: suite.tests,
        maxConcurrency: 2,
        workspaceMode: 'pooled',
        poolMaxSlots: 2,
      });

      expect(requests).toHaveLength(2);
      const workspacePaths = new Set(requests.map((request) => request.cwd));
      expect(workspacePaths.size).toBe(2);
      for (const request of requests) {
        expect(request.cwd).toBeDefined();
        const rules = request.metadata?.agent_rules_paths as { skills?: string[] } | undefined;
        expect(rules?.skills?.length).toBe(1);
        expect(rules?.skills?.[0]).toContain(
          path.join(request.cwd ?? '', '.agentv', 'agent-rules', 'skills'),
        );
      }
    } finally {
      if (previousDataDir === undefined) {
        process.env.AGENTV_DATA_DIR = undefined;
      } else {
        process.env.AGENTV_DATA_DIR = previousDataDir;
      }
    }
  }, 30_000);

  it('refreshes the baseline after beforeEach extensions mutate files without state', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'agentv-extensions-baseline-'));
    tempDirs.push(dir);
    await mkdir(path.join(dir, 'template'), { recursive: true });
    await writeFile(
      path.join(dir, 'hooks.mjs'),
      `import { writeFileSync } from 'node:fs';
import path from 'node:path';

export function beforeEach(context) {
  writeFileSync(path.join(context.workspace_path, 'setup.txt'), 'setup from extension\\n');
}
`,
      'utf8',
    );
    await writeFile(
      path.join(dir, 'suite.eval.yaml'),
      `extensions:
  - file://hooks.mjs:beforeEach
workspace:
  template: template
tests:
  - id: one
    input: hello
    criteria: works
`,
      'utf8',
    );
    const suite = await loadTestSuite(path.join(dir, 'suite.eval.yaml'), dir);
    const provider = new CapturingProvider((request) => {
      if (!request.cwd) {
        throw new Error('cwd was not provided');
      }
      writeFileSync(path.join(request.cwd, 'agent.txt'), 'agent output\n', 'utf8');
    });

    const results = await runEvaluation({
      testFilePath: path.join(dir, 'suite.eval.yaml'),
      repoRoot: dir,
      target,
      providerFactory: () => provider,
      evaluators: passEvaluators,
      evalCases: suite.tests,
      maxConcurrency: 1,
    });

    expect(results[0].fileChanges).toContain('agent.txt');
    expect(results[0].fileChanges).not.toContain('setup.txt');
  });

  it('rejects removed on_run_complete in favor of afterAll extensions', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'agentv-extensions-removed-'));
    tempDirs.push(dir);
    await writeFile(
      path.join(dir, 'suite.eval.yaml'),
      `on_run_complete: ./done.sh
tests:
  - id: one
    input: hello
    criteria: works
`,
      'utf8',
    );

    await expect(loadTestSuite(path.join(dir, 'suite.eval.yaml'), dir)).rejects.toThrow(
      /on_run_complete.*extensions with afterAll/,
    );
  });
});
