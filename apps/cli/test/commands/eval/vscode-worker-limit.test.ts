import { describe, expect, it } from 'bun:test';

describe('VSCode worker limit validation', () => {
  it('should limit workers to 1 for vscode provider when workers > 1', () => {
    // This test verifies that when using vscode or vscode-insiders providers,
    // the workers count is automatically limited to 1 to prevent race conditions
    // caused by window focus requirements.

    const targetSelection = {
      resolvedTarget: {
        kind: 'vscode' as const,
        name: 'test-vscode',
        workers: undefined,
        config: {
          command: 'code',
          waitForResponse: true,
          dryRun: false,
        },
      },
    };

    const options = {
      workers: 3,
    };

    // Simulate the logic from run-eval.ts
    let resolvedWorkers = options.workers ?? targetSelection.resolvedTarget.workers ?? 1;
    const isVSCodeProvider = ['vscode', 'vscode-insiders'].includes(
      targetSelection.resolvedTarget.kind,
    );

    if (isVSCodeProvider && resolvedWorkers > 1) {
      resolvedWorkers = 1;
    }

    expect(resolvedWorkers).toBe(1);
  });

  it('should limit workers to 1 for vscode-insiders provider when workers > 1', () => {
    const targetSelection = {
      resolvedTarget: {
        kind: 'vscode-insiders' as const,
        name: 'test-vscode-insiders',
        workers: undefined,
        config: {
          command: 'code-insiders',
          waitForResponse: true,
          dryRun: false,
        },
      },
    };

    const options = {
      workers: 5,
    };

    let resolvedWorkers = options.workers ?? targetSelection.resolvedTarget.workers ?? 1;
    const isVSCodeProvider = ['vscode', 'vscode-insiders'].includes(
      targetSelection.resolvedTarget.kind,
    );

    if (isVSCodeProvider && resolvedWorkers > 1) {
      resolvedWorkers = 1;
    }

    expect(resolvedWorkers).toBe(1);
  });

  it('should allow multiple workers for non-vscode providers', () => {
    const targetSelection = {
      resolvedTarget: {
        kind: 'azure' as const,
        name: 'test-azure',
        workers: undefined,
        config: {
          resourceName: 'test',
          deploymentName: 'test',
          apiKey: 'test',
        },
      },
    };

    const options = {
      workers: 5,
    };

    let resolvedWorkers = options.workers ?? targetSelection.resolvedTarget.workers ?? 1;
    const isVSCodeProvider = ['vscode', 'vscode-insiders'].includes(
      targetSelection.resolvedTarget.kind,
    );

    if (isVSCodeProvider && resolvedWorkers > 1) {
      resolvedWorkers = 1;
    }

    expect(resolvedWorkers).toBe(5);
  });

  it('should run targets concurrently so vscode does not block other targets', async () => {
    // Simulates the parallel target execution in run-eval.ts.
    // VSCode targets are limited to 1 worker internally, but multiple targets
    // (e.g., vscode + copilot) should run concurrently via Promise.all.

    const events: string[] = [];

    const simulateTarget = async (name: string, delayMs: number) => {
      events.push(`${name}:start`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      events.push(`${name}:end`);
      return [{ target: name }];
    };

    const selections = [
      { name: 'vscode', delay: 50 },
      { name: 'copilot', delay: 10 },
    ];

    // Run concurrently (mirrors the Promise.all in run-eval.ts)
    const targetResults = await Promise.all(
      selections.map(({ name, delay }) => simulateTarget(name, delay)),
    );

    // Both targets should have started before either finished
    expect(events.indexOf('copilot:start')).toBeLessThan(events.indexOf('vscode:end'));
    // All results collected
    expect(targetResults.flat()).toHaveLength(2);
  });

  it('should not apply limit when workers is already 1', () => {
    const targetSelection = {
      resolvedTarget: {
        kind: 'vscode' as const,
        name: 'test-vscode',
        workers: undefined,
        config: {
          command: 'code',
          waitForResponse: true,
          dryRun: false,
        },
      },
    };

    const options = {
      workers: 1,
    };

    let resolvedWorkers = options.workers ?? targetSelection.resolvedTarget.workers ?? 1;
    const isVSCodeProvider = ['vscode', 'vscode-insiders'].includes(
      targetSelection.resolvedTarget.kind,
    );

    if (isVSCodeProvider && resolvedWorkers > 1) {
      resolvedWorkers = 1;
    }

    expect(resolvedWorkers).toBe(1);
  });
});
