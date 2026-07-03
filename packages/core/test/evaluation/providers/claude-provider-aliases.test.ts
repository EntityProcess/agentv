import { afterEach, describe, expect, it } from 'bun:test';

import { ClaudeCliProvider } from '../../../src/evaluation/providers/claude-cli.js';
import { ClaudeProvider } from '../../../src/evaluation/providers/claude.js';
import { createBuiltinProviderRegistry } from '../../../src/evaluation/providers/index.js';
import { SdkChildProvider } from '../../../src/evaluation/providers/sdk-child-provider.js';

const mockClaudeConfig = {
  command: ['claude'],
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

  it('does not register a bare claude provider alias', () => {
    expect(() =>
      registry.create({
        name: 'test-target',
        kind: 'claude' as never,
        config: mockClaudeConfig,
      }),
    ).toThrow(/Unknown provider kind: "claude"/);
  });

  it('creates an isolated child provider for claude-sdk kind', () => {
    const provider = registry.create({
      name: 'test-target',
      kind: 'claude-sdk',
      config: mockClaudeConfig,
    });
    expect(provider).toBeInstanceOf(SdkChildProvider);
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
    expect(sdkProvider.kind).toBe('claude-sdk');
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

describe('ClaudeCliProvider target execution envelopes', () => {
  const originalLogEnv = process.env.AGENTV_CLAUDE_STREAM_LOGS;

  afterEach(() => {
    process.env.AGENTV_CLAUDE_STREAM_LOGS = originalLogEnv;
  });

  it('maps subprocess nonzero exits to target execution errors', async () => {
    process.env.AGENTV_CLAUDE_STREAM_LOGS = 'false';
    const provider = new ClaudeCliProvider('target', {
      ...mockClaudeConfig,
      command: ['node', '--eval', 'process.stderr.write("boom"); process.exit(7)', '--'],
      executable: 'node',
    });

    const response = await provider.invoke({ question: 'hello' });

    expect(response.targetExecution?.status).toBe('error');
    expect(response.targetExecution?.errorKind).toBe('nonzero_exit');
    expect(response.targetExecution?.exitCode).toBe(7);
    expect(response.targetExecution?.command?.argv?.slice(0, 3)).toEqual([
      'node',
      '--eval',
      'process.stderr.write("boom"); process.exit(7)',
    ]);
    expect(response.targetExecution?.logs?.stderr?.text).toContain('boom');
  });
});
