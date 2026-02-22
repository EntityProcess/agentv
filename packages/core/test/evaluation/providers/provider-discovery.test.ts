import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { discoverProviders } from '../../../src/evaluation/providers/provider-discovery.js';
import { ProviderRegistry } from '../../../src/evaluation/providers/provider-registry.js';

describe('discoverProviders', () => {
  const tempDirs: string[] = [];

  async function createTempDir(): Promise<string> {
    const dir = path.join(
      os.tmpdir(),
      `agentv-provider-discovery-test-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    );
    await mkdir(dir, { recursive: true });
    tempDirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    await Promise.all(
      tempDirs.map((dir) => rm(dir, { recursive: true, force: true }).catch(() => {})),
    );
    tempDirs.length = 0;
  });

  it('discovers .ts provider scripts from .agentv/providers/', async () => {
    const baseDir = await createTempDir();
    const providersDir = path.join(baseDir, '.agentv', 'providers');
    await mkdir(providersDir, { recursive: true });
    await writeFile(path.join(providersDir, 'my-llm.ts'), 'console.log("hello")');

    const registry = new ProviderRegistry();
    const discovered = await discoverProviders(registry, baseDir);

    expect(discovered).toEqual(['my-llm']);
    expect(registry.has('my-llm')).toBe(true);
  });

  it('discovers multiple file extensions (.ts, .js, .mts, .mjs)', async () => {
    const baseDir = await createTempDir();
    const providersDir = path.join(baseDir, '.agentv', 'providers');
    await mkdir(providersDir, { recursive: true });
    await writeFile(path.join(providersDir, 'provider-a.ts'), '');
    await writeFile(path.join(providersDir, 'provider-b.js'), '');
    await writeFile(path.join(providersDir, 'provider-c.mts'), '');
    await writeFile(path.join(providersDir, 'provider-d.mjs'), '');

    const registry = new ProviderRegistry();
    const discovered = await discoverProviders(registry, baseDir);

    expect(discovered).toContain('provider-a');
    expect(discovered).toContain('provider-b');
    expect(discovered).toContain('provider-c');
    expect(discovered).toContain('provider-d');
    expect(discovered).toHaveLength(4);
  });

  it('does not override built-in kinds', async () => {
    const baseDir = await createTempDir();
    const providersDir = path.join(baseDir, '.agentv', 'providers');
    await mkdir(providersDir, { recursive: true });
    // "cli" is a built-in kind name
    await writeFile(path.join(providersDir, 'cli.ts'), 'console.log("custom cli")');
    await writeFile(path.join(providersDir, 'custom.ts'), 'console.log("custom")');

    const registry = new ProviderRegistry();
    // Register a built-in "cli" factory
    registry.register('cli', () => ({ id: 'built-in-cli' }) as never);

    const discovered = await discoverProviders(registry, baseDir);

    // "cli" should NOT be in discovered list since it's a built-in
    expect(discovered).toEqual(['custom']);
    // The built-in "cli" factory should remain unchanged
    expect(registry.has('cli')).toBe(true);
  });

  it('returns empty array when .agentv/providers/ does not exist', async () => {
    const baseDir = await createTempDir();

    const registry = new ProviderRegistry();
    const discovered = await discoverProviders(registry, baseDir);

    expect(discovered).toEqual([]);
  });

  it('ignores non-script files', async () => {
    const baseDir = await createTempDir();
    const providersDir = path.join(baseDir, '.agentv', 'providers');
    await mkdir(providersDir, { recursive: true });
    await writeFile(path.join(providersDir, 'readme.md'), '# docs');
    await writeFile(path.join(providersDir, 'config.json'), '{}');
    await writeFile(path.join(providersDir, 'valid.ts'), 'console.log("ok")');

    const registry = new ProviderRegistry();
    const discovered = await discoverProviders(registry, baseDir);

    expect(discovered).toEqual(['valid']);
  });

  it('walks up directory tree to find .agentv/providers/', async () => {
    const baseDir = await createTempDir();
    const nestedDir = path.join(baseDir, 'level1', 'level2');
    await mkdir(nestedDir, { recursive: true });

    const providersDir = path.join(baseDir, '.agentv', 'providers');
    await mkdir(providersDir, { recursive: true });
    await writeFile(path.join(providersDir, 'parent-provider.ts'), '');

    const registry = new ProviderRegistry();
    const discovered = await discoverProviders(registry, nestedDir);

    expect(discovered).toContain('parent-provider');
  });

  it('creates CliProvider with correct command template', async () => {
    const baseDir = await createTempDir();
    const providersDir = path.join(baseDir, '.agentv', 'providers');
    await mkdir(providersDir, { recursive: true });
    const scriptPath = path.join(providersDir, 'my-llm.ts');
    await writeFile(scriptPath, 'console.log("hello")');

    const registry = new ProviderRegistry();
    await discoverProviders(registry, baseDir);

    // Get the factory and create a provider
    const factory = registry.get('my-llm');
    expect(factory).toBeDefined();

    const provider = factory?.({
      kind: 'cli',
      name: 'test-target',
      config: {},
    } as never);

    expect(provider).toBeDefined();
    expect(provider.kind).toBe('cli');
    expect(provider.targetName).toBe('test-target');
  });

  it('derives kind name from filename without extension', async () => {
    const baseDir = await createTempDir();
    const providersDir = path.join(baseDir, '.agentv', 'providers');
    await mkdir(providersDir, { recursive: true });
    await writeFile(path.join(providersDir, 'my-custom-agent.ts'), '');

    const registry = new ProviderRegistry();
    const discovered = await discoverProviders(registry, baseDir);

    expect(discovered).toEqual(['my-custom-agent']);
    expect(registry.has('my-custom-agent')).toBe(true);
  });
});
