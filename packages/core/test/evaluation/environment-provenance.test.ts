import { describe, expect, it } from 'bun:test';

import { buildEnvironmentRecipeProvenance } from '../../src/evaluation/environment/provenance.js';

describe('environment recipe provenance', () => {
  it('redacts setup argv and logs while preserving emitted repo provenance', () => {
    const provenance = buildEnvironmentRecipeProvenance({
      environment: {
        type: 'host',
        workdir: '/workspaces/app',
        sourceDir: '/repo/.agentv/environments',
        env: {
          GITHUB_TOKEN: 'github-secret',
        },
        setup: {
          command: ['node', 'setup.mjs', '--api-key', 'sk-live-secret'],
          cwd: '.',
          timeoutMs: 120000,
        },
      },
      setupExecutions: [
        {
          scope: 'environment',
          name: 'setup',
          status: 'success',
          testId: 'case-1',
          workdir: '/workspaces/app',
          command: ['node', 'setup.mjs', '--api-key', 'sk-live-secret'],
          output:
            '{"repo_provenance":{"repo":"example/app","commit":"abc123"}}\nused sk-live-secret and github-secret',
          exitCode: 0,
        },
      ],
    });

    expect(provenance?.setup?.command).toEqual(['node', 'setup.mjs', '--api-key', '<redacted>']);
    expect(provenance?.setup).not.toHaveProperty('args');
    expect(provenance?.setup).not.toHaveProperty('env');
    expect(provenance?.setup?.cwd).toBe('.');
    expect(provenance?.setup?.timeoutMs).toBe(120000);
    expect(provenance?.setupExecutions?.[0]?.output).toContain('used <redacted>');
    expect(provenance?.setupExecutions?.[0]?.output).not.toContain('sk-live-secret');
    expect(provenance?.setupExecutions?.[0]?.output).not.toContain('github-secret');
    expect(provenance?.repoProvenance).toEqual({ repo: 'example/app', commit: 'abc123' });
  });

  it('captures Docker authored context and image digest when runtime build details are absent', () => {
    const provenance = buildEnvironmentRecipeProvenance({
      environment: {
        type: 'docker',
        workdir: '/app',
        sourceDir: '/repo/evals',
        context: '/repo/environment',
        dockerfile: '/repo/environment/Dockerfile',
        image: 'ghcr.io/example/app@sha256:1234567890abcdef',
      },
    });

    expect(provenance?.docker).toEqual({
      context: '/repo/environment',
      dockerfile: '/repo/environment/Dockerfile',
      image: 'ghcr.io/example/app@sha256:1234567890abcdef',
      imageDigest: 'sha256:1234567890abcdef',
    });
    expect(provenance?.recipeSha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
