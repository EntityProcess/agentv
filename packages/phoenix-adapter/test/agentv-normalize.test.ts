import { describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { discoverAgentVEvals } from '../src/agentv/discovery.js';
import { loadAgentVEvalSuite } from '../src/agentv/load-spec.js';

function fixtureRoot(name: string): string {
  return path.join(tmpdir(), `agentv-phoenix-${name}-${crypto.randomUUID()}`);
}

describe('AgentV eval normalization', () => {
  test('discovers yaml and agent skills eval sources', async () => {
    const root = fixtureRoot('discovery');
    mkdirSync(path.join(root, 'examples', 'features', 'basic', 'evals'), { recursive: true });
    mkdirSync(path.join(root, 'examples', 'features', 'skills'), { recursive: true });
    writeFileSync(
      path.join(root, 'examples', 'features', 'basic', 'evals', 'dataset.eval.yaml'),
      'tests: []\n',
    );
    writeFileSync(
      path.join(root, 'examples', 'features', 'skills', 'evals.json'),
      '{"evals": []}\n',
    );

    const sources = await discoverAgentVEvals(root);

    expect(sources.map((source) => source.relativePath)).toEqual([
      'examples/features/basic/evals/dataset.eval.yaml',
      'examples/features/skills/evals.json',
    ]);
  });

  test('expands suite input, external yaml, jsonl, and suite assertions', async () => {
    const root = fixtureRoot('normalize');
    const evalDir = path.join(root, 'examples', 'features', 'external', 'evals');
    mkdirSync(path.join(evalDir, 'cases'), { recursive: true });
    writeFileSync(
      path.join(evalDir, 'dataset.eval.yaml'),
      `name: external
input:
  - role: system
    content: shared
assertions:
  - type: contains
    value: ok
tests:
  - id: inline
    criteria: inline criteria
    input: hello
  - file://cases/more.jsonl
`,
    );
    writeFileSync(
      path.join(evalDir, 'cases', 'more.jsonl'),
      '{"id":"from-jsonl","criteria":"jsonl criteria","input":"hi","expected_output":"ok"}\n',
    );

    const suite = await loadAgentVEvalSuite({
      path: path.join(evalDir, 'dataset.eval.yaml'),
      relativePath: 'examples/features/external/evals/dataset.eval.yaml',
      kind: 'eval-yaml',
    });

    expect(suite.cases).toHaveLength(2);
    expect(suite.cases[0]?.input.map((message) => message.role)).toEqual(['system', 'user']);
    expect(suite.cases[1]?.expectedOutput).toBe('ok');
    expect(suite.cases[1]?.assertions[0]?.type).toBe('contains');
  });

  test('normalizes Agent Skills evals.json', async () => {
    const root = fixtureRoot('skills');
    const evalPath = path.join(root, 'examples', 'features', 'agent-skills-evals', 'evals.json');
    mkdirSync(path.dirname(evalPath), { recursive: true });
    writeFileSync(
      evalPath,
      JSON.stringify({
        skill_name: 'csv-analyzer',
        evals: [
          { id: 1, prompt: 'Read CSV', expected_output: 'Done', assertions: ['Reads the file'] },
        ],
      }),
    );

    const suite = await loadAgentVEvalSuite({
      path: evalPath,
      relativePath: 'examples/features/agent-skills-evals/evals.json',
      kind: 'agent-skills-json',
    });

    expect(suite.name).toBe('csv-analyzer');
    expect(suite.cases[0]?.id).toBe('1');
    expect(suite.cases[0]?.assertions[0]?.type).toBe('llm-grader');
  });
});
