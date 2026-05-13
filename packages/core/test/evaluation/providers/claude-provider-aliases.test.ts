import { describe, expect, it } from 'bun:test';

import { ClaudeCliProvider } from '../../../src/evaluation/providers/claude-cli.js';
import { ClaudeSdkProvider } from '../../../src/evaluation/providers/claude-sdk.js';
import { ClaudeProvider } from '../../../src/evaluation/providers/claude.js';
import { createBuiltinProviderRegistry } from '../../../src/evaluation/providers/index.js';

const mockClaudeConfig = {
  executable: 'claude',
  model: undefined,
  cwd: undefined,
  timeoutMs: undefined,
  logDir: undefined,
  logFormat: 'summary' as const,
  systemPrompt: undefined,
  maxTurns: undefined,
  maxBudgetUsd: undefined,
};

describe('Claude provider alias resolution', () => {
  const registry = createBuiltinProviderRegistry();

  it('creates a ClaudeCliProvider for claude-cli kind', () => {
    const provider = registry.create({
      name: 'test-target',
      kind: 'claude-cli',
      config: mockClaudeConfig,
    });
    expect(provider).toBeInstanceOf(ClaudeCliProvider);
    expect(provider.kind).toBe('claude-cli');
    expect(provider.id).toBe('claude-cli:test-target');
  });

  it('creates a ClaudeCliProvider for claude kind (alias for claude-cli)', () => {
    const provider = registry.create({
      name: 'test-target',
      kind: 'claude',
      config: mockClaudeConfig,
    });
    expect(provider).toBeInstanceOf(ClaudeCliProvider);
    expect(provider.kind).toBe('claude-cli');
  });

  it('creates a ClaudeSdkProvider for claude-sdk kind', () => {
    const provider = registry.create({
      name: 'test-target',
      kind: 'claude-sdk',
      config: mockClaudeConfig,
    });
    expect(provider).toBeInstanceOf(ClaudeSdkProvider);
    expect(provider.kind).toBe('claude-sdk');
    expect(provider.id).toBe('claude-sdk:test-target');
  });

  it('ClaudeCliProvider and ClaudeProvider are different classes', () => {
    // ClaudeProvider is the legacy SDK provider kept for reference
    const cliProvider = new ClaudeCliProvider('target', mockClaudeConfig);
    const sdkProvider = new ClaudeProvider('target', mockClaudeConfig as never);
    expect(cliProvider).toBeInstanceOf(ClaudeCliProvider);
    expect(sdkProvider).toBeInstanceOf(ClaudeProvider);
    expect(cliProvider.kind).toBe('claude-cli');
    expect(sdkProvider.kind).toBe('claude');
  });
});

describe('ClaudeCliProvider buildArgs', () => {
  it('includes --dangerously-skip-permissions by default', () => {
    const provider = new ClaudeCliProvider('target', mockClaudeConfig);
    // biome-ignore lint/suspicious/noExplicitAny: testing private method
    const args: string[] = (provider as any).buildArgs();
    expect(args).toContain('--dangerously-skip-permissions');
  });

  it('includes --dangerously-skip-permissions when bypassPermissions is true', () => {
    const provider = new ClaudeCliProvider('target', {
      ...mockClaudeConfig,
      bypassPermissions: true,
    });
    // biome-ignore lint/suspicious/noExplicitAny: testing private method
    const args: string[] = (provider as any).buildArgs();
    expect(args).toContain('--dangerously-skip-permissions');
  });

  it('omits --dangerously-skip-permissions when bypassPermissions is false', () => {
    const provider = new ClaudeCliProvider('target', {
      ...mockClaudeConfig,
      bypassPermissions: false,
    });
    // biome-ignore lint/suspicious/noExplicitAny: testing private method
    const args: string[] = (provider as any).buildArgs();
    expect(args).not.toContain('--dangerously-skip-permissions');
  });
});
