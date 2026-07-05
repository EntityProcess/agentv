import { describe, expect, it } from 'bun:test';

import { buildEnvironmentRecipeProvenance } from '../../src/evaluation/environment/provenance.js';

describe('environment recipe provenance', () => {
  it('redacts setup command, args, env, and logs while preserving emitted repo provenance', () => {
    const provenance = buildEnvironmentRecipeProvenance({
      environment: {
        type: 'host',
        workdir: '/workspaces/app',
        sourceDir: '/repo/.agentv/environments',
        setup: {
          command: ['node', 'setup.mjs', '--api-key', 'sk-live-secret'],
          args: {
            repo: 'example/app',
            api_key: 'sk-live-secret',
            nested: { token: 'nested-secret' },
          },
          env: {
            SETUP_MODE: 'test',
            GITHUB_TOKEN: 'github-secret',
          },
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
    expect(provenance?.setup?.args).toEqual({
      repo: 'example/app',
      api_key: '<redacted>',
      nested: { token: '<redacted>' },
    });
    expect(provenance?.setup?.env).toEqual({
      SETUP_MODE: 'test',
      GITHUB_TOKEN: '<redacted>',
    });
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
