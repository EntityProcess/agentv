import { describe, expect, it } from 'bun:test';

import { applyWorkspaceRootOverride } from '../../../src/commands/eval/run-eval.js';
import type { TargetSelection } from '../../../src/commands/eval/targets.js';

describe('eval --workspace-root target defaults', () => {
  it('sets vscode workspaceTemplate when missing', () => {
    const selection: TargetSelection = {
      definitions: [],
      targetName: 'default',
      targetSource: 'default',
      targetsFilePath: '/tmp/targets.yaml',
      resolvedTarget: {
        kind: 'vscode' as const,
        name: 'vscode',
        judgeTarget: undefined,
        workers: undefined,
        providerBatching: undefined,
        config: {
          command: 'code',
          waitForResponse: true,
          dryRun: false,
        },
      },
    };

    const updated = applyWorkspaceRootOverride(selection, '/work');

    expect(updated.resolvedTarget.config.workspaceTemplate).toBe('/work');
  });

  it('does not override vscode workspaceTemplate when already set', () => {
    const selection: TargetSelection = {
      definitions: [],
      targetName: 'default',
      targetSource: 'default',
      targetsFilePath: '/tmp/targets.yaml',
      resolvedTarget: {
        kind: 'vscode-insiders' as const,
        name: 'vscode-insiders',
        judgeTarget: undefined,
        workers: undefined,
        providerBatching: undefined,
        config: {
          command: 'code-insiders',
          waitForResponse: true,
          dryRun: false,
          workspaceTemplate: '/already',
        },
      },
    };

    const updated = applyWorkspaceRootOverride(selection, '/work');

    expect(updated.resolvedTarget.config.workspaceTemplate).toBe('/already');
  });

  it('sets claude-code cwd when missing', () => {
    const selection: TargetSelection = {
      definitions: [],
      targetName: 'default',
      targetSource: 'default',
      targetsFilePath: '/tmp/targets.yaml',
      resolvedTarget: {
        kind: 'claude-code' as const,
        name: 'claude-code',
        judgeTarget: undefined,
        workers: undefined,
        providerBatching: undefined,
        config: {
          executable: 'claude',
        },
      },
    };

    const updated = applyWorkspaceRootOverride(selection, '/work');

    expect(updated.resolvedTarget.config.cwd).toBe('/work');
  });

  it('does not override codex cwd when already set', () => {
    const selection: TargetSelection = {
      definitions: [],
      targetName: 'default',
      targetSource: 'default',
      targetsFilePath: '/tmp/targets.yaml',
      resolvedTarget: {
        kind: 'codex' as const,
        name: 'codex',
        judgeTarget: undefined,
        workers: undefined,
        providerBatching: undefined,
        config: {
          executable: 'codex',
          cwd: '/already',
        },
      },
    };

    const updated = applyWorkspaceRootOverride(selection, '/work');

    expect(updated.resolvedTarget.config.cwd).toBe('/already');
  });

  it('does nothing for providers without cwd/workspaceTemplate', () => {
    const selection: TargetSelection = {
      definitions: [],
      targetName: 'default',
      targetSource: 'default',
      targetsFilePath: '/tmp/targets.yaml',
      resolvedTarget: {
        kind: 'azure' as const,
        name: 'azure',
        judgeTarget: undefined,
        workers: undefined,
        providerBatching: undefined,
        config: {
          resourceName: 'r',
          deploymentName: 'd',
          apiKey: 'k',
        },
      },
    };

    const updated = applyWorkspaceRootOverride(selection, '/work');

    expect(updated).toBe(selection);
  });
});
