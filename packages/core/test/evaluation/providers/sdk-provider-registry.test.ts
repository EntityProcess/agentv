import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createBuiltinProviderRegistry } from '../../../src/evaluation/providers/index.js';
import { SdkChildProvider } from '../../../src/evaluation/providers/sdk-child-provider.js';

describe('SDK provider registry isolation', () => {
  const sdkOptionalDependencies = {
    '@anthropic-ai/claude-agent-sdk': '^0.2.89',
    '@earendil-works/pi-coding-agent': '^0.74.0',
    '@github/copilot-sdk': '^1.0.3',
    '@openai/codex-sdk': '^0.136.0',
  };

  it('registers explicit SDK providers through the child-runner wrapper', () => {
    const registry = createBuiltinProviderRegistry();

    for (const kind of ['codex-sdk', 'claude-sdk', 'copilot-sdk', 'pi-sdk'] as const) {
      const provider = registry.create({
        name: `${kind}-target`,
        kind,
        config: kind === 'codex-sdk' ? { command: ['codex'] } : {},
      });
      expect(provider).toBeInstanceOf(SdkChildProvider);
      expect(provider.kind).toBe(kind);
    }
  });

  it('keeps direct SDK provider modules out of the built-in registry imports', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../../src/evaluation/providers/index.ts', import.meta.url)),
      'utf8',
    );

    expect(source).not.toContain("from './codex.js'");
    expect(source).not.toContain("from './claude-sdk.js'");
    expect(source).not.toContain("from './copilot-sdk.js'");
    expect(source).not.toContain("from './pi-coding-agent.js'");
  });

  it('declares SDK provider packages as optional package dependencies', () => {
    for (const packageJsonPath of ['packages/core/package.json', 'apps/cli/package.json']) {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
        optionalDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
        peerDependenciesMeta?: Record<string, { optional?: boolean }>;
      };

      expect(packageJson.optionalDependencies).toMatchObject(sdkOptionalDependencies);
      expect(packageJson.peerDependencies).toMatchObject(sdkOptionalDependencies);
      for (const packageName of Object.keys(sdkOptionalDependencies)) {
        expect(packageJson.peerDependenciesMeta?.[packageName]?.optional).toBe(true);
      }
    }
  });
});
